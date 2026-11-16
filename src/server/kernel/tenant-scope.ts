/**
 * Declarative tenant-isolation map.
 *
 * Every model in the schema falls into exactly one of three buckets, and
 * the guard in `db.ts` refuses to touch a model that isn't listed. That
 * "deny by default" property is the whole point: adding a model to
 * schema.prisma without classifying it here causes a loud failure in
 * development instead of a silent cross-tenant leak.
 *
 *  - `direct`  — the table has its own `tenantId` column.
 *  - `parent`  — no `tenantId`; reachable through a relation that has
 *                one (e.g. Message → Conversation → tenantId).
 *  - `scalarParent` — no `tenantId` *and* no Prisma relation to the
 *                owner, so it can only be filtered by resolving owner
 *                ids first. Currently just BusinessAILog, whose
 *                `businessId` column has no relation field declared.
 *  - `global`  — genuinely cross-tenant (User, Tenant, RefreshToken).
 *                Unreachable through the tenant client; use `systemDb`
 *                with an explicit justification.
 */

export type ModelName = string;

export interface ParentScope {
  kind: 'parent';
  /** Relation field on this model that leads towards tenantId. */
  relation: string;
  /** Scalar FK backing `relation`, used to validate `create` payloads. */
  foreignKey: string;
  /** Model the relation points at, so guards can chain. */
  parentModel: ModelName;
}

export interface ScalarParentScope {
  kind: 'scalarParent';
  foreignKey: string;
  parentModel: ModelName;
}

export type TenantScope =
  | { kind: 'direct' }
  | ParentScope
  | ScalarParentScope
  | { kind: 'global'; reason: string };

const direct = (): TenantScope => ({ kind: 'direct' });

const parent = (relation: string, foreignKey: string, parentModel: ModelName): TenantScope => ({
  kind: 'parent',
  relation,
  foreignKey,
  parentModel,
});

/**
 * Keys are Prisma *model* names exactly as they appear in schema.prisma
 * (PascalCase). `db.ts` receives the same casing from `$extends`.
 */
export const TENANT_SCOPES: Readonly<Record<ModelName, TenantScope>> = {
  // ── global ────────────────────────────────────────────────────────
  User: { kind: 'global', reason: 'Identity table shared across tenants; owns the tenant relation.' },
  RefreshToken: { kind: 'global', reason: 'Session store keyed by userId, not tenantId.' },
  Tenant: { kind: 'global', reason: 'The tenant table itself.' },

  // ── direct tenantId ───────────────────────────────────────────────
  Workspace: direct(),
  Role: direct(),
  Profile: direct(),
  TenantConfiguration: direct(),
  Contact: direct(),
  Tag: direct(),
  CustomField: direct(),
  ContactNote: direct(),
  Conversation: direct(),
  WhatsappConfig: direct(),
  MessageTemplate: direct(),
  Pipeline: direct(),
  Deal: direct(),
  Broadcast: direct(),
  Automation: direct(),
  AutomationLog: direct(),
  AutomationPendingExecution: direct(),
  Flow: direct(),
  FlowRun: direct(),
  Clinic: direct(),
  BusinessProfile: direct(),
  PortfolioItem: direct(),

  // ── guarded through a relation ────────────────────────────────────
  WorkspaceMember: parent('workspace', 'workspaceId', 'Workspace'),
  ContactTag: parent('contact', 'contactId', 'Contact'),
  ContactCustomValue: parent('contact', 'contactId', 'Contact'),
  Message: parent('conversation', 'conversationId', 'Conversation'),
  MessageReaction: parent('conversation', 'conversationId', 'Conversation'),
  PipelineStage: parent('pipeline', 'pipelineId', 'Pipeline'),
  BroadcastRecipient: parent('broadcast', 'broadcastId', 'Broadcast'),
  AutomationStep: parent('automation', 'automationId', 'Automation'),
  FlowNode: parent('flow', 'flowId', 'Flow'),
  FlowRunEvent: parent('flowRun', 'flowRunId', 'FlowRun'),
  ClinicTiming: parent('clinic', 'clinicId', 'Clinic'),
  Doctor: parent('clinic', 'clinicId', 'Clinic'),
  ClinicService: parent('clinic', 'clinicId', 'Clinic'),
  ClinicFAQ: parent('clinic', 'clinicId', 'Clinic'),
  AISettings: parent('clinic', 'clinicId', 'Clinic'),
  Appointment: parent('clinic', 'clinicId', 'Clinic'),
  PatientIntake: parent('clinic', 'clinicId', 'Clinic'),
  PatientFeedback: parent('clinic', 'clinicId', 'Clinic'),
  AiChatLog: parent('clinic', 'clinicId', 'Clinic'),
  BusinessService: parent('business', 'businessId', 'BusinessProfile'),
  BusinessStaff: parent('business', 'businessId', 'BusinessProfile'),
  BusinessFAQ: parent('business', 'businessId', 'BusinessProfile'),
  BusinessAISettings: parent('business', 'businessId', 'BusinessProfile'),
  BusinessEnquiry: parent('business', 'businessId', 'BusinessProfile'),

  // ── scalar-only owner (no relation field in schema) ───────────────
  BusinessAILog: { kind: 'scalarParent', foreignKey: 'businessId', parentModel: 'BusinessProfile' },
};

export function getTenantScope(model: ModelName): TenantScope | undefined {
  return TENANT_SCOPES[model];
}

/** Operations that read and therefore accept a relation filter in `where`. */
export const READ_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

/** Operations that mutate many rows and accept a relation filter in `where`. */
export const BULK_WRITE_OPERATIONS = new Set(['updateMany', 'deleteMany']);

/** Operations addressing a single row by unique selector. */
export const UNIQUE_OPERATIONS = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert']);

/** Operations that insert rows. */
export const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);
