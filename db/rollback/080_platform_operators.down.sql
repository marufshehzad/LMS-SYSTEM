-- Rollback for 080 — the platform operator directory (P10-5, B-39).
--
-- Removes the names behind `audit.platform_access.admin_id`. The audit rows
-- themselves are untouched and survive: they belong to migration 001, they
-- carry the actor as a JWT subject, and they never referenced this table by
-- key. After this the console can still say WHAT, WHY and WHEN, and goes
-- back to being unable to say WHO — which is the state B-39 described.
--
-- It also removes the revocation gate. `authorize()` calls
-- `app.operator_is_revoked` on every console request, so rolling this back
-- WITHOUT rolling back the service leaves that call with no function to
-- resolve: the console stops answering rather than quietly admitting a
-- revoked credential. That is the right way round, and it is worth knowing
-- before running this against anything live.
--
-- ── Why this file has to exist when 076–079 do not ─────────────────────
-- The rollback chain works by dropping the base tables in 001–037 and
-- letting the cascade take everything later migrations hung off them. Every
-- other P10 migration adds only FUNCTIONS over existing tables, so the
-- cascade reaches them.
--
-- `platform_operators` is the first table in this schema that references
-- NOTHING — its id is a JWT subject, not a foreign key, because a platform
-- operator belongs to no school. Nothing cascades to a table nothing points
-- at, so it survived the full rollback and left the `database` workflow
-- reporting "rollback left 1 object(s) in public".
BEGIN;

-- Functions first: each one is defined over the table, and dropping them
-- explicitly keeps this readable rather than relying on the CASCADE below
-- to decide what goes.
DROP FUNCTION IF EXISTS app.upsert_platform_operator(uuid, uuid, text, text, text, text);
DROP FUNCTION IF EXISTS app.operator_is_revoked(uuid);
DROP FUNCTION IF EXISTS app.record_operator_seen(uuid);
DROP FUNCTION IF EXISTS app.platform_operators();

-- The policy and the grants go with the table.
DROP TABLE IF EXISTS platform_operators CASCADE;

COMMIT;
