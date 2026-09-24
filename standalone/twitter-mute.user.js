// ==UserScript==
// @name         X video mute diagnostics
// @namespace    https://github.com/10ta/userscripts
// @version      1
// @match        https://x.com/*
// @match        https://twitter.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
(() => {
  const log = (window.__muteLog = []);
  const t0 = performance.now();
  const ids = new WeakMap(); let n = 0;
  const id = v => (ids.has(v) || ids.set(v, ++n), ids.get(v));
  const now = () => Math.round(performance.now() - t0);
  const rec = (type, v, extra = {}) => log.push({
    t: now(), video: id(v), type, muted: v.muted, paused: v.paused,
    inPage: v.isConnected, videos: document.getElementsByTagName('video').length, ...extra,
  });

  // Who writes muted / volume, and from where in X's code.
  const proto = HTMLMediaElement.prototype;
  for (const prop of ['muted', 'volume']) {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    Object.defineProperty(proto, prop, { ...d, set(value) {
      rec(`set ${prop}=${value}`, this, { stack: new Error().stack.split('\n').slice(2, 6).map(s => s.trim()).join(' | ') });
      return d.set.call(this, value);
    } });
  }
  for (const type of ['play', 'pause', 'seeking', 'seeked', 'volumechange', 'loadstart', 'emptied']) {
    document.addEventListener(type, e => { if (e.target instanceof HTMLMediaElement) rec(type, e.target); }, true);
  }
  // What I clicked.
  document.addEventListener('pointerdown', e => {
    const el = e.target.closest && e.target.closest('button, [data-testid]');
    log.push({ t: now(), type: 'CLICK', on: el ? (el.getAttribute('aria-label') || el.dataset.testid || el.tagName) : e.target.tagName });
  }, true);
})();