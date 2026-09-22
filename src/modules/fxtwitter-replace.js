/*
 * Turn the timestamp link of X / Twitter posts (the post's permalink) into an
 * fxtwitter.com link without tracking parameters:
 *
 * - Plain left click (or Enter) on the timestamp copies the fxtwitter link and
 *   shows a short toast, instead of opening the post.
 * - The href itself is rewritten just in time (pointer / focus), so "Copy link
 *   address", middle-click, Ctrl/Cmd-click and dragging also give the fxtwitter URL.
 * No DOM scanning or observers: everything reacts to events on the timestamp link.
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
  name: '点时间戳复制 fxtwitter 链接',
  description: 'Post timestamp links on X/Twitter point to fxtwitter.com (tracking parameters removed).',
  enabledByDefault: true,
  match: [/(^|\.)x\.com$/, /(^|\.)twitter\.com$/],
  run(ctx) {
    // The post's timestamp link: an <a> that wraps a <time> element.
    const timestampLink = e => {
      const a = e.target instanceof Element && e.target.closest('a[href]');
      return a && a.querySelector('time') ? a : null;
    };

    const rewrite = e => {
      const a = timestampLink(e);
      const fx = a && toFx(a.href);
      if (fx && a.href !== fx) a.setAttribute('href', fx);
    };
    for (const type of ['pointerover', 'focusin', 'contextmenu', 'mousedown']) {
      document.addEventListener(type, rewrite, true);
    }

    ctx.addStyle(`
      #tk-fx-toast {
        position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%);
        z-index: 2147483647; padding: 8px 16px; border-radius: 999px;
        background: rgb(29, 155, 240); color: #fff; font: 14px/1.4 system-ui, sans-serif;
        box-shadow: 0 4px 16px rgba(0, 0, 0, .3); pointer-events: none;
        transition: opacity .2s; opacity: 0;
      }
      #tk-fx-toast.show { opacity: 1; }
    `);
    let toastTimer;
    const toast = text => {
      let el = document.getElementById('tk-fx-toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'tk-fx-toast';
        document.body.appendChild(el);
      }
      el.textContent = text;
      el.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.remove('show'), 1500);
    };

    // Registered on document in the capture phase, so it runs before X's own
    // (React) click handling and can stop the in-app navigation.
    document.addEventListener('click', e => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const a = timestampLink(e);
      const fx = a && toFx(a.href);
      if (!fx) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      GM_setClipboard(fx, 'text');
      toast('已复制 fxtwitter 链接');
    }, true);
  },
});

/*
 * Hide the Share button in X / Twitter post action bars. Pure CSS.
 * (Its main use, copying the post link, is covered above: click the timestamp.)
 *
 * X has no data-testid on the Share button, and its aria-label depends on the UI
 * language, so it is located by position: the action right after the Bookmark
 * button (in timelines and on the post page alike). The English label is a
 * fallback in case the order changes.
 */
// Buttons other scripts build by cloning the Share button (so they carry its
// aria-label) stay visible, e.g. Twitter Media Downloader's `.tmd-down`.
const KEEP = '.tmd-down';

register({
  id: 'x-hide-share',
  name: '隐藏分享按钮',
  parent: 'fxtwitter-link',
  description: 'Hide the Share button under posts on X/Twitter.',
  enabledByDefault: true,
  match: [/(^|\.)x\.com$/, /(^|\.)twitter\.com$/],
  run(ctx) {
    ctx.addStyle(`
      [role="group"] > :has([data-testid="bookmark"], [data-testid="removeBookmark"]) + :not(${KEEP}),
      [role="group"] button[aria-label="Share post"]:not(${KEEP}, ${KEEP} *) {
        display: none !important;
      }
    `);
  },
});