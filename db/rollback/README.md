# Rollback migrations

Applied in **descending** order:

```bash
for f in $(ls -r db/rollback/*.sql); do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

Every statement is `IF EXISTS` + `CASCADE`, so a partial rollback is re-runnable.

> **The glob is `*.sql`, not `*.down.sql`.**  (P12-4)
>
> Two naming conventions grew here: 48 files end `.down.sql` and 27 end plain
> `.sql`. This file used to document `*.down.sql`, which matches only the
> first 48 — an operator following it during an incident would have silently
> skipped 27 rollbacks and stopped with a half-dropped schema, while
> `.github/workflows/database.yml` used `*.sql` and passed. The runbook and
> the thing that is actually tested now agree. The names are left alone
> deliberately: renaming 27 files to fix a glob is the riskier of the two
> changes, and the glob is what was wrong.

## Migrations with no down file, and why

`ls db/migrations | wc -l` is larger than `ls db/rollback | wc -l`, and that is
correct rather than a gap. The chain works by dropping the **base tables** in
001–037 and letting `CASCADE` take everything later migrations hung off them.
A migration needs its own down file only when it creates something the cascade
cannot reach.

| migration | why no down file |
|---|---|
| `038_submission_media` | adds columns and CHECK constraints to `assignment_submissions`; both go with the table when its own rollback drops it |
| `076_platform_fleet` | `CREATE OR REPLACE FUNCTION` over existing tables — dropped by the cascade |
| `077_fleet_summary_totals` | same |
| `078_fleet_filters` | same |
| `079_tenant_identity_writer` | same |

`080_platform_operators` is the exception that proves the rule and says so in
its own header: `platform_operators` is the first table in this schema that
references nothing, so nothing cascades to it and it needed an explicit drop.

The `up → down → up` job in `database.yml` is what keeps this honest: after the
chain runs it asserts **zero** relations remain in `public`, so a migration that
stopped being reachable by the cascade would fail CI rather than quietly linger.

**Scope note.** These are structural rollbacks — they drop objects, they do not
preserve data. That is correct for the current pre-production stage, where the
purpose is the CI up → down → up cycle. Once real institutions are live, any
migration that drops or rewrites a column needs a data-preserving down file
written alongside it, and the expand/contract pattern (add nullable → backfill →
switch reads → drop) should be used instead of in-place ALTERs.
