/**
 * What a school's installed app is called — the pure half of the manifest.
 *
 * This lives apart from `api/manifest.ts` for one reason, and the reason is
 * written on `buildManifest` itself: "Pure, so the identity rules are
 * testable without a database or a request."
 *
 * That was true of the function and false of the file. `api/manifest.ts`
 * also exports the HTTP handler, which needs `resolvePublicTenant`, which
 * imports `server-core/src/db.ts`, which imports `pg`. ES modules load the
 * whole graph, so importing the pure function pulled a Postgres driver in
 * behind it — and `apps/pwa/test/surfaces.test.ts`, a browser-surface test
 * checking that the manifest the service builds matches what the service
 * worker expects, could only run where `pg` happened to be installed.
 *
 * It was installed locally and not in the `frontend` CI job, which runs
 * `cd apps/pwa && npm install` and therefore has only the PWA's own
 * dependencies. So the suite passed on every developer machine and failed
 * on every push from 2026-08-31 onward.
 *
 * Nothing here may import a service, a database or a request. That is the
 * whole point of the file.
 */
import {
  brandName,
  type Branding,
} from '../../../packages/ui-core/src/branding.ts';

/** Platform fallback icons — these exist in apps/pwa/public/icons/. */
export const DEFAULT_ICONS = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
];

function mimeOfDataUrl(url: string): string {
  const m = /^data:(image\/[a-z+]+);/.exec(url);
  return m ? m[1] : 'image/png';
}

/**
 * Pure, so the identity rules are testable without a database or a
 * request: this is the function that decides what a school's installed app
 * is called and what colour its splash screen is.
 */
export function buildManifest(
  branding: Branding,
  tenantId: string | null,
  locale = 'bn',
): Record<string, unknown> {
  const name = brandName(branding, locale);
  const icon = branding.faviconUrl || branding.logoUrl;
  return {
    name,
    short_name: branding.shortName || name,
    start_url: tenantId ? `/app?tid=${encodeURIComponent(tenantId)}` : '/app',
    scope: '/app',
    display: 'standalone',
    background_color: '#FFFFFF',
    theme_color: branding.primaryColor,
    lang: locale === 'en' ? 'en' : 'bn',
    dir: 'ltr',
    icons: icon
      ? [
          // A data URL has no intrinsic size to disagree with, and Chrome
          // needs a >=192px candidate to offer installation at all, so the
          // one asset is declared at both sizes. The platform's maskable
          // icon is kept as the last resort for launcher shapes.
          { src: icon, sizes: '192x192', type: mimeOfDataUrl(icon), purpose: 'any' },
          { src: icon, sizes: '512x512', type: mimeOfDataUrl(icon), purpose: 'any' },
          ...DEFAULT_ICONS.slice(1),
        ]
      : DEFAULT_ICONS,
  };
}
