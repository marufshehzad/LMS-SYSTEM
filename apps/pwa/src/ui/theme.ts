/**
 * Theme — light only.  (Ata Ekta §5)
 *
 * The product used to offer three choices — follow the phone, light, dark —
 * stored under `shikhon_theme` and applied before first paint by a script in
 * app.html. The Ata Ekta redesign has no dark mode, so there is nothing to
 * choose: this module now exists only to pin the document to its one theme
 * and to clear the old preference, so a device that once chose dark does not
 * carry a dead key forever.
 *
 * `THEME_OPTIONS`, `readTheme` and `setTheme` were removed with the two
 * pickers that used them (the shell's profile menu and the More screen).
 */

/** The key the retired picker wrote. Read only to clear it. */
const RETIRED_KEY = 'shikhon_theme';

/**
 * Pin the document to the one theme, and forget any old choice.
 *
 * `data-theme="light"` is set rather than removed so any selector still keyed
 * on it resolves the same way on every device.
 */
export function applyTheme(): void {
  try { localStorage.removeItem(RETIRED_KEY); } catch { /* private mode */ }
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', 'light');
  }
}
