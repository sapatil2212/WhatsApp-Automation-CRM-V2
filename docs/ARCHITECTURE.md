# Architecture

Status: **Phase 1 — foundation rebuild in progress.** The kernel described in
§1–§6 is complete and enforced. §7 tracks which parts of the application have
been migrated onto it.

---

## 1. Layers

Requests flow in one direction. A layer may only call the layer beneath it.

```
Browser (components, hooks)
        │  typed fetch, standard envelope
        ▼
Route          src/app/api/**/route.ts      — 1–3 lines: export createHandler(...)
        ▼
Controller     src/server/controllers/**    — maps validated input → service call → DTO
        ▼
Validator/DTO  src/server/validators/**     — Zod schemas for params, query, body, response
        ▼
Service        src/server/services/**       — business rules, orchestration, transactions
        ▼
Repository     src/server/repositories/**   — persistence for one aggregate
        ▼
Kernel         src/server/kernel/**         — tenantDb, auth, errors, logging, envelope
        ▼
Prisma / MySQL
```

Hard rules, enforced by ESLint (`eslint.config.mjs`) and code review:

| Rule | Rationale |
| --- | --- |
| A route contains no logic. | Logic in routes cannot be unit-tested or reused. |
| A controller performs no I/O of its own. | Keeps HTTP concerns out of business rules. |
| A service never imports `next/server` or reads cookies. | Services must be callable from cron jobs and the webhook, not just HTTP. |
| A repository never makes network calls and never decides authorisation. | Persistence stays swappable and testable. |
| Nothing below the kernel imports `@/lib/prisma`. | Tenant isolation must not be bypassable. |
| No `console.*` under `src/server`. | Untraceable logs were a production blind spot. |
| No raw SQL outside `systemDb`. | Prisma extensions — and therefore the tenant guard — do not intercept `$queryRaw`. |

---

## 2. Tenant isolation

Isolation is a property of the **client**, not of individual queries. There is
no `tenantId` parameter for a developer to forget.

```ts
// A repository receives an already-scoped client.
const contacts = await db.contact.findMany({ where: { name: { contains: q } } });
// Executes as: WHERE name LIKE ? AND tenantId = <caller's tenant>
```

`src/server/kernel/db.ts` installs a Prisma client extension that rewrites
every operation. `src/server/kernel/tenant-scope.ts` declares how each model is
reachable from a tenant:

| Scope | Meaning | Guard applied |
| --- | --- | --- |
| `direct` | Model has its own `tenantId`. | `where.tenantId = tenantId`; `data.tenantId` on create. |
| `parent` | No `tenantId`; owned through a relation. | `where.<relation> = { tenantId }`; creates pre-verify the FK's owner. |
| `scalarParent` | Owner column exists but has no Prisma relation (`BusinessAILog`). | `where.<fk> = { in: ownedIds }`. |
| `global` | Genuinely cross-tenant (`User`, `RefreshToken`, `Tenant`). | Rejected — `tenantDb` throws. |

Three properties matter:

1. **Deny by default.** A model missing from `TENANT_SCOPES` throws instead of
   running unfiltered. `tenant-scope.test.ts` asserts against Prisma's DMMF that
   every model in the schema is classified, so adding a model to
   `schema.prisma` without classifying it fails CI.
2. **The guard is applied last.** Caller filters are spread first, then the
   tenant predicate overwrites. A caller passing
   `{ tenantId: '<victim>' }` — the exact escalation the old
   `/api/supabase-compat` endpoint permitted — is silently corrected to their
   own tenant. Covered by `db.test.ts`.
3. **Cross-tenant reads look like absence.** The guard turns them into zero
   rows, and repositories convert that into `NotFoundError` (404). Tenant ids
   cannot be probed for existence.

### `systemDb`

The unguarded client. Legitimate uses, each requiring a justification comment:

- authentication (resolving which tenant a user belongs to),
- the WhatsApp webhook (runs before a tenant is known — it resolves one *from*
  `phoneNumberId`),
- signup provisioning (creates the tenant),
- cron sweeps that legitimately span tenants.

---

## 3. Identity and auth modes

`src/server/kernel/auth-context.ts` is the only place cookies become a
principal. Handlers declare a mode; the kernel enforces it before any handler
code runs:

| Mode | Requires | Provides |
| --- | --- | --- |
| `tenant` | Valid session **and** a tenant | `ctx: AuthContext`, `db: TenantDb` |
| `session` | Valid session, tenant optional | `ctx` or `null` |
| `cron` | `x-cron-secret` matching `AUTOMATION_CRON_SECRET` (constant-time) | — |
| `superAdmin` | Operator session cookie | — |
| `public` | Nothing (webhooks verify their own signatures) | — |

An authenticated user with no tenant yields `TENANT_CONTEXT_MISSING` (403) —
a distinct code from `FORBIDDEN` so the client can route to onboarding rather
than render a permission error.

---

## 4. Response envelope

Every JSON endpoint returns the same five keys. `success` alone discriminates
the union, so clients never probe for key existence.

```jsonc
// success
{
  "success": true,
  "message": "Contacts retrieved.",
  "data":    { /* validated against the response DTO */ },
  "meta":    { "requestId": "…", "timestamp": "…", "durationMs": 12,
               "pagination": { "page": 1, "pageSize": 25, "total": 130,
                               "totalPages": 6, "hasNext": true, "hasPrevious": false } },
  "error":   null
}

// failure
{
  "success": false,
  "message": "Contact not found.",
  "data":    null,
  "meta":    { "requestId": "…", "timestamp": "…", "durationMs": 4 },
  "error":   { "code": "NOT_FOUND", "details": { /* only for client-fault errors */ } }
}
```

The response DTO is mandatory and doubles as a **serialisation allowlist**:
Zod object schemas strip unknown keys, so a service that accidentally returns a
`passwordHash` cannot leak it. A payload that violates its own DTO produces a
500 rather than shipping an unvalidated shape — verified in `handler.test.ts`.

`Cache-Control: no-store` and `x-request-id` are set on every response.

---

## 5. Errors

`src/server/kernel/errors.ts` defines the taxonomy; `normalize-error.ts` is the
only module that knows how Zod and Prisma failures map onto it.

| Code | HTTP | Exposed? | Raised when |
| --- | --- | --- | --- |
| `VALIDATION_ERROR` | 400 | yes | Zod failure, malformed JSON, Prisma P2000/P2003/P2011 |
| `UNAUTHENTICATED` | 401 | yes | No usable session, bad cron secret |
| `FORBIDDEN` | 403 | yes | Authenticated but not permitted |
| `TENANT_CONTEXT_MISSING` | 403 | yes | Session without a tenant |
| `NOT_FOUND` | 404 | yes | Absent **or** other-tenant row; Prisma P2025 |
| `CONFLICT` | 409 | yes | Prisma P2002, state conflicts |
| `RATE_LIMITED` | 429 | yes | Throttled (`Retry-After` set) |
| `NOT_IMPLEMENTED` | 501 | yes | Route exists, capability does not |
| `DATABASE_ERROR` | 500 | **no** | Driver/constraint failures |
| `EXTERNAL_API_ERROR` | 502 | yes | Meta, Gemini, SMTP |
| `INTERNAL_ERROR` | 500 | **no** | Anything unanticipated |

Non-exposed errors return a generic message and withhold `details`; the real
message, stack, and `cause` chain go to the log only. No route writes its own
`try/catch` — `createHandler` is the global handler.

---

## 6. Logging

`src/server/kernel/logger.ts` emits one JSON object per line, automatically
enriched from the AsyncLocalStorage request context:

```json
{"level":"info","time":"2026-08-09T07:45:54.752Z","msg":"request completed",
 "requestId":"7bdd41c3…","operation":"contacts.list","method":"GET",
 "path":"/api/contacts","durationMs":12,"tenantId":"…","userId":"…","status":200}
```

- `requestId`, `tenantId`, `userId`, `durationMs`, `operation` on every record —
  a client-reported bug maps to one log line.
- `redact()` masks any key matching `token`, `secret`, `password`, `apiKey`, or
  `credential` at any depth, so spreading a config object is safe.
- 4xx logs at `warn` without a stack; 5xx logs at `error` with the full cause
  chain. The error stream stays signal.
- `LOG_LEVEL=silent` disables output (used by the test suite).
- The interface is a strict subset of pino's, so swapping the sink is a
  one-file change.

Never log message bodies — pass lengths or ids. Customer text is PII.

---

## 7. Migration status

| Area | State |
| --- | --- |
| Kernel (errors, envelope, logging, context, tenant guard, base repository, handler) | **Done**, 80 unit tests |
| ESLint architectural guard rails | **Done** for `src/server/**`; widens to the whole tree when the shims are deleted |
| Shared validator + DTO primitives | **Done** |
| Domain: contacts, tags, custom fields, notes | **Done** — repository, service, validators, DTOs |
| Domain: conversations, messages, reactions | **Done** — includes server-side 24h service window |
| Domain: message templates | **Done** — includes the approved-only send gate |
| Domain: broadcasts | **Done** — server-side batched sender, maintained counters |
| Domain: automations | **Done** — canonical step-config contract, wait queue |
| Domain: flows | **Done** — transactional graph save, one-active-run guard |
| Domain: WhatsApp config + Meta transport | **Done** — single adapter for all three transports |
| Domain: pipelines, stages, deals | **Done** — currency-aware analytics, stage/contact ownership checks |
| Domain: dashboard | **Done** — aggregates computed in the database |
| Domain: clinic (healthcare) + appointments | **Done** — timezone-correct dates, one slot calculator, transactional booking |
| Domain: business verticals | **Done** — includes the `scalarParent`-guarded `BusinessAILog` |
| Domain: portfolio | Repository only |
| Domain: profiles | Repository only (tenant-membership checks) |
| **Step 1.2 complete** | 14 domains · 22 repositories · 16 services · 11 validator modules · 11 DTO modules |
| Engine: automations | **Done** (step 1.3) — canonical config keys, real wait queue, round-robin, `close_conversation` |
| Engine: flows | **Done** (step 1.3) — idempotency via the webhook, one-active-run guard, per-flow timeouts |
| Shared system-send path (`OutboundMessageService`) | **Done** — replaces both `meta-send.ts` copies |
| Controllers: automations, flows, conversations, webhook | **Done** — 22 routes wired |
| Controllers: contacts, tags, pipelines, dashboard, broadcasts, templates, clinic, business, portfolio | Not started (step 1.3, remainder) |
| Browser typed API client | Not started (step 1.4) |
| `src/lib/supabase/*`, `lib/{automations,flows}/admin-client`, `/api/supabase-compat` | **Present.** 39 client files + 14 server files pending migration |

### The webhook

The webhook is the only endpoint where a tenant is *derived* rather than
authenticated, so it is worth stating its invariants in one place:

1. The raw body is read **once** and the HMAC is verified over exactly those
   bytes. Re-serialising parsed JSON changes whitespace and breaks the
   signature.
2. Meta is acknowledged before processing. Its timeout is a few seconds and one
   inbound message can fan out to AI, a flow, and several automations.
3. Idempotency is keyed on `Message.messageId` and checked **before any
   write**. Meta redelivers until it sees a 2xx, and this single guard protects
   the message table, the unread badge, the AI handlers, the flow runner and
   every automation. The previous code attempted this only inside the flow
   engine, using a PostgREST JSON operator that did not exist on this database.
4. `phone_number_id` → `WhatsappConfig` → tenant is the only `systemDb` query;
   everything after it runs on the scoped client.

### Dates and times

Two rules, both learned from bugs:

- **`@db.Date` columns are parsed and read at UTC.** `dateOnlyInputSchema`
  produces UTC midnight; `toDateOnly` reads the UTC calendar date. The previous
  code used `new Date(str + 'T00:00:00')`, which JavaScript interprets locally —
  so on an IST host every appointment was stored a day early.
- **Clock times are `HH:mm` strings compared lexicographically.** Safe for
  zero-padded 24-hour values, and it avoids a Date round-trip per slot.

`TenantConfiguration.brandingTimezone` exists and is still unused. Until a
tenant timezone drives these, UTC is the one consistent answer — not the
server's incidental locale.

### Injected transports

Services never call Meta directly. Each takes the narrowest interface that
covers what it actually does:

| Interface | Used by | Covers |
| --- | --- | --- |
| `OutboundTransport` | `ConversationService`, `OutboundMessageService` | text, template, media |
| `InteractiveTransport` | flow engine | buttons, lists |
| `ReactionTransport` | inbox | reactions |
| `TemplateTransport` | `TemplateService` | submit, delete, list |
| `BroadcastTransport` | `BroadcastService` | campaign template sends |

`WhatsappTransport` implements all five and is the only module that decrypts
an access token. Consequences: the same service serves the inbox, an
automation and a flow; and the business rules are unit-testable with no
network and no database.

### Agent sends vs system sends

Two paths, deliberately separate, differing in exactly two things — the sender
is `bot` rather than `agent`, and the caller starts from a **contact** rather
than an open conversation:

- `ConversationService.sendMessage` — an agent typing in the inbox.
- `OutboundMessageService` — automations, flows, reminders.

Both enforce the 24-hour service window and both persist only *after* Meta
accepts. This replaced three drifting copies of the same logic
(`lib/automations/meta-send.ts`, `lib/flows/meta-send.ts`, and inline code in
`api/whatsapp/send/route.ts`), none of which recorded a sender id and only one
of which retried phone-number variants.

### Schema and migrations

`prisma migrate` is now the source of truth for schema changes — see
[MIGRATIONS.md](./MIGRATIONS.md). Before this the project had no migration
history, and the SQL files the README pointed at did not exist.

Adding a model requires two steps, not one: the migration, **and** an entry in
`TENANT_SCOPES` (`src/server/kernel/tenant-scope.ts`). A model that is not
classified is rejected by the tenant guard at runtime, and
`tenant-scope.test.ts` fails CI — which is what makes it impossible to add a
table that silently leaks across tenants.

### Adding an endpoint

1. Schemas in `src/server/validators/<domain>.validator.ts` (request **and**
   response).
2. Persistence in `src/server/repositories/<domain>.repository.ts`, extending
   `BaseRepository`.
3. Rules in `src/server/services/<domain>.service.ts`.
4. Wiring in `src/server/controllers/<domain>.controller.ts`.
5. `src/app/api/<domain>/route.ts`:

```ts
import { contactController } from '@/server/controllers/contact.controller';

export const GET = contactController.list;
export const POST = contactController.create;
```

Never add a `try/catch`, a manual `tenantId` filter, a bare `NextResponse.json`,
or a `console.log`.
