/*
 * Replace page fonts with my own stacks — a lightweight NiceFont, pure CSS.
 *
 * One stylesheet injected at document-start: no DOM walking, no observers.
 * Content added later is covered automatically by the same rules.
 *
 * Stacks: Latin font first, then the CJK font, then Twemoji, then the generic
 * family. Quote every font name (names starting with a digit such as
 * "Merriweather 18pt" are invalid unquoted); never quote the generic keyword.
 *
 * The serif stack is used on sites where the "font-serif" module is on.
 * Use the menu to turn this module off for a site that breaks.
 */
const FONT_STACKS = {
  sans: '"Noto Sans", "Noto Sans JP", "LXGW Neo XiHei", "Twemoji", sans-serif',
  serif: '"Merriweather 18pt", "Klee One", "LXGW WenKai GB", "Twemoji", serif',
  mono: '"Inconsolata", "LXGW Neo XiHei", "Twemoji", monospace',
};

// Elements that keep the page's own font: icon fonts. Add a selector here when a
// site's icons turn into letters or boxes (find it via DevTools > Computed >
// font-family, with this module turned off).
const ICON_SELECTORS = [
  'i',
  'svg', 'svg *',
  '[data-cds=Icon]',                                    // claude.ai
  'mat-icon', '[data-mat-icon-type="font"]',            // Angular Material (Google)
  '.material-icons', '[class*="material-symbols"]', '.google-symbols',
  '.fa', '[class^="fa-"]', '[class*=" fa-"]',          // Font Awesome
  '[class^="icon-"]', '[class*=" icon-"]',              // icomoon-style icon fonts
];

// Code gets the monospace stack.
const CODE_SELECTORS = ['code', 'code *', 'pre', 'pre *', 'kbd', 'kbd *', 'samp', 'tt'];

register({
  id: 'font-inject',
  name: '字体替换',
  description: 'Use my own sans / serif / mono font stacks on pages, keeping icon fonts intact.',
  scope: 'site',
  enabledByDefault: true,
  defaultSites: [],   // sites where it is off by default
  run(ctx) {
    const skip = [...ICON_SELECTORS, ...CODE_SELECTORS].join(', ');
    const code = CODE_SELECTORS.join(', ');
    ctx.addStyle(`
      :root {
        --tk-font: ${FONT_STACKS.sans};
        --tk-font-serif: ${FONT_STACKS.serif};
        --tk-font-mono: ${FONT_STACKS.mono};
      }
      body, body *:not(${skip}) { font-family: var(--tk-font) !important; }
      ${code} { font-family: var(--tk-font-mono) !important; }
    `);
  },
});
