# Database migrations

Before this, the project had **no migration history at all**. `prisma/`
contained only `schema.prisma`, while the README and CHANGELOG instructed
self-hosters to apply `supabase/migrations/001…019.sql` — a directory that does
not exist in this repository. There was therefore no reproducible path from an
empty database to the current schema, and no way to roll anything back.

`prisma migrate` is now the single source of truth. `prisma/migrations/` holds:

| Migration | Contents | Risk |
| --- | --- | --- |
| `00000000000000_baseline` | The entire current schema (50 tables). Generated offline from `schema.prisma`; **describes what already exists**. | None — never applied to an existing database |
| `20260809120000_message_reply_and_broadcast_message_id` | 2 nullable columns, 4 indexes, 1 self-FK | None — purely additive |
| `20260809120100_contact_phone_unique_per_tenant` | 1 UNIQUE index | **Can fail on pre-existing duplicates** |

---

## Existing database (has data, no `_prisma_migrations` table)

The baseline must be marked as already-applied, or Prisma will try to create
tables that exist and fail.

```bash
# 1. Back up first. This is the one irreversible step in the sequence.
mysqldump -u USER -p DBNAME > backup-$(date +%F).sql

# 2. Tell Prisma the baseline is already in place. Creates the
#    _prisma_migrations bookkeeping table and records the baseline as applied.
#    Touches no application table.
npx prisma migrate resolve --applied 00000000000000_baseline

# 3. Check for duplicate contacts BEFORE step 4 (see the query below).

# 4. Apply the two real migrations.
npx prisma migrate deploy

# 5. Confirm.
npx prisma migrate status
```

### Step 3 in detail — the one thing that can fail

`20260809120100_contact_phone_unique_per_tenant` adds
`UNIQUE (tenantId, phone)` on `Contact`. Duplicates are **expected** on any
database that ran the pre-refactor CSV importer, which had no de-duplication —
re-importing the same file silently doubled the contact list.

```sql
SELECT tenantId, phone, COUNT(*) AS copies, GROUP_CONCAT(id) AS contactIds
FROM   `Contact`
GROUP  BY tenantId, phone
HAVING COUNT(*) > 1
ORDER  BY copies DESC;
```

Empty result → `migrate deploy` applies cleanly.

Rows returned → the migration fails with `ERROR 1062 Duplicate entry`. The
failure is safe (no data is altered, the index is not created), but Prisma marks
the migration failed and stops. Merge the duplicates, then re-run
`migrate deploy`. The merge procedure is documented in full inside
`prisma/migrations/20260809120100_contact_phone_unique_per_tenant/migration.sql`
— it is not automated because a contact owns conversations, deals, appointments
and broadcast recipients, so choosing the surviving row is a product decision,
not something a schema migration should do silently.

Uniqueness is enforced in application code by `ContactService` in the meantime
(409 on create, on update, and per row during import). The index only closes the
remaining race between two simultaneous creates.

---

## Fresh database

```bash
npx prisma migrate deploy
```

All three migrations apply in order. No `resolve` step, no duplicate check.

---

## Adding a migration

```bash
# 1. Edit prisma/schema.prisma.
# 2. Generate SQL without touching any database:
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/<timestamp>_<name>/migration.sql

# 3. Review the SQL. Then:
npx prisma generate
npm run typecheck && npm test
```

Two rules:

1. **Never hand-edit an applied migration.** Add a new one.
2. **Isolate anything that can fail** — a UNIQUE index, a NOT NULL on an
   existing column, a type narrowing — into its own migration with a detection
   query in the header, so a deploy that stops there has not half-applied a
   batch.

`prisma migrate dev` is intentionally not used here: it requires a shadow
database and can reset the development database. Every migration in this project
was produced with `migrate diff`, which is offline and read-only.

---

## Tenant isolation and migrations

Adding a model to `schema.prisma` is not enough. `TENANT_SCOPES` in
`src/server/kernel/tenant-scope.ts` must classify it as `direct`, `parent`,
`scalarParent`, or `global`, or the tenant guard rejects every query against it
at runtime.

`tenant-scope.test.ts` asserts this against Prisma's DMMF, so an unclassified
model **fails CI** rather than reaching production. That test is the reason
adding a table cannot silently create a cross-tenant leak.
