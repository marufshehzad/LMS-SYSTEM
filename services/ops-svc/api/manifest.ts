/**
 * GET /api/v1/ops/manifest?slug=<slug>|?tid=<tenant-id> — tenant web manifest
 *
 * R-1 of docs/11-MASTER-PLAN.md: "Installing Tenant A must result in Tenant
 * A's identity, not another institution's."
 *
 * The static /manifest.webmanifest cannot do that — it is one file for
 * every school, so whoever installs the PWA gets whatever name and icon
 * that file happens to carry. This serves the same document per tenant.
 * apps/pwa/src/branding.ts repoints <link rel="manifest"> at this URL once
 * the tenant is known, which is the only mechanism available to a static
 * PWA with no server-side rendering.
 *
 * Public for the same reason /ops/brand is: a browser fetches a manifest
 * outside any session, often before login, and it carries only signboard
 * fields.
 *
 * ── start_url points at /app, and carries the tenant ────────────────────
 * An installed icon launches at start_url with no query string of its own,
 * so `?tid=` is what tells a freshly-installed app which school it belongs
 * to on first run. Without it, an install performed before first login
 * would open a tenant-less app.
 *
 * The path is `/app` since R-1-A: "/" is the shikhonBD marketing site, and
 * a school that installs its own app must land in the application, not on
 * a page selling it. `scope` is narrowed to match, so the installed window
 * keeps marketing links out of the app's own navigation context.
 *
 * ── Icons ───────────────────────────────────────────────────────────────
 * A tenant favicon is used when set. Otherwise the platform's generic
 * icons are referenced — deliberately, because Chrome refuses to offer
 * installation with no usable icon, and a school with a working install
 * and a plain icon is better off than one with neither.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { corsHeaders } from '../../../packages/server-core/src/http.ts';
import { DEFAULT_BRANDING } from '../../../packages/ui-core/src/branding.ts';
import { tenantKey, resolvePublicTenant } from '../src/public-branding.ts';
// The pure half lives in `src/manifest-build.ts` and is re-exported here so
// this module stays the one URL-shaped entry point. It is a separate FILE
// because this one imports the database through `resolvePublicTenant`, and
// anything importing `buildManifest` from here would load `pg` with it.
import { buildManifest } from '../src/manifest-build.ts';

export { buildManifest };

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const cors = corsHeaders();
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  if (req.method !== 'GET') {
    res.writeHead(405, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }

  const resolved = await resolvePublicTenant(tenantKey(req));
  const body = JSON.stringify(
    resolved
      ? buildManifest(resolved.branding, resolved.tenantId)
      // Neutral manifest — an app that installs with a plain identity beats
      // one the browser refuses to install at all.
      : buildManifest(DEFAULT_BRANDING, null),
  );

  res.writeHead(200, {
    ...cors,
    'Content-Type': 'application/manifest+json; charset=utf-8',
    // Short cache: a school that has just changed its logo should see the
    // install identity follow within minutes, not at the next deploy.
    'Cache-Control': 'public, max-age=300',
  });
  res.end(body);
}
