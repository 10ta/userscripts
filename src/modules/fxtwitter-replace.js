/*
 * Turn the timestamp link of X / Twitter posts (the post's permalink) into an
 * fxtwitter.com link without tracking parameters:
 *
 * No DOM scanning or observers: the link's href is rewritten just in time, when
 * the pointer or keyboard focus reaches it. So "Copy link address", middle-click,
 * Ctrl/Cmd-click and dragging the link all get the fxtwitter URL, while a plain
 * left click keeps X's normal in-app navigation (X routes it itself).
 */
const FX_HOST = 'fxtwitter.com';
const STATUS_PATH = /^\/([^/]+)\/status\/(\d+)/;

function toFx(href) {
  let url;
  try { url = new URL(href); } catch { return null; }
  const m = url.pathname.match(STATUS_PATH);
  return m ? `https://${FX_HOST}/${m[1]}/status/${m[2]}` : null;
}

register({
  id: 'fxtwitter-link',
  name: '时间戳链接转 fxtwitter',
  description: 'Post timestamp links on X/Twitter point to fxtwitter.com (tracking parameters removed).',
  enabledByDefault: true,
  match: [/(^|\.)x\.com$/, /(^|\.)twitter\.com$/],
  run() {
    const rewrite = e => {
      const a = e.target instanceof Element && e.target.closest('a[href]');
      if (!a || !a.querySelector('time')) return; // only the timestamp link of a post
      const fx = toFx(a.href);
      if (fx && a.href !== fx) a.setAttribute('href', fx);
    };
    for (const type of ['pointerover', 'focusin', 'contextmenu', 'mousedown']) {
      document.addEventListener(type, rewrite, true);
    }
  },
});

/*
 * Hide the Share button in X / Twitter post action bars. Pure CSS.
 * (Its main use, copying the post link, is covered above: right-click the
 * timestamp -> "Copy link address" gives the fxtwitter URL.)
 *
 * X has no data-testid on the Share button, and its aria-label depends on the UI
 * language, so it is located by position: the action right after the Bookmark
 * button (in timelines and on the post page alike). The English label is a
 * fallback in case the order changes.
 */
register({
  id: 'x-hide-share',
  name: '隐藏分享按钮',
  parent: 'fxtwitter-link',
  description: 'Hide the Share button under posts on X/Twitter.',
  enabledByDefault: true,
  match: [/(^|\.)x\.com$/, /(^|\.)twitter\.com$/],
  run(ctx) {
    ctx.addStyle(`
      [role="group"] > :has([data-testid="bookmark"], [data-testid="removeBookmark"]) + *,
      [role="group"] button[aria-label="Share post"] {
        display: none !important;
      }
    `);
  },
});