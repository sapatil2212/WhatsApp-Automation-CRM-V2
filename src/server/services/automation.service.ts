/**
 * Automation editor business rules.
 *
 * The engine (executing a trigger through the step tree) is migrated in
 * step 1.3. This service owns the lifecycle: create, edit, validate,
 * activate, duplicate, delete, read logs.
 *
 * Its central job is **refusing to activate an automation the engine cannot
 * execute.** The previous validator mirrored the builder's config keys while
 * the engine read different ones, so validation certified automations that
 * failed on every trigger. Here both sides parse the same Zod schemas from
 * `automation.validator.ts`, so "valid" and "executable" cannot diverge.
 */

import { ConflictError, NotFoundError, ValidationError, type Page, type TenantDb } from '../kernel';
import { toInputJson } from '../dtos/common.dto';
import {
  toAutomationDto,
  toAutomationLogDto,
  type AutomationDetailDto,
  type AutomationDto,
  type AutomationLogDto,
  type AutomationStepDto,
} from '../dtos/automation.dto';
import {
  AutomationRepository,
  type AutomationRow,
  type StepTreeInput,
  type StepTreeNode,
} from '../repositories/automation.repository';
import { CustomFieldRepository, TagRepository } from '../repositories/tag.repository';
import {
  AUTOMATION_TRIGGER_TYPES,
  STEP_LIMITS,
  countSteps,
  maxStepDepth,
  stepConfigSchemaFor,
  triggerConfigSchemaFor,
  type AutomationStepType,
  type AutomationTriggerType,
  type CreateAutomationBody,
  type ListAutomationLogsQuery,
  type ListAutomationsQuery,
  type StepInput,
  type UpdateAutomationBody,
} from '../validators/automation.validator';

export interface AutomationIssue {
  path: string;
  message: string;
}

export interface AutomationServiceDeps {
  automations: AutomationRepository;
  tags: Pick<TagRepository, 'countOwned'>;
  customFields: Pick<CustomFieldRepository, 'countOwned'>;
}

export class AutomationService {
  constructor(
    private readonly deps: AutomationServiceDeps,
    private readonly userId: string,
  ) {}

  static create(db: TenantDb, userId: string): AutomationService {
    return new AutomationService(
      {
        automations: new AutomationRepository(db),
        tags: new TagRepository(db),
        customFields: new CustomFieldRepository(db),
      },
      userId,
    );
  }

  async list(query: ListAutomationsQuery): Promise<Page<AutomationDto>> {
    const page = await this.deps.automations.list(
      { isActive: query.isActive, triggerType: query.triggerType },
      { page: query.page, pageSize: query.pageSize },
    );
    return { ...page, items: page.items.map(toAutomationDto) };
  }

  async getDetail(id: string): Promise<AutomationDetailDto> {
    const automation = await this.deps.automations.findById(id);
    const tree = await this.deps.automations.findStepTree(id);
    return { ...toAutomationDto(automation), steps: tree.map(toStepDto) };
  }

  /**
   * Parses every step's config against the schema for its type, and every
   * trigger config against the schema for its trigger. Returns a flat issue
   * list with dotted paths the builder can map to a field.
   */
  private collectIssues(input: {
    triggerType: AutomationTriggerType;
    triggerConfig: Record<string, unknown>;
    steps: StepInput[];
  }): AutomationIssue[] {
    const issues: AutomationIssue[] = [];

    const triggerParsed = triggerConfigSchemaFor(input.triggerType).safeParse(input.triggerConfig);
    if (!triggerParsed.success) {
      for (const issue of triggerParsed.error.issues) {
        issues.push({
          path: `trigger.${issue.path.join('.') || 'config'}`,
          message: issue.message,
        });
      }
    }

    if (input.steps.length === 0) {
      issues.push({ path: 'steps', message: 'An active automation needs at least one step.' });
    }

    if (countSteps(input.steps) > STEP_LIMITS.maxSteps) {
      issues.push({
        path: 'steps',
        message: `An automation may contain at most ${STEP_LIMITS.maxSteps} steps.`,
      });
    }

    if (maxStepDepth(input.steps) > STEP_LIMITS.maxDepth) {
      issues.push({
        path: 'steps',
        message: `Conditions may not nest more than ${STEP_LIMITS.maxDepth} levels deep.`,
      });
    }

    const walk = (steps: StepInput[], prefix: string) => {
      steps.forEach((step, index) => {
        const path = `${prefix}[${index}]`;
        const schema = stepConfigSchemaFor(step.step_type as AutomationStepType);
        const parsed = schema.safeParse(step.step_config);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            issues.push({
              path: `${path}.${issue.path.join('.') || 'config'}`,
              message: issue.message,
            });
          }
        }

        const branches = step.branches;
        if (step.step_type === 'condition') {
          const yes = branches?.yes ?? [];
          const no = branches?.no ?? [];
          if (yes.length === 0 && no.length === 0) {
            issues.push({ path: `${path}.branches`, message: 'A condition needs at least one branch step.' });
          }
          walk(yes, `${path}.yes`);
          walk(no, `${path}.no`);
        } else if ((branches?.yes?.length ?? 0) + (branches?.no?.length ?? 0) > 0) {
          issues.push({
            path: `${path}.branches`,
            message: `Only a condition may have branches; steps under this ${step.step_type} would never run.`,
          });
        }
      });
    };

    walk(input.steps, 'steps');
    return issues;
  }

  /**
   * Referential checks that need the database: a tag or pipeline id in a
   * step must belong to this tenant. Without this, activation succeeds and
   * the step fails at runtime with a foreign-key error.
   */
  private async collectReferenceIssues(steps: StepInput[]): Promise<AutomationIssue[]> {
    const tagIds: string[] = [];

    const walk = (nodes: StepInput[]) => {
      for (const step of nodes) {
        const config = step.step_config as Record<string, unknown>;
        if ((step.step_type === 'add_tag' || step.step_type === 'remove_tag') && typeof config.tag_id === 'string') {
          tagIds.push(config.tag_id);
        }
        if (step.step_type === 'condition' && config.subject === 'tag_presence' && typeof config.operand === 'string') {
          tagIds.push(config.operand);
        }
        walk(step.branches?.yes ?? []);
        walk(step.branches?.no ?? []);
      }
    };
    walk(steps);

    const issues: AutomationIssue[] = [];
    const unique = [...new Set(tagIds)];
    if (unique.length > 0 && (await this.deps.tags.countOwned(unique)) !== unique.length) {
      issues.push({ path: 'steps', message: 'One or more referenced tags no longer exist.' });
    }
    return issues;
  }

  async validate(id: string): Promise<AutomationIssue[]> {
    const automation = await this.deps.automations.findById(id);
    const tree = await this.deps.automations.findStepTree(id);
    const steps = tree.map(toStepInput);

    if (!isSupportedTrigger(automation.triggerType)) {
      return [
        {
          path: 'trigger.type',
          message: `Trigger "${automation.triggerType}" is no longer supported and can never fire. Choose another trigger.`,
        },
      ];
    }

    return [
      ...this.collectIssues({
        triggerType: automation.triggerType as AutomationTriggerType,
        triggerConfig: (automation.triggerConfig ?? {}) as Record<string, unknown>,
        steps,
      }),
      ...(await this.collectReferenceIssues(steps)),
    ];
  }

  async create(body: CreateAutomationBody): Promise<AutomationDetailDto> {
    if (body.isActive) {
      const issues = [
        ...this.collectIssues({
          triggerType: body.triggerType,
          triggerConfig: body.triggerConfig,
          steps: body.steps,
        }),
        ...(await this.collectReferenceIssues(body.steps)),
      ];
      if (issues.length > 0) {
        throw new ValidationError('This automation cannot be activated yet.', { details: { issues } });
      }
    }

    const automation = await this.deps.automations.create({
      name: body.name,
      description: body.description,
      triggerType: body.triggerType,
      triggerConfig: toInputJson(body.triggerConfig) ?? {},
      isActive: body.isActive,
      steps: toStepWrites(body.steps),
      userId: this.userId,
    });

    return this.getDetail(automation.id);
  }

  /**
   * A live automation may be edited, but the edit is re-validated and the
   * automation is deactivated if it would break. Leaving a broken
   * automation active means every inbound message produces a failed log
   * that nobody reads.
   */
  async update(id: string, body: UpdateAutomationBody): Promise<AutomationDetailDto> {
    const existing = await this.deps.automations.findById(id);

    const nextTriggerType = (body.triggerType ?? existing.triggerType) as AutomationTriggerType;
    const nextTriggerConfig = (body.triggerConfig ??
      (existing.triggerConfig ?? {})) as Record<string, unknown>;
    const nextSteps =
      body.steps ?? (await this.deps.automations.findStepTree(id)).map(toStepInput);

    const wantsActive = body.isActive ?? existing.isActive;

    if (wantsActive) {
      const issues = [
        ...this.collectIssues({
          triggerType: nextTriggerType,
          triggerConfig: nextTriggerConfig,
          steps: nextSteps,
        }),
        ...(await this.collectReferenceIssues(nextSteps)),
      ];
      if (issues.length > 0) {
        // Explicitly asking to activate a broken automation is an error;
        // saving an edit that happens to break a live one deactivates it.
        if (body.isActive === true) {
          throw new ValidationError('This automation cannot be activated yet.', { details: { issues } });
        }
        await this.deps.automations.setActive(id, false);
      }
    }

    await this.deps.automations.updateMetadata(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.triggerType !== undefined ? { triggerType: body.triggerType } : {}),
      ...(body.triggerConfig !== undefined
        ? { triggerConfig: toInputJson(body.triggerConfig) ?? {} }
        : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    });

    if (body.steps) {
      await this.deps.automations.replaceSteps(id, toStepWrites(body.steps));
    }

    return this.getDetail(id);
  }

  async setActive(id: string, isActive: boolean): Promise<AutomationDto> {
    if (isActive) {
      const issues = await this.validate(id);
      if (issues.length > 0) {
        throw new ValidationError('This automation cannot be activated yet.', { details: { issues } });
      }
    }
    await this.deps.automations.setActive(id, isActive);
    return toAutomationDto(await this.deps.automations.findById(id));
  }

  /**
   * Copies an automation and its step tree.
   *
   * The previous route produced a 500 and left an orphaned empty copy
   * behind: its shim stamped `tenantId` onto `automation_steps`, a table
   * with no such column, so the parent insert committed and the step insert
   * threw. Here both happen in one transaction inside the repository.
   */
  async duplicate(id: string): Promise<AutomationDetailDto> {
    const source = await this.deps.automations.findById(id);
    const tree = await this.deps.automations.findStepTree(id);

    const copy = await this.deps.automations.create({
      name: `${source.name} (Copy)`,
      description: source.description,
      triggerType: source.triggerType,
      triggerConfig: toInputJson(source.triggerConfig) ?? {},
      // A copy is never live: it would start firing on the same trigger as
      // the original the moment it was created.
      isActive: false,
      steps: toStepWrites(tree.map(toStepInput)),
      userId: this.userId,
    });

    return this.getDetail(copy.id);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.deps.automations.findById(id);
    if (existing.isActive) {
      throw new ConflictError('Deactivate this automation before deleting it.');
    }
    await this.deps.automations.delete(id);
  }

  async listLogs(id: string, query: ListAutomationLogsQuery): Promise<Page<AutomationLogDto>> {
    await this.deps.automations.findById(id);
    const page = await this.deps.automations.listLogs(
      id,
      { page: query.page, pageSize: query.pageSize },
      query.status,
    );
    return { ...page, items: page.items.map(toAutomationLogDto) };
  }

  async assertExists(id: string): Promise<AutomationRow> {
    const row = await this.deps.automations.findById(id).catch(() => null);
    if (!row) throw new NotFoundError('Automation');
    return row;
  }
}

function isSupportedTrigger(triggerType: string): boolean {
  return (AUTOMATION_TRIGGER_TYPES as readonly string[]).includes(triggerType);
}

function toStepWrites(steps: StepInput[]): StepTreeInput[] {
  return steps.map((step) => ({
    stepType: step.step_type,
    stepConfig: toInputJson(step.step_config) ?? {},
    branches: step.branches
      ? {
          yes: step.branches.yes ? toStepWrites(step.branches.yes) : undefined,
          no: step.branches.no ? toStepWrites(step.branches.no) : undefined,
        }
      : undefined,
  }));
}

function toStepInput(node: StepTreeNode): StepInput {
  return {
    step_type: node.stepType as AutomationStepType,
    step_config: node.stepConfig,
    branches: {
      yes: node.branches.yes.map(toStepInput),
      no: node.branches.no.map(toStepInput),
    },
  };
}

function toStepDto(node: StepTreeNode): AutomationStepDto {
  return {
    id: node.id,
    stepType: node.stepType as AutomationStepType,
    stepConfig: node.stepConfig,
    position: node.position,
    branches: {
      yes: node.branches.yes.map(toStepDto),
      no: node.branches.no.map(toStepDto),
    },
  };
}
