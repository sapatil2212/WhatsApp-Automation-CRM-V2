/**
 * Flow editor business rules.
 *
 * The runner itself (dispatching an inbound message through the node graph)
 * is migrated in step 1.3. This service owns the lifecycle around it:
 * create, edit, validate, activate, archive, delete, and read run history.
 *
 * Activation is the interesting rule. `src/lib/flows/validate.ts` already
 * encodes graph integrity and Meta's interactive-message limits, and is
 * shared with the builder UI so client and server cannot disagree. This
 * service refuses activation while any error-severity issue remains, and
 * returns the issue list so the editor can highlight offending nodes.
 */

import { ConflictError, ValidationError, type Page, type TenantDb } from '../kernel';
import { validateFlowForActivation, type ValidationIssue } from '@/lib/flows/validate';
import { toInputJson } from '../dtos/common.dto';
import {
  DEFAULT_FALLBACK_POLICY,
  toFlowDetailDto,
  toFlowDto,
  toFlowRunDto,
  toFlowRunEventDto,
  type FlowActivationResultDto,
  type FlowDetailDto,
  type FlowDto,
  type FlowRunDto,
  type FlowRunEventDto,
} from '../dtos/flow.dto';
import { FlowRepository, FlowRunRepository, type FlowNodeWrite } from '../repositories/flow.repository';
import type {
  CreateFlowBody,
  FlowNodeInput,
  ListFlowRunsQuery,
  ListFlowsQuery,
  UpdateFlowBody,
} from '../validators/flow.validator';

export interface FlowServiceDeps {
  flows: FlowRepository;
  runs: FlowRunRepository;
}

export class FlowService {
  constructor(
    private readonly deps: FlowServiceDeps,
    private readonly userId: string,
  ) {}

  static create(db: TenantDb, userId: string): FlowService {
    return new FlowService({ flows: new FlowRepository(db), runs: new FlowRunRepository(db) }, userId);
  }

  async list(query: ListFlowsQuery): Promise<Page<FlowDto>> {
    const page = await this.deps.flows.list(
      { status: query.status, search: query.search },
      { page: query.page, pageSize: query.pageSize },
    );
    return { ...page, items: page.items.map(toFlowDto) };
  }

  async getDetail(id: string): Promise<FlowDetailDto> {
    return toFlowDetailDto(await this.deps.flows.findWithNodes(id));
  }

  async create(body: CreateFlowBody): Promise<FlowDetailDto> {
    assertUniqueNodeKeys(body.nodes);
    assertEntryNodeExists(body.entryNodeKey, body.nodes);

    const flow = await this.deps.flows.create({
      name: body.name,
      description: body.description,
      triggerType: body.triggerType,
      triggerConfig: toInputJson(body.triggerConfig) ?? {},
      entryNodeKey: body.entryNodeKey,
      fallbackPolicy: toInputJson(DEFAULT_FALLBACK_POLICY) ?? {},
      nodes: toNodeWrites(body.nodes),
      userId: this.userId,
    });

    return this.getDetail(flow.id);
  }

  /**
   * Saves the editor's state.
   *
   * An `active` flow may be edited, but every save re-validates and demotes
   * it to `draft` if it would break: leaving a broken graph live would
   * strand customers mid-conversation on a node that no longer exists.
   */
  async update(id: string, body: UpdateFlowBody): Promise<FlowDetailDto> {
    const existing = await this.deps.flows.findWithNodes(id);

    const nextNodes = body.nodes ?? existing.nodes.map(toNodeInput);
    if (body.nodes) {
      assertUniqueNodeKeys(body.nodes);
    }

    const nextEntry = body.entryNodeKey !== undefined ? body.entryNodeKey : existing.entryNodeId;
    assertEntryNodeExists(nextEntry, nextNodes);

    await this.deps.flows.updateMetadata(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.triggerType !== undefined ? { triggerType: body.triggerType } : {}),
      ...(body.triggerConfig !== undefined ? { triggerConfig: toInputJson(body.triggerConfig) ?? {} } : {}),
      ...(body.entryNodeKey !== undefined ? { entryNodeId: body.entryNodeKey } : {}),
      ...(body.fallbackPolicy !== undefined
        ? { fallbackPolicy: toInputJson(body.fallbackPolicy) ?? {} }
        : {}),
    });

    if (body.nodes) {
      await this.deps.flows.replaceNodes(id, toNodeWrites(body.nodes));
    }

    if (existing.status === 'active') {
      const issues = await this.validate(id);
      if (issues.some((issue) => issue.severity === 'error')) {
        await this.deps.flows.setStatus(id, 'draft');
      }
    }

    return this.getDetail(id);
  }

  /** Validation issues for the current saved state. */
  async validate(id: string): Promise<ValidationIssue[]> {
    const flow = await this.deps.flows.findWithNodes(id);
    return validateFlowForActivation(
      {
        name: flow.name,
        trigger_type: flow.triggerType as 'keyword' | 'first_inbound_message' | 'manual',
        trigger_config: (flow.triggerConfig ?? {}) as Record<string, unknown>,
        entry_node_id: flow.entryNodeId,
      },
      flow.nodes.map((node) => ({
        node_key: node.nodeKey,
        node_type: node.nodeType,
        config: (node.config ?? {}) as Record<string, unknown>,
      })),
    );
  }

  /**
   * Activates only when no error-severity issue remains. Returns the issue
   * list either way so the editor can render them; the controller maps a
   * failed activation to 422.
   */
  async activate(id: string): Promise<FlowActivationResultDto> {
    const flow = await this.deps.flows.findById(id);
    if (flow.status === 'active') {
      return { flow: toFlowDto(flow), issues: [] };
    }

    const issues = await this.validate(id);
    const blocking = issues.filter((issue) => issue.severity === 'error');

    if (blocking.length > 0) {
      return { flow: null, issues: issues.map(toIssueDto) };
    }

    await this.deps.flows.setStatus(id, 'active');
    return { flow: toFlowDto(await this.deps.flows.findById(id)), issues: issues.map(toIssueDto) };
  }

  async setStatus(id: string, status: 'draft' | 'active' | 'archived'): Promise<FlowDto> {
    if (status === 'active') {
      const result = await this.activate(id);
      if (!result.flow) {
        throw new ValidationError('This flow has validation errors and cannot be activated.', {
          details: { issues: result.issues },
        });
      }
      return result.flow;
    }

    await this.deps.flows.setStatus(id, status);
    return toFlowDto(await this.deps.flows.findById(id));
  }

  /**
   * Deleting a flow cascades to its runs and their events. Refused while a
   * run is still active so a customer mid-conversation is not silently
   * abandoned; archive first, let the timeout sweep drain, then delete.
   */
  async delete(id: string): Promise<void> {
    await this.deps.flows.findById(id);
    const active = await this.deps.runs.listForFlow(id, { page: 1, pageSize: 1 }, 'active');
    if (active.total > 0) {
      throw new ConflictError(
        `This flow has ${active.total} conversation(s) in progress. Archive it and wait for them to finish before deleting.`,
        { details: { activeRuns: active.total } },
      );
    }
    await this.deps.flows.delete(id);
  }

  async duplicate(id: string): Promise<FlowDetailDto> {
    const source = await this.deps.flows.findWithNodes(id);
    const copy = await this.deps.flows.create({
      name: `${source.name} (Copy)`,
      description: source.description,
      triggerType: source.triggerType,
      triggerConfig: toInputJson(source.triggerConfig) ?? {},
      entryNodeKey: source.entryNodeId,
      fallbackPolicy: toInputJson(source.fallbackPolicy) ?? {},
      nodes: source.nodes.map((node) => ({
        nodeKey: node.nodeKey,
        nodeType: node.nodeType,
        config: toInputJson(node.config) ?? {},
      })),
      userId: this.userId,
    });
    return this.getDetail(copy.id);
  }

  async listRuns(flowId: string, query: ListFlowRunsQuery): Promise<Page<FlowRunDto>> {
    await this.deps.flows.findById(flowId);
    const page = await this.deps.runs.listForFlow(
      flowId,
      { page: query.page, pageSize: query.pageSize },
      query.status,
    );
    return { ...page, items: page.items.map(toFlowRunDto) };
  }

  async listRunEvents(flowId: string, runId: string): Promise<FlowRunEventDto[]> {
    await this.deps.flows.findById(flowId);
    const events = await this.deps.runs.listEvents(runId);
    return events.map(toFlowRunEventDto);
  }
}

function toIssueDto(issue: ValidationIssue) {
  return {
    severity: issue.severity,
    scope: issue.scope,
    nodeKey: issue.node_key ?? null,
    field: issue.field ?? null,
    message: issue.message,
  };
}

function toNodeWrites(nodes: FlowNodeInput[]): FlowNodeWrite[] {
  return nodes.map((node) => ({
    nodeKey: node.nodeKey,
    nodeType: node.nodeType,
    config: toInputJson(node.config) ?? {},
  }));
}

function toNodeInput(node: { nodeKey: string; nodeType: string; config: unknown }): FlowNodeInput {
  return {
    nodeKey: node.nodeKey,
    nodeType: node.nodeType as FlowNodeInput['nodeType'],
    config: (node.config ?? {}) as FlowNodeInput['config'],
  };
}

function assertUniqueNodeKeys(nodes: FlowNodeInput[]): void {
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.nodeKey)) {
      throw new ValidationError(`Duplicate node key "${node.nodeKey}".`, {
        details: { nodeKey: node.nodeKey },
      });
    }
    seen.add(node.nodeKey);
  }
}

/**
 * An entry key pointing at a node that does not exist would fail every run
 * at the first step with `node_not_found`, which is invisible until a
 * customer messages in.
 */
function assertEntryNodeExists(entryNodeKey: string | null, nodes: FlowNodeInput[]): void {
  if (!entryNodeKey) return;
  if (!nodes.some((node) => node.nodeKey === entryNodeKey)) {
    throw new ValidationError(`Entry node "${entryNodeKey}" is not present in this flow.`, {
      details: { entryNodeKey },
    });
  }
}
