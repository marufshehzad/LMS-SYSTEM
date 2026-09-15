/**
 * আরও (More) — the menu page behind the fifth tab. The bar stays at five
 * tabs (04-UIUX: 360 px reference width); every additional feature page
 * lives here as a hash link, so deep links like #/fees keep working too.
 *
 * ── P6 ────────────────────────────────────────────────────────────────────
 *
 * This screen had **no page header at all** and rendered thirty-six
 * full-width `.more-item` strips down a 1110px column at desktop — the
 * longest stretched phone layout in the product, on the one screen every
 * role reaches.
 *
 * It is now `pageHeader` + `ui-card-grid`, which is the right primitive for
 * exactly this: the rows are a CHOICE with a sentence each, not records with
 * fields, so cards rather than a table. Three across at 1440, one on a phone.
 *
 * There is no theme card: Ata Ekta has no dark mode (§5).
 */
import { pageHeader, card, el, append } from './ui/index.ts';

export interface MoreItem {
  path: string;
  glyph: string;
  titleBn: string;
  subtitleBn: string;
}

export interface MoreViewOptions {
  root: HTMLElement;
  doc: Document;
  items: MoreItem[];
}

export class MoreView {
  constructor(o: MoreViewOptions) {
    const d = o.doc;
    o.root.textContent = '';

    o.root.append(pageHeader(d, {
      title: 'আরও',
      subtitle: 'এই ভূমিকার জন্য যেসব পাতা আছে',
    }));

    const grid = el(d, 'div', { className: 'ui-card-grid' });
    for (const item of o.items) {
      append(grid, card(d, {
        title: item.titleBn,
        subtitle: item.subtitleBn,
        glyph: item.glyph,
        variant: 'interactive',
        headingLevel: 3,
        onClick: () => { location.hash = `/${item.path}`; },
      }));
    }
    o.root.append(grid);

  }
}

