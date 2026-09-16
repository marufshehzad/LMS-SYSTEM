/**
 * আরও (More) — the menu page behind the fifth tab. The bar stays at five
 * tabs (04-UIUX: 360 px reference width); every additional feature page
 * lives here as a hash link, so deep links like #/fees keep working too.
 *
 * ── Ata Ekta (01 Shell & Auth §ঘ, “আরও — সব পাতা, ছাঁকা হয় না”) ──────────
 *
 * The design draws this page as ONE flush row list: a glyph, the page's name
 * over a one-line description, and a chevron, in a 56px row with a hairline
 * under it. No cards, no tinted glyph squares, no accent. So the markup is
 * `pageHeader` (the one h1, title only — the design draws no subtitle, and the
 * old one claimed a role filter the caption says does not exist) and a single
 * `list()` of `listItem()` rows, in the order and number app.ts passes: every
 * page, unfiltered. The same list serves both widths; at ≥1024px the sheet
 * caps it (no desktop rendering is drawn).
 *
 * P6 replaced thirty-six full-width `.more-item` strips with a card grid;
 * that grid painted the accent into every glyph square, against Ata Ekta's
 * one-accent rule, and put an h3 inside each <button>, where heading
 * navigation never reached it.
 *
 * Each row still names itself by its title alone, as the interactive card
 * did: the button is labelled by the title and described by the subtitle, so
 * a reader hears "বাড়ির কাজ, বোতাম" and then the sentence, not both run
 * together as the name. Numbers in either line take the `.n` face — listItem
 * wraps them where they stand ("১০ ভূমিকা · RLS আইসোলেশন").
 *
 * There is no theme card: Ata Ekta has no dark mode (§5).
 */
import { pageHeader, list, listItem, emptyState, uid } from './ui/index.ts';

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

    o.root.append(pageHeader(d, { title: 'আরও' }));

    // Nothing is fetched here, so there is no loading, error or denied phase:
    // each destination owns its own. Empty is unreachable in production (app.ts
    // always passes the full list), but it must still say what is missing and
    // where to go — never an invisible, borderless nothing.
    if (!o.items.length) {
      o.root.append(emptyState(d, {
        glyph: 'more-horizontal',
        message: 'এখনো কোনো পাতা নেই।',
        detail: 'হোম থেকে আপনার কাজ শুরু করুন।',
        action: { label: 'হোমে যান', onClick: () => { location.hash = '/home'; } },
      }));
      return;
    }

    const rows = o.items.map((item) => {
      const li = listItem(d, {
        title: item.titleBn,
        subtitle: item.subtitleBn,
        glyph: item.glyph,
        onClick: () => { location.hash = `/${item.path}`; },
      });
      const hit = li.querySelector<HTMLElement>('.ui-list-hit');
      const title = li.querySelector<HTMLElement>('.ui-list-title');
      const sub = li.querySelector<HTMLElement>('.ui-list-sub');
      if (hit && title) {
        title.id = uid('more');
        hit.setAttribute('aria-labelledby', title.id);
        if (sub) {
          sub.id = uid('more');
          hit.setAttribute('aria-describedby', sub.id);
        }
      }
      return li;
    });

    const ul = list(d, 'সব পাতা', ...rows);
    ul.classList.add('more-list');
    o.root.append(ul);
  }
}
