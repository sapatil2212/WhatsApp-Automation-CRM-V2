/**
 * Message-template business rules.
 *
 * The rule that matters most and did not exist anywhere before:
 * `assertSendable` — a template must be `Approved` before a broadcast or an
 * inbox send may reference it. Its absence is why campaigns failed at Meta
 * with #132001 and reported the failure as a generic 502.
 *
 * The Meta transport is injected so this service is unit-testable and so
 * the same submission path serves the builder UI and any future seed or
 * import.
 */

import {
  ConflictError,
  ExternalApiError,
  NotFoundError,
  ValidationError,
  type Page,
  type TenantDb,
} from '../kernel';
import { toInputJson } from '../dtos/common.dto';
import {
  toTemplateDto,
  type TemplateDto,
  type TemplateSubmitResultDto,
  type TemplateSyncResultDto,
} from '../dtos/template.dto';
import { TemplateRepository, type TemplateListFilter } from '../repositories/template.repository';
import type { ListTemplatesQuery, SubmitTemplateBody } from '../validators/template.validator';
import {
  assertParamCount,
  assertValidTemplateName,
  buildTemplateComponents,
  normalizeTemplateName,
  toLocalCategory,
  toLocalStatus,
  toMetaCategory,
  type TemplateDefinition,
} from './template-components';

/** A template as Meta reports it during a sync. */
export interface MetaTemplateSummary {
  name: string;
  language: string;
  category: string;
  status: string;
  components: Array<Record<string, unknown>>;
}

/**
 * What the service needs from Meta. Narrow on purpose: credential
 * resolution and token decryption are the transport's problem.
 */
export interface TemplateTransport {
  submit(input: {
    name: string;
    language: string;
    category: ReturnType<typeof toMetaCategory>;
    components: ReturnType<typeof buildTemplateComponents>['components'];
  }): Promise<{ status: string }>;
  remove(input: { name: string }): Promise<void>;
  listAll(): Promise<{ templates: MetaTemplateSummary[]; truncated: boolean }>;
}

export interface TemplateServiceDeps {
  templates: TemplateRepository;
  transport?: TemplateTransport;
}

export class TemplateService {
  constructor(
    private readonly deps: TemplateServiceDeps,
    private readonly userId: string,
  ) {}

  static create(db: TenantDb, userId: string, transport?: TemplateTransport): TemplateService {
    return new TemplateService({ templates: new TemplateRepository(db), transport }, userId);
  }

  private requireTransport(): TemplateTransport {
    if (!this.deps.transport) {
      throw new ValidationError(
        'WhatsApp is not connected for this workspace. Connect it in Settings before managing templates.',
      );
    }
    return this.deps.transport;
  }

  async list(query: ListTemplatesQuery): Promise<Page<TemplateDto>> {
    const filter: TemplateListFilter = {
      search: query.search,
      category: query.category,
      status: query.status,
      sendableOnly: query.sendableOnly,
    };
    const page = await this.deps.templates.list(filter, { page: query.page, pageSize: query.pageSize });
    return { ...page, items: page.items.map(toTemplateDto) };
  }

  async getById(id: string): Promise<TemplateDto> {
    return toTemplateDto(await this.deps.templates.findById(id));
  }

  /**
   * The send-time gate. Returns the template so callers can also validate
   * the variable count in the same round trip.
   */
  async assertSendable(name: string, language: string, params: string[] = []): Promise<TemplateDto> {
    const row = await this.deps.templates.findByNameAndLanguage(name, language);
    if (!row) {
      throw new NotFoundError('Template', {
        details: { name, language, hint: 'Sync templates from Meta or submit this one for approval.' },
      });
    }

    const dto = toTemplateDto(row);
    if (!dto.sendable) {
      throw new ConflictError(
        `Template "${name}" is ${dto.status.toLowerCase()} and cannot be sent. Only approved templates may be used.`,
        { details: { name, language, status: dto.status } },
      );
    }

    assertParamCount(dto.bodyText, params);
    return dto;
  }

  /**
   * Builds the Meta payload, submits it, then stores the result with the
   * status Meta returned. Local persistence happens only after Meta
   * accepts, so the catalog can never claim a template exists upstream
   * when it does not.
   */
  async submit(body: SubmitTemplateBody): Promise<TemplateSubmitResultDto> {
    const transport = this.requireTransport();

    const name = normalizeTemplateName(body.name);
    assertValidTemplateName(name);

    const definition: TemplateDefinition = {
      name,
      category: body.category,
      language: body.language,
      headerType: body.headerType,
      headerText: body.headerText,
      headerExample: body.headerExample,
      headerTextExample: body.headerTextExample,
      bodyText: body.bodyText,
      bodyExample: body.bodyExample,
      footerText: body.footerText,
      buttons: body.buttons,
    };

    const { components, localButtons } = buildTemplateComponents(definition);

    let metaStatus: string;
    try {
      const result = await transport.submit({
        name,
        language: body.language,
        category: toMetaCategory(body.category),
        components,
      });
      metaStatus = result.status;
    } catch (error) {
      // Meta's rejections are usually actionable ("body text too long",
      // "sample missing"), so the upstream message is surfaced rather than
      // collapsed into a generic failure.
      throw new ExternalApiError('Meta', `Meta rejected the template: ${describe(error)}`, { cause: error });
    }

    const saved = await this.deps.templates.upsertByNameAndLanguage({
      name,
      language: body.language,
      category: body.category,
      headerType: body.headerType === 'none' ? null : body.headerType,
      headerContent: body.headerType === 'text' ? (body.headerText ?? '').trim() || null : null,
      bodyText: body.bodyText.trim(),
      footerText: (body.footerText ?? '').trim() || null,
      buttons: toInputJson(localButtons ?? undefined),
      status: toLocalStatus(metaStatus),
      userId: this.userId,
    });

    return { template: toTemplateDto(saved), metaStatus };
  }

  /**
   * Pulls Meta's catalog into the local one. Meta is authoritative for
   * status, so a template approved or rejected outside the app converges
   * on the next sync.
   */
  async syncFromMeta(): Promise<TemplateSyncResultDto> {
    const transport = this.requireTransport();

    let listed: Awaited<ReturnType<TemplateTransport['listAll']>>;
    try {
      listed = await transport.listAll();
    } catch (error) {
      throw new ExternalApiError('Meta', `Could not list templates: ${describe(error)}`, { cause: error });
    }

    let inserted = 0;
    let updated = 0;
    let failed = 0;

    for (const remote of listed.templates) {
      try {
        const existing = await this.deps.templates.findByNameAndLanguage(remote.name, remote.language);
        const parsed = parseMetaComponents(remote.components);

        await this.deps.templates.upsertByNameAndLanguage({
          name: remote.name,
          language: remote.language,
          category: toLocalCategory(remote.category),
          headerType: parsed.headerType,
          headerContent: parsed.headerContent,
          bodyText: parsed.bodyText,
          footerText: parsed.footerText,
          buttons: toInputJson(parsed.buttons ?? undefined),
          status: toLocalStatus(remote.status),
          userId: this.userId,
        });

        if (existing) updated += 1;
        else inserted += 1;
      } catch {
        // One malformed remote template must not abort the sync.
        failed += 1;
      }
    }

    return { inserted, updated, failed, truncated: listed.truncated };
  }

  /**
   * Removes upstream first, then locally. If Meta reports the template is
   * already gone the local delete still proceeds — otherwise a template
   * deleted in Meta's console would be permanently unremovable here.
   */
  async delete(id: string): Promise<void> {
    const row = await this.deps.templates.findById(id);

    if (row.status !== 'Draft' && this.deps.transport) {
      try {
        await this.deps.transport.remove({ name: row.name });
      } catch {
        // Deliberately swallowed: local cleanup must not be blocked by an
        // upstream state we cannot control.
      }
    }

    await this.deps.templates.delete(id);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Reduces Meta's component array back to our flat storage shape. Meta is
 * the source of truth during a sync, so anything it omits becomes null
 * rather than retaining a stale local value.
 */
function parseMetaComponents(components: Array<Record<string, unknown>>): {
  headerType: string | null;
  headerContent: string | null;
  bodyText: string;
  footerText: string | null;
  buttons: unknown[] | null;
} {
  let headerType: string | null = null;
  let headerContent: string | null = null;
  let bodyText = '';
  let footerText: string | null = null;
  let buttons: unknown[] | null = null;

  for (const component of components) {
    const type = typeof component.type === 'string' ? component.type.toUpperCase() : '';

    if (type === 'HEADER') {
      const format = typeof component.format === 'string' ? component.format.toLowerCase() : 'text';
      headerType = format;
      headerContent = format === 'text' && typeof component.text === 'string' ? component.text : null;
    } else if (type === 'BODY') {
      bodyText = typeof component.text === 'string' ? component.text : '';
    } else if (type === 'FOOTER') {
      footerText = typeof component.text === 'string' ? component.text : null;
    } else if (type === 'BUTTONS') {
      buttons = Array.isArray(component.buttons) ? (component.buttons as unknown[]) : null;
    }
  }

  return { headerType, headerContent, bodyText, footerText, buttons };
}
