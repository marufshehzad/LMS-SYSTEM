/**
 * Bearer-token authentication shared by every service that sits behind
 * identity-svc's access tokens (academics, sms, rms, finance, ...).
 */
import type { IncomingMessage } from 'node:http';
import { verifyAccessToken, type AccessTokenClaims } from './jwt.ts';
import { header, HttpError } from './http.ts';

export async function authenticate(req: IncomingMessage): Promise<AccessTokenClaims> {
  const authHeader = header(req, 'authorization');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) throw new HttpError(401, 'missing bearer token', 'unauthorized');
  try {
    return await verifyAccessToken(token);
  } catch {
    throw new HttpError(401, 'invalid or expired access token', 'unauthorized');
  }
}

const STAFF_BLOCKLIST = new Set(['student', 'guardian']);

/** Mirrors app.is_staff()'s blocklist semantics at the application layer. */
export function requireStaff(claims: AccessTokenClaims): void {
  if (STAFF_BLOCKLIST.has(claims.role)) {
    throw new HttpError(403, 'this endpoint is restricted to staff', 'forbidden');
  }
}

/**
 * Allowlist check for endpoints narrower than "any staff" — e.g. RMS writes,
 * which app.has_role() also restricts at the RLS layer (see
 * db/migrations/010_rls_policies.sql). Checked against claims.role (the
 * PRIMARY role), not claims.roles, because app.has_role() only ever sees
 * whatever single role withTenant's ctx.role sets as app.role for the
 * session — matching that exactly avoids a confusing pass-here-fail-at-DB
 * gap. This just turns the DB's rejection into a clean 403 up front; RLS
 * remains the real enforcement either way.
 */
export function requireRole(claims: AccessTokenClaims, allowed: string[]): void {
  if (!allowed.includes(claims.role)) {
    throw new HttpError(403, `this endpoint requires one of: ${allowed.join(', ')}`, 'forbidden');
  }
}

/**
 * Who may see a STUDENT's contact details.  (B-56, pre-pilot hardening)
 *
 * One list, in one place, because there were three answers to the same
 * question and they disagreed:
 *
 *   `/academics/students/history`  gated on this list
 *   `/academics/roster`            NOT gated at all — every staff role,
 *                                  including a subject teacher, received
 *                                  the child's phone number
 *   `/ops/guardians?studentId=`    gated harder, on the three roles that
 *                                  may EDIT a guardianship
 *
 * So a subject teacher was refused a child's number on one screen and
 * handed it on another, and neither screen was wrong about its own rule —
 * there simply was no single rule. This is it.
 *
 * ── Why this membership ─────────────────────────────────────────────────
 * R-3 settled it for the guardian panel and the reasoning holds: a phone
 * number is not something every staff member gets because they can open a
 * drawer. The people here are the ones who administer the child — the head,
 * the owner, the academic coordinator, the IT admin, the CLASS teacher who
 * is responsible for them, the accountant who must chase a fee — plus the
 * family itself.
 *
 * A SUBJECT teacher is deliberately absent. They teach the child a subject;
 * reaching the family is the class teacher's job, and "they are staff" is
 * not a reason to hand over a parent's number.
 *
 * ── This gates the VALUE, not the route ─────────────────────────────────
 * A subject teacher still reads the roster — they need the names and roll
 * numbers to teach. What changes is that the phone arrives as `null`
 * instead of a number. Hiding it in the UI while shipping it in the body is
 * the pattern D13 forbids: still there, one devtools tab away.
 */
export const CONTACT_ROLES = [
  'principal', 'school_owner', 'academic_coordinator', 'it_admin',
  'class_teacher', 'accountant', 'guardian', 'student',
];

/** True when this role may be shown a student's phone or email. */
export function maySeeContact(role: string): boolean {
  return CONTACT_ROLES.includes(role);
}
