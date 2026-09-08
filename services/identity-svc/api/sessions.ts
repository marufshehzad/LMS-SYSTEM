/**
 * Where am I signed in, and how do I stop it.  (B-120)
 *
 *   GET  /api/v1/auth/sessions?deviceId=…   — this account's live sessions
 *   POST /api/v1/auth/sessions/revoke       — end ONE device
 *   POST /api/v1/auth/sessions/revoke-others — end every device but this one
 *
 * `user_sessions` has recorded every sign-in since migration 002 and nothing
 * ever read it back to a person. `logout` ends the session making the
 * request; a head teacher whose phone was stolen had no way to end that
 * phone's access and the practical answer was to wait out the refresh token.
 *
 * ── Not a second authentication system ──────────────────────────────────
 * Nothing here mints, verifies or stores a credential. Revocation is the
 * same UPDATE `logout` already performs — `revoked_at` on a row — and the
 * refusal on the next refresh is the check `refresh.ts` has always done. The
 * only new thing is that a person can now aim it.
 *
 * ── Why a DEVICE is the unit, not a row ─────────────────────────────────
 * `refresh.ts` ROTATES: every refresh inserts a new `user_sessions` row and
 * revokes the old one with `superseded_by`. So one signed-in phone is a
 * CHAIN of rows whose live head moves every fifteen minutes, and revoking by
 * row id has a race with a body: the id a screen listed is already revoked
 * by the time somebody presses the button, the UPDATE matches nothing, and
 * the phone that was supposed to lose access keeps refreshing. The screen
 * would say it worked.
 *
 * `device_id` is stable across the whole chain — it is required at login and
 * re-sent on every refresh — so revoking by device ends the chain no matter
 * where its head has moved to. It is also what a person means: they revoke a
 * PHONE, not a token.
 *
 * ── Who may do this ─────────────────────────────────────────────────────
 * Your own sessions, and nobody else's. Every role, including a principal,
 * sees exactly their own list. That answers all of §5's prohibitions at once
 * and adds no privilege: an administrator ending another person's session is
 * a genuinely new power over an account, it is not in the Master Plan, and
 * inventing it here is what this work was told not to do. Recorded in
 * B-120's row instead.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sharedDb } from '../../../packages/server-core/src/db.ts';
import {
  corsHeaders, query, json, readJson, HttpError,
} from '../../../packages/server-core/src/http.ts';
import { authenticate } from '../../../packages/server-core/src/auth.ts';
import { writeAudit } from '../../../packages/server-core/src/audit.ts';

interface SessionRow {
  device_id: string | null;
  device_label: string | null;
  user_agent: string | null;
  issued_at: string;
  last_seen_at: string | null;
  expires_at: string;
}

/**
 * One line a person can recognise a device by, from what was already
 * collected.
 *
 * §7: no fingerprinting is added. `device_label` is what the client sent at
 * login; `user_agent` is the header the browser sends to every request
 * anyway. Reduced to a browser family and an OS family, because "Chrome ·
 * Windows" is what identifies a machine to its owner and the full UA string
 * is a tracking surface printed on a screen.
 *
 * The IP address is stored on the row and is deliberately NOT returned. It
 * identifies a place rather than a device, it is frequently a shared NAT in
 * a Bangladeshi school, and no existing policy asks for it.
 */
function describe(r: SessionRow): string {
  if (r.device_label && r.device_label.trim()) return r.device_label.trim();
  const ua = r.user_agent ?? '';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : '';
  const os = /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iOS/.test(ua) ? 'iOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  const parts = [browser, os].filter(Boolean);
  // Never an empty string on screen: a device nobody can name is still a
  // device somebody may want to end.
  return parts.length ? parts.join(' · ') : 'অজানা ডিভাইস';
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const cors = corsHeaders();
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

  try {
    const claims = await authenticate(req);
    const db = await sharedDb();
    const actor = { tenantId: claims.tid, userId: claims.sub, role: claims.role };

    const path = new URL(req.url ?? '/', 'http://internal').pathname;
    const isRevokeOthers = /revoke-others$/.test(path)
      || (query(req).get('path') ?? '') === 'sessions/revoke-others';
    const isRevoke = !isRevokeOthers && (/revoke$/.test(path)
      || (query(req).get('path') ?? '') === 'sessions/revoke');

    if (req.method === 'GET' && !isRevoke && !isRevokeOthers) {
      const current = (query(req).get('deviceId') ?? '').trim();
      return json(res, 200, await list(db, actor, current), cors);
    }
    if (req.method !== 'POST') { json(res, 405, { error: 'method_not_allowed' }, cors); return; }

    const body = await readJson<{ deviceId?: string }>(req);
    const deviceId = (body.deviceId ?? '').trim();
    if (!deviceId) {
      throw new HttpError(400, 'deviceId is required', 'device_required');
    }
    if (isRevokeOthers) return json(res, 200, await revokeOthers(db, actor, deviceId), cors);
    if (isRevoke) return json(res, 200, await revokeOne(db, actor, deviceId), cors);
    json(res, 404, { error: 'not_found' }, cors);
  } catch (err) {
    if (err instanceof HttpError) {
      json(res, err.status, { error: err.code ?? 'error', message: err.message }, cors);
      return;
    }
    json(res, 500, { error: 'internal_error' }, cors);
  }
}

type Actor = { tenantId: string; userId: string; role: string };

/**
 * The live head of every chain belonging to THIS account.
 *
 * `revoked_at IS NULL` is what collapses a chain to one row: every earlier
 * link was revoked as `rotated` when it was superseded. Grouped by device so
 * a device that somehow holds two live rows still reads as one device.
 *
 * No tenant predicate — `withTenant` sets `app.current_tenant()` and
 * `tenant_isolation` decides. The user predicate IS explicit, because
 * `user_sessions` carries no per-user policy and this is the query that
 * would otherwise hand one person another's devices.
 */
async function list(db: Awaited<ReturnType<typeof sharedDb>>, actor: Actor, currentDevice: string) {
  return db.withTenant(actor, async (c) => {
    const { rows } = await c.query<SessionRow>(
      `SELECT DISTINCT ON (s.device_id)
              s.device_id, s.device_label, s.user_agent,
              s.issued_at::text     AS issued_at,
              s.last_seen_at::text  AS last_seen_at,
              s.expires_at::text    AS expires_at
         FROM user_sessions s
        WHERE s.user_id = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > now()
        ORDER BY s.device_id, s.issued_at DESC`,
      [actor.userId],
    );
    return {
      sessions: rows.map((r) => ({
        // The device id is the handle the client passes back to revoke. It
        // is the client's OWN identifier, not a server secret, and it is the
        // only id here — no session row id, no token, no hash.
        deviceId: r.device_id,
        label: describe(r),
        current: !!r.device_id && r.device_id === currentDevice,
        signedInAt: r.issued_at,
        lastSeenAt: r.last_seen_at,
        expiresAt: r.expires_at,
      })),
    };
  });
}

/**
 * End one device.
 *
 * Idempotent by construction: the UPDATE is filtered on `revoked_at IS
 * NULL`, so revoking twice touches nothing the second time and still
 * answers 200 with `revoked: 0`. A second press must not be an error — the
 * person's intent was already satisfied.
 */
async function revokeOne(db: Awaited<ReturnType<typeof sharedDb>>, actor: Actor, deviceId: string) {
  return db.withTenant(actor, async (c) => {
    const { rowCount } = await c.query(
      `UPDATE user_sessions
          SET revoked_at = now(), revoked_reason = 'user_revoked'
        WHERE user_id = $1 AND device_id = $2 AND revoked_at IS NULL`,
      [actor.userId, deviceId]);
    const revoked = rowCount ?? 0;
    if (revoked > 0) {
      await writeAudit(c, actor, {
        action: 'identity.session.revoke',
        entityType: 'session',
        // The device, the count and the reason. Never a token, never a hash
        // — the row holds `refresh_token_hash` and it does not come near
        // this.
        after: { device: deviceId, sessions: revoked, scope: 'one' },
      });
    }
    return { revoked };
  });
}

/**
 * End every device except this one.
 *
 * The keeper is named rather than inferred, so "everything else" cannot
 * quietly include the device making the request — which would sign the
 * person out while they were reading the confirmation.
 */
async function revokeOthers(db: Awaited<ReturnType<typeof sharedDb>>, actor: Actor, keepDevice: string) {
  return db.withTenant(actor, async (c) => {
    const { rowCount } = await c.query(
      `UPDATE user_sessions
          SET revoked_at = now(), revoked_reason = 'user_revoked_others'
        WHERE user_id = $1 AND revoked_at IS NULL
          AND (device_id IS DISTINCT FROM $2)`,
      [actor.userId, keepDevice]);
    const revoked = rowCount ?? 0;
    if (revoked > 0) {
      await writeAudit(c, actor, {
        action: 'identity.session.revoke',
        entityType: 'session',
        after: { kept: keepDevice, sessions: revoked, scope: 'others' },
      });
    }
    return { revoked };
  });
}
