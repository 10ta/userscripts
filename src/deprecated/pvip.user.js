// ==UserScript==
// @name         中国p站vip
// @namespace    dsd.player.kit
// @version      0.01
// @author       Kazemura
// @match        *://*.pornshop.one/*
// @match        *://*.dsdtube.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* ===================== 配置 ===================== */
  const CFG = {
    api: [
      'https://v2.cdn199.com', 'https://v2.kekecdn.net', 'https://v2.luchu.org',
      'https://v2.madou.ws', 'https://v2.papapa.biz', 'https://v2.tianmtv.com',
      'https://v2.xiaoshuo.info', 'https://v2.xiaoshuo.la',
    ],
    hls: [
      'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js',
      'https://unpkg.com/hls.js@1.5.13/dist/hls.min.js',
      'https://cdn.staticfile.org/hls.js/1.5.13/hls.min.js',
    ],
    pass: 'xxx',          // 站点 CryptoJS 口令
    ver: '260901',        // 站点 bundle 里的版本号
    z: 2147483000,
    longPress: 260,       // 长按倍速判定(ms)
    fastRate: 2.5,        // 长按倍速
    tapGap: 300,          // 双击间隔(ms)
    tapSeek: 10,          // 双击快进退秒数
    slideTol: 14,         // 位移阈值(px)
    hideAfter: 2600,      // 控制条自动隐藏(ms)
  };

  const KEY = 'dsd.kit.v1';
  const raw = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
  const num = (k, d) => { const v = Number(raw(k, d)); return Number.isFinite(v) ? v : d; };
  const app = () => location.hostname.replace(/^www\./, '');
  const fmt = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    const h = (s / 3600) | 0, m = ((s % 3600) / 60) | 0, x = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return (h ? h + ':' + p(m) : p(m)) + ':' + p(x);
  };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ===================== 存储：偏好 / 断点 / 最优线路 ===================== */
  const Store = {
    prefs: Object.assign({ vol: 1, muted: false, rate: 1 }, (() => { try { return JSON.parse(raw(KEY, '{}')) || {}; } catch { return {}; } })()),
    save() { try { localStorage.setItem(KEY, JSON.stringify(this.prefs)); } catch {} },
    pos(id) { return num('dsd.pos.' + id, 0); },
    setPos(id, t) { try { if (t > 5) localStorage.setItem('dsd.pos.' + id, String(Math.floor(t))); } catch {} },
    best: raw('dsd.host', ''),
    setBest(h) { this.best = h || ''; try { localStorage.setItem('dsd.host', this.best); } catch {} },
  };

  /* ===================== 加密：自带 MD5 + WebCrypto，零外部依赖 ===================== */
  const Crypt = {
    md5(bytes) {
      const K = [], S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
      for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32);
      const ml = bytes.length * 8;
      const buf = new Uint8Array((((bytes.length + 8) >> 6) + 1) * 64);
      buf.set(bytes); buf[bytes.length] = 0x80;
      const dv = new DataView(buf.buffer);
      dv.setUint32(buf.length - 8, ml >>> 0, true);
      dv.setUint32(buf.length - 4, Math.floor(ml / 2 ** 32), true);
      let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
      for (let off = 0; off < buf.length; off += 64) {
        const M = []; for (let j = 0; j < 16; j++) M[j] = dv.getUint32(off + j * 4, true);
        let A = a, B = b, C = c, D = d;
        for (let i = 0; i < 64; i++) {
          let F, g;
          if (i < 16) { F = (B & C) | (~B & D); g = i; }
          else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
          else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
          else { F = C ^ (B | ~D); g = (7 * i) % 16; }
          F = (F + A + K[i] + M[g]) | 0;
          A = D; D = C; C = B;
          const s = S[(i >> 4) * 4 + (i % 4)];
          B = (B + ((F << s) | (F >>> (32 - s)))) | 0;
        }
        a = (a + A) | 0; b = (b + B) | 0; c = (c + C) | 0; d = (d + D) | 0;
      }
      const out = new Uint8Array(16), o = new DataView(out.buffer);
      o.setUint32(0, a >>> 0, true); o.setUint32(4, b >>> 0, true);
      o.setUint32(8, c >>> 0, true); o.setUint32(12, d >>> 0, true);
      return out;
    },
    // CryptoJS 的 OpenSSL 兼容 KDF：EVP_BytesToKey(MD5)
    kdf(pass, salt) {
      const pw = new TextEncoder().encode(pass);
      let out = new Uint8Array(0), prev = new Uint8Array(0);
      while (out.length < 48) {
        const h = this.md5(new Uint8Array([...prev, ...pw, ...salt]));
        out = new Uint8Array([...out, ...h]); prev = h;
      }
      return { key: out.slice(0, 32), iv: out.slice(32, 48) };
    },
    async open(b64) {
      const raw = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      if (String.fromCharCode(...raw.slice(0, 8)) !== 'Salted__') throw new Error('密文头不符');
      const { key, iv } = this.kdf(CFG.pass, raw.slice(8, 16));
      const ck = await crypto.subtle.importKey('raw', key, 'AES-CBC', false, ['decrypt']);
      const pt = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, ck, raw.slice(16));
      return JSON.parse(new TextDecoder().decode(pt));
    },
  };

  /* ===================== 依赖加载：多 CDN 兜底 ===================== */
  let hlsLoading = null;
  function loadHls() {
    if (window.Hls) return Promise.resolve();
    if (hlsLoading) return hlsLoading;
    hlsLoading = new Promise((ok, no) => {
      let i = 0;
      const step = () => {
        if (i >= CFG.hls.length) return no(new Error('所有 CDN 均无法加载 hls.js'));
        const s = document.createElement('script');
        let done = false;
        // 单个 CDN 挂起时不能无限等，超时就换下一个
        const t = setTimeout(() => { if (!done) { done = true; s.remove(); step(); } }, 8000);
        const finish = (good) => {
          if (done) return;
          done = true; clearTimeout(t);
          if (good && window.Hls) ok();
          else { s.remove(); step(); }
        };
        s.src = CFG.hls[i++]; s.async = true;
        s.onload = () => finish(true);
        s.onerror = () => finish(false);
        (document.head || document.documentElement).appendChild(s);
      };
      step();
    }).catch((e) => { hlsLoading = null; throw e; });
    return hlsLoading;
  }

  /* ===================== 网络：线路择优 + 失败自动换线 ===================== */
  const Net = {
    order() {
      const first = Store.best;
      return [...new Set([first, ...CFG.api].filter(Boolean))];
    },
    body(id) {
      return {
        url: '/sevenVideos/' + id, userId: null, url_search: null, token: 'ufd',
        deviceInfo: { platform: 'web', operatingSystem: 'windows', osVersion: navigator.userAgent },
        app: app(), version: CFG.ver, isStandalone: false,
        theLink: raw('theLink', 'novaluenull'), uuid: raw('uu1d', 'novalue'),
      };
    },
    async once(host, id) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 15000);
      try {
        const r = await fetch(host + '/js', {
          method: 'POST', signal: ctl.signal, credentials: 'omit', mode: 'cors',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer undefined' },
          body: JSON.stringify(this.body(id)),
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        if (!j || !j.r) throw new Error('响应缺少 r');
        const data = await Crypt.open(j.r);
        if (!data || !Array.isArray(data.m3u8s) || !data.m3u8s.length) throw new Error('无 m3u8');
        return data;
      } finally { clearTimeout(t); }
    },
    async detail(id) {
      let err;
      for (const h of this.order()) {
        try { const d = await this.once(h, id); Store.setBest(h); return d; }
        catch (e) { err = e; if (Store.best === h) Store.setBest(''); }
      }
      throw err || new Error('所有线路均失败');
    },
  };

  /* ===================== 页面锚点 & 站点播放器静音 ===================== */
  const ANCHORS = ['.player-wrapper', '.player-main-column', '.video-page-container'];
  const findAnchor = () => { for (const s of ANCHORS) { const e = document.querySelector(s); if (e) return e; } return null; };

  function muteSite() {
    document.querySelectorAll('video').forEach((v) => {
      if (v.closest('#dsd-kit')) return;
      try { v.muted = true; v.pause(); } catch {}
    });
  }
  // 注意：这里只能用 visibility 隐藏。改成 display:none 会把 .player-wrapper 的高度
  // 压成 0（这个浮层是它唯一的撑高内容），播放器就贴不上去了。
  function hideGate() {
    document.querySelectorAll('.player-inner, .vip-overlay-hint').forEach((e) => {
      if (e.style.visibility === 'hidden') return; // 已经处理过，别再碰样式
      e.style.setProperty('visibility', 'hidden', 'important');
    });
  }
  // MutationObserver 每次都全量扫太亏，用 rAF 合并成每帧一次
  let gateRaf = 0;
  function hideGateSoon() {
    if (gateRaf) return;
    gateRaf = requestAnimationFrame(() => { gateRaf = 0; hideGate(); });
  }

  /* ===================== 播放器外壳 ===================== */
  const UI = {
    host: null, root: null, video: null, hls: null, id: null, anchor: null, ro: null,
    played: false, rate0: 1, lastTap: 0, tapT: 0, hideT: 0, holding: false,
    seekHeld: false, flashT: 0, bright: 1, lastSave: 0, attempt: 0, lineIdx: 0, _resumeH: null,

    ensure() {
      if (this.host) return;
      const host = document.createElement('div');
      host.id = 'dsd-kit';
      Object.assign(host.style, { position: 'fixed', zIndex: CFG.z, background: '#000', borderRadius: '12px', overflow: 'hidden', display: 'none' });
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `
<style>
 :host{all:initial}
 *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;font-family:-apple-system,"Microsoft YaHei",sans-serif}
 .wrap{position:relative;width:100%;height:100%;background:#000;overflow:hidden}
 video{width:100%;height:100%;display:block;background:#000;object-fit:contain}
 .poster{position:absolute;inset:0;background:#000 center/contain no-repeat;z-index:1;cursor:pointer}
 .poster.gone{display:none}
 .gest{position:absolute;inset:0;z-index:2;touch-action:pan-y}
 .play{position:absolute;inset:0;margin:auto;width:70px;height:70px;border:0;border-radius:50%;cursor:pointer;z-index:3;
   background:linear-gradient(140deg,#22d3ee,#0ea5e9);box-shadow:0 8px 28px rgba(34,211,238,.42);
   display:flex;align-items:center;justify-content:center;transition:transform .16s,opacity .22s}
 .play:hover{transform:scale(1.08)}
 .play.gone{opacity:0;pointer-events:none}
 .play svg{width:28px;height:28px;margin-left:4px;fill:#04212b}
 .toast{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:6;padding:7px 15px;border-radius:999px;
   background:rgba(4,20,26,.74);color:#dffaff;font-size:14px;font-weight:600;opacity:0;transition:opacity .16s;pointer-events:none;white-space:nowrap}
 .toast.on{opacity:1}
 .side{position:absolute;top:0;bottom:0;width:26%;z-index:5;display:none;align-items:center;justify-content:center;pointer-events:none}
 .side.on{display:flex}
 .side i{background:rgba(4,20,26,.72);color:#dffaff;font-style:normal;font-size:14px;font-weight:700;padding:7px 12px;border-radius:8px}
 .bar{position:absolute;left:0;right:0;bottom:0;z-index:4;padding:20px 12px 9px;
   background:linear-gradient(to top,rgba(2,10,14,.86),rgba(2,10,14,.28) 62%,transparent);
   display:flex;flex-direction:column;gap:6px;transition:opacity .2s,transform .2s}
 .bar.gone{opacity:0;transform:translateY(10px);pointer-events:none}
 .bar.hide{display:none}
 .row{display:flex;align-items:center;gap:9px}
 .row button{flex:0 0 auto;width:38px;height:38px;border:0;border-radius:9px;cursor:pointer;background:transparent;color:#eafcff;
   font-size:15px;display:flex;align-items:center;justify-content:center;transition:background .15s}
 .row button:hover{background:rgba(34,211,238,.2)}
 .row button:active{background:rgba(34,211,238,.38)}
 .t{flex:0 0 auto;color:#cfeef7;font-size:12px;min-width:40px;text-align:center;font-variant-numeric:tabular-nums}
 .track{position:relative;flex:1 1 auto;height:16px;display:flex;align-items:center;cursor:pointer}
 .track .bg{position:absolute;left:0;right:0;height:4px;border-radius:3px;background:rgba(207,238,247,.26)}
 .track .buf{position:absolute;left:0;height:4px;border-radius:3px;background:rgba(207,238,247,.42)}
 .track .cur{position:absolute;left:0;height:4px;border-radius:3px;background:linear-gradient(90deg,#22d3ee,#0ea5e9)}
 .track .knob{position:absolute;width:12px;height:12px;border-radius:50%;background:#22d3ee;box-shadow:0 0 8px rgba(34,211,238,.9);transform:translateX(-6px)}
 .menu{position:absolute;right:10px;bottom:56px;z-index:7;background:rgba(4,20,26,.94);border:1px solid rgba(34,211,238,.34);
   border-radius:10px;padding:6px;display:none;flex-direction:column;gap:2px;min-width:96px}
 .menu.on{display:flex}
 .menu b{padding:6px 10px;border-radius:6px;color:#cfeef7;font-size:12px;font-weight:500;cursor:pointer;display:flex;justify-content:space-between;gap:14px}
 .menu b:hover{background:rgba(34,211,238,.2)}
 .menu b.sel{color:#22d3ee;font-weight:700}
 .stat{position:absolute;inset:0;z-index:8;display:none;align-items:center;justify-content:center;padding:22px;text-align:center;pointer-events:none;
   background:rgba(2,10,14,.82);color:#dffaff;font-size:13px;line-height:1.6;white-space:pre-line}
 .stat.on{display:flex}
 .corner{position:absolute;top:9px;right:9px;z-index:6;display:flex;gap:6px;opacity:0;transition:opacity .2s}
 .wrap:hover .corner,.corner.pin{opacity:1}
 .corner button{width:30px;height:30px;border:0;border-radius:7px;cursor:pointer;background:rgba(4,20,26,.66);color:#dffaff;font-size:13px}
 .corner button:hover{background:rgba(34,211,238,.34)}
</style>
<div class="wrap">
  <video playsinline webkit-playsinline preload="auto"></video>
  <div class="poster"></div>
  <div class="gest"></div>
  <button class="play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
  <div class="side left"><i></i></div><div class="side right"><i></i></div>
  <div class="toast"></div>
  <div class="bar">
    <div class="row">
      <button data-a="play">▶</button>
      <span class="t cur">00:00</span>
      <div class="track"><div class="bg"></div><div class="buf"></div><div class="cur"></div><div class="knob"></div></div>
      <span class="t tot">00:00</span>
      <button data-a="rate">1×</button>
      <button data-a="full">⛶</button>
    </div>
  </div>
  <div class="menu"></div>
  <div class="corner"><button data-a="reload" title="换线重载">⟳</button><button data-a="pip" title="画中画">▣</button></div>
  <div class="stat"></div>
</div>`;
      const q = (s) => root.querySelector(s);
      host._u = {
        wrap: q('.wrap'), video: q('video'), poster: q('.poster'), gest: q('.gest'), play: q('.play'),
        left: q('.side.left'), right: q('.side.right'), toast: q('.toast'), bar: q('.bar'),
        btnPlay: q('[data-a="play"]'), btnRate: q('[data-a="rate"]'), btnFull: q('[data-a="full"]'),
        btnReload: q('[data-a="reload"]'), btnPip: q('[data-a="pip"]'), menu: q('.menu'),
        track: q('.track'), tcur: q('.cur'), ttot: q('.tot'), stat: q('.stat'),
      };
      document.body.appendChild(host);
      this.host = host; this.root = root; this.video = host._u.video;
      this.wire();
      addEventListener('resize', () => this.fit(), { passive: true });
      addEventListener('scroll', () => this.fit(), { passive: true, capture: true });
    },

    flash(text) {
      const u = this.host._u;
      if (!text) { u.toast.classList.remove('on'); return; }
      u.toast.textContent = text; u.toast.classList.add('on');
      clearTimeout(this.flashT);
      if (!this.holding) this.flashT = setTimeout(() => u.toast.classList.remove('on'), 720);
    },
    status(text) { const u = this.host._u; u.stat.textContent = text || ''; u.stat.classList.toggle('on', !!text); },
    showBar(sticky) {
      const u = this.host._u;
      u.bar.classList.remove('gone');
      clearTimeout(this.hideT);
      if (!sticky && !this.video.paused) this.hideT = setTimeout(() => u.bar.classList.add('gone'), CFG.hideAfter);
    },

    wire() {
      const u = this.host._u, v = this.video;

      v.controls = false;
      v.volume = Store.prefs.vol; v.muted = Store.prefs.muted; v.playbackRate = Store.prefs.rate;
      v.addEventListener('volumechange', () => {
        Store.prefs.vol = v.volume; Store.prefs.muted = v.muted; Store.save();
      });
      // 长按临时倍速不写进偏好，否则 2.5× 会被持久化
      v.addEventListener('ratechange', () => {
        if (!this.holding) { Store.prefs.rate = v.playbackRate; Store.save(); }
        this.syncRate();
      });
      v.addEventListener('error', () => this.status('播放出错，点右上角 ⟳ 换线重载'));
      v.addEventListener('playing', () => {
        this.played = true;
        this.attempt = 0; // 能播了就把重试计数清零
        u.poster.classList.add('gone'); u.play.classList.add('gone');
        u.btnPlay.textContent = '❚❚'; this.status(''); this.showBar();
      });
      v.addEventListener('pause', () => {
        u.btnPlay.textContent = '▶';
        if (this.played) u.play.classList.remove('gone');
        this.showBar(true);
      });
      v.addEventListener('ended', () => { u.btnPlay.textContent = '▶'; u.play.classList.remove('gone'); this.showBar(true); });
      v.addEventListener('timeupdate', () => {
        const d = v.duration || 0;
        u.tcur.textContent = fmt(v.currentTime);
        u.ttot.textContent = fmt(d);
        if (!this.seekHeld && d) this.paint(v.currentTime / d, v.buffered.length ? v.buffered.end(v.buffered.length - 1) / d : 0);
        if (this.id && Date.now() - this.lastSave > 4000) { this.lastSave = Date.now(); Store.setPos(this.id, v.currentTime); }
      });
      v.addEventListener('progress', () => {
        const d = v.duration || 0;
        if (d) this.paint(v.currentTime / d, v.buffered.length ? v.buffered.end(v.buffered.length - 1) / d : 0);
      });

      const start = (e) => { e.preventDefault(); this.play(); };
      u.play.addEventListener('click', start);
      u.poster.addEventListener('click', start);

      u.bar.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        const a = b.dataset.a;
        if (a === 'play') this.toggle();
        else if (a === 'full') this.fullscreen();
        else if (a === 'rate') this.rateMenu();
      });
      u.btnReload.addEventListener('click', () => this.load(this.id, { fresh: true }).catch((e) => this.status('取流失败：' + e.message)));
      u.btnPip.addEventListener('click', () => this.pip());
      if (!document.pictureInPictureEnabled) u.btnPip.style.display = 'none';

      // 进度条：按下即跟手，抬起才落地
      const seekTo = (clientX) => {
        const r = u.track.getBoundingClientRect();
        const p = clamp((clientX - r.left) / r.width, 0, 1);
        this.paint(p, -1);
        return p;
      };
      u.track.addEventListener('pointerdown', (e) => {
        this.seekHeld = true;
        try { u.track.setPointerCapture(e.pointerId); } catch {}
        this._seekP = seekTo(e.clientX);
      });
      u.track.addEventListener('pointermove', (e) => { if (this.seekHeld) this._seekP = seekTo(e.clientX); });
      const drop = () => {
        if (!this.seekHeld) return;
        this.seekHeld = false;
        const d = v.duration || 0;
        if (d) v.currentTime = (this._seekP || 0) * d;
        this.showBar();
      };
      u.track.addEventListener('pointerup', drop);
      u.track.addEventListener('pointercancel', drop);
      // 指针在窗口外释放时 pointerup 可能收不到，用捕获丢失兜底，避免 seekHeld 卡死
      u.track.addEventListener('lostpointercapture', drop);

      u.wrap.addEventListener('pointermove', () => { if (!v.paused) this.showBar(); }, { passive: true });
      u.wrap.addEventListener('pointerdown', () => { if (!v.paused) this.showBar(); }, { passive: true });

      this.gesture(u.gest);
    },

    paint(cur, buf) {
      const u = this.host._u;
      u.track.querySelector('.cur').style.width = (clamp(cur, 0, 1) * 100) + '%';
      u.track.querySelector('.knob').style.left = (clamp(cur, 0, 1) * 100) + '%';
      if (buf >= 0) u.track.querySelector('.buf').style.width = (clamp(buf, 0, 1) * 100) + '%';
    },
    syncRate() { this.host._u.btnRate.textContent = (this.video.playbackRate || 1) + '×'; },

    /* ---------- 手势：长按倍速 / 双击快进退 / 竖向滑音量亮度 ---------- */
    gesture(layer) {
      let s = null;
      const kill = () => { if (s && s.timer) { clearTimeout(s.timer); s.timer = 0; } };

      layer.addEventListener('pointerdown', (e) => {
        if (e.button) return;
        if (e.pointerType === 'touch' && e.isPrimary === false) return;
        // 左半屏=亮度，右半屏=音量（clientX 是视口坐标，必须减掉 left 再比）
        const lr = layer.getBoundingClientRect();
        s = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, hold: false, timer: 0, side: e.clientX < lr.left + lr.width / 2 ? 'L' : 'R', v0: this.video.volume, b0: this.bright };
        s.timer = setTimeout(() => { if (s && !s.moved) { s.hold = true; this.holdOn(); } }, CFG.longPress);
      });

      layer.addEventListener('pointermove', (e) => {
        if (!s || e.pointerId !== s.id) return;
        const dx = e.clientX - s.x, dy = e.clientY - s.y;
        if (!s.moved && Math.hypot(dx, dy) <= CFG.slideTol) return;
        s.moved = true; kill();
        if (s.hold) { this.holdOff(); s.hold = false; }
        if (Math.abs(dy) > Math.abs(dx)) {
          const r = layer.getBoundingClientRect();
          if (s.side === 'R') {
            this.video.volume = clamp(s.v0 - dy / (r.height * 0.9), 0, 1);
            this.video.muted = false;
            this.sideHint('right', Math.round(this.video.volume * 100) + '%');
          } else {
            this.bright = clamp(s.b0 - dy / (r.height * 0.9), 0.25, 1.8);
            this.video.style.filter = 'brightness(' + this.bright.toFixed(2) + ')';
            this.sideHint('left', Math.round(this.bright * 100) + '%');
          }
        }
      }, { passive: true });

      layer.addEventListener('pointerup', (e) => {
        if (!s || e.pointerId !== s.id) return;
        kill();
        this.sideHint(null);
        if (s.hold) { this.holdOff(); s = null; return; }
        if (s.moved) { s = null; return; }
        const now = Date.now();
        if (now - this.lastTap < CFG.tapGap) {
          clearTimeout(this.tapT); this.lastTap = 0;
          const r = layer.getBoundingClientRect();
          this.seekBy(e.clientX - r.left < r.width / 2 ? -CFG.tapSeek : CFG.tapSeek);
        } else {
          this.lastTap = now;
          clearTimeout(this.tapT);
          this.tapT = setTimeout(() => { this.toggle(); this.showBar(); }, CFG.tapGap);
        }
        s = null;
      });

      layer.addEventListener('pointercancel', (e) => {
        if (!s || e.pointerId !== s.id) return;
        kill(); if (s.hold) this.holdOff(); this.sideHint(null); s = null;
      });
    },
    sideHint(side, text) {
      const u = this.host._u;
      u.left.classList.toggle('on', side === 'left');
      u.right.classList.toggle('on', side === 'right');
      if (side === 'left') u.left.querySelector('i').textContent = '亮度 ' + text;
      if (side === 'right') u.right.querySelector('i').textContent = '音量 ' + text;
    },
    holdOn() {
      const v = this.video;
      this.rate0 = v.playbackRate || 1;
      this.holding = true;
      try { v.playbackRate = CFG.fastRate; } catch {}
      this.flash(CFG.fastRate + '× 快进');
      if (v.paused) this.play();
    },
    holdOff() {
      this.holding = false;
      try { this.video.playbackRate = this.rate0 || 1; } catch {}
      this.flash('');
    },
    seekBy(d) {
      const v = this.video, len = v.duration || 0;
      v.currentTime = clamp((v.currentTime || 0) + d, 0, len || 1e9);
      this.flash((d > 0 ? '» ' : '« ') + Math.abs(d) + 's');
      this.showBar();
    },

    /* ---------- 倍速菜单 ---------- */
    rateMenu() {
      const u = this.host._u;
      if (u.menu.classList.contains('on')) { u.menu.classList.remove('on'); return; }
      const rates = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
      u.menu.innerHTML = rates.map((r) => `<b data-r="${r}" class="${this.video.playbackRate === r ? 'sel' : ''}">${r}×<span>${r === 1 ? '正常' : r > 1 ? '快' : '慢'}</span></b>`).join('');
      u.menu.classList.add('on');
      u.menu.onclick = (e) => {
        const b = e.target.closest('b'); if (!b) return;
        this.video.playbackRate = Number(b.dataset.r);
        u.menu.classList.remove('on');
      };
    },

    toggle() { this.video.paused ? this.play() : this.video.pause(); },
    play() {
      muteSite();
      const p = this.video.play();
      if (p && p.catch) p.catch((e) => this.status('浏览器拦了自动播放，再点一下：' + e.message));
    },
    async pip() {
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else await this.video.requestPictureInPicture();
      } catch (e) { this.status('画中画不可用：' + e.message); }
    },
    fullscreen() {
      const v = this.video;
      try {
        if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        else (v.requestFullscreen || v.webkitRequestFullscreen || v.webkitEnterFullscreen).call(v);
      } catch (e) { this.status('全屏失败：' + e.message); }
    },

    /* ---------- 贴住站点播放区 ---------- */
    fit() {
      let a = this.anchor && this.anchor.isConnected ? this.anchor : null;
      if (!a) { a = findAnchor(); if (a !== this.anchor) { this.anchor = a; this.watchAnchor(); } }
      if (!a || !this.host) return;
      const r = a.getBoundingClientRect();
      if (r.width < 20) return;
      // 站点样式可能把锚点高度压成 0（例如浮层被隐藏），退回 16:9
      const h = r.height >= 40 ? r.height : Math.round(r.width * 9 / 16);
      Object.assign(this.host.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: h + 'px' });
    },
    watchAnchor() {
      try { this.ro && this.ro.disconnect(); } catch {}
      this.ro = null;
      if (!this.anchor || typeof ResizeObserver === 'undefined') return;
      this.ro = new ResizeObserver(() => this.fit());
      this.ro.observe(this.anchor);
    },

    /* ---------- 取流 + 装载 ---------- */
    async load(id, opts) {
      const o = opts || {};
      const gen = o.gen;
      const stale = () => gen != null && gen !== BOOT.gen;
      this.id = id; this.played = false;
      this.holdOff();       // 别把长按的临时倍速带进新视频
      this.attempt = 0;
      const u = this.host._u;
      u.poster.classList.remove('gone'); u.play.classList.remove('gone'); u.btnPlay.textContent = '▶';
      u.menu.classList.remove('on');
      this.status('正在获取视频流…');

      // 先拆掉旧实例：否则它的 fatal 回调会在新一轮里再触发一次 load
      if (this.hls) { try { this.hls.destroy(); } catch {} this.hls = null; }
      if (this._resumeH) { try { this.video.removeEventListener('loadedmetadata', this._resumeH); } catch {} this._resumeH = null; }

      const data = await Net.detail(id);
      if (stale()) return;
      const thumb = (data.thumbnails && data.thumbnails[0]) || '';
      u.poster.style.backgroundImage = thumb ? `url("${thumb}")` : '';
      this.video.poster = thumb;
      // 站点会返回多条线路，坏线要能轮换，不能永远只试第 0 条
      const lines = (data.m3u8s || []).filter(Boolean);
      if (!lines.length) throw new Error('接口未返回播放地址');
      const src = lines[this.lineIdx % lines.length] || data.m3u8;

      try { this.video.removeAttribute('src'); this.video.load(); } catch {}

      const native = !!this.video.canPlayType('application/vnd.apple.mpegurl');
      if (!window.Hls && !native) { this.status('正在加载播放内核…'); await loadHls(); }
      if (stale()) return;

      if (window.Hls && window.Hls.isSupported()) {
        const hls = new window.Hls({ enableWorker: true, maxBufferLength: 30, backBufferLength: 60 });
        this.hls = hls;
        hls.loadSource(src);
        hls.attachMedia(this.video);
        hls.on(window.Hls.Events.ERROR, (_e, d) => {
          if (!d || !d.fatal) return;
          if (this.hls !== hls) return; // 已经换成新实例，旧回调丢掉
          if (d.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
            if (this.attempt >= 3) { this.status('多次重试仍失败，点右上角 ⟳ 手动换线'); return; }
            this.attempt++; this.lineIdx++;
            const at = this.video.currentTime || 0;
            this.status(`网络抖动，换线重试 ${this.attempt}/3…`);
            setTimeout(() => {
              if (this.hls !== hls) return;
              this.load(id, { fresh: true, resume: at, gen }).catch((e) => this.status('换线失败：' + e.message));
            }, 900 * this.attempt);
          } else if (d.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
            try { hls.recoverMediaError(); } catch { this.status('解码失败，点右上角 ⟳ 重载'); }
          } else this.status('播放失败，点右上角 ⟳ 换线重载');
        });
      } else if (native) {
        this.video.src = src;
      } else {
        throw new Error('浏览器不支持 HLS');
      }

      this.status('');
      muteSite();
      // 断点续播：显式 resume 优先，其次 fresh 表示从头，最后才读本地断点
      const at = o.resume != null ? o.resume : (o.fresh ? 0 : Store.pos(id));
      if (at > 5) {
        this._resumeH = () => {
          this._resumeH = null;
          if (this.video.duration > at + 10) { this.video.currentTime = at; this.flash('已跳到上次 ' + fmt(at)); }
        };
        this.video.addEventListener('loadedmetadata', this._resumeH, { once: true });
      }
    },

    show() {
      this.ensure();
      Object.assign(this.host.style, { left: '0px', top: '0px', width: '640px', height: '360px', display: 'block' });
      this.fit();
    },
    reset() {
      try { this.hls && this.hls.destroy(); } catch {}
      this.hls = null; this.id = null;
      if (this.host) this.host.style.display = 'none';
      try { this.video && this.video.pause(); } catch {}
    },
  };

  /* ===================== 键盘快捷键（桌面） ===================== */
  let keysBound = false;
  function bindKeys() {
    if (keysBound) return; // 每次路由切换都会调进来，只能绑一次
    keysBound = true;
    addEventListener('keydown', (e) => {
      if (!UI.host || UI.host.style.display === 'none') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const v = UI.video;
      const k = (e.key || '').toLowerCase(); // 合成事件可能没有 key
      const hit = () => { e.preventDefault(); UI.showBar(); };
      if (e.code === 'Space' || k === 'k') { hit(); UI.toggle(); }
      else if (e.key === 'ArrowRight') { hit(); UI.seekBy(e.shiftKey ? 30 : 5); }
      else if (e.key === 'ArrowLeft') { hit(); UI.seekBy(e.shiftKey ? -30 : -5); }
      else if (k === 'l') { hit(); UI.seekBy(10); }
      else if (k === 'j') { hit(); UI.seekBy(-10); }
      else if (e.key === 'ArrowUp') { hit(); v.volume = clamp(v.volume + 0.05, 0, 1); v.muted = false; UI.flash('音量 ' + Math.round(v.volume * 100) + '%'); }
      else if (e.key === 'ArrowDown') { hit(); v.volume = clamp(v.volume - 0.05, 0, 1); UI.flash('音量 ' + Math.round(v.volume * 100) + '%'); }
      else if (k === 'm') { hit(); v.muted = !v.muted; UI.flash(v.muted ? '已静音' : '已取消静音'); }
      else if (k === 'f') { hit(); UI.fullscreen(); }
      else if (k === 'p') { hit(); UI.pip(); }
      else if (k === '[') { hit(); v.playbackRate = clamp(+(v.playbackRate - 0.25).toFixed(2), 0.25, 4); UI.flash(v.playbackRate + '×'); }
      else if (k === ']') { hit(); v.playbackRate = clamp(+(v.playbackRate + 0.25).toFixed(2), 0.25, 4); UI.flash(v.playbackRate + '×'); }
      else if (k === 'r' && UI.id) { hit(); UI.load(UI.id, { fresh: true }).catch((err) => UI.status('取流失败：' + err.message)); }
    }, true);
  }

  /* ===================== 启动 & 路由监听 ===================== */
  const vidOf = () => {
    const m = location.pathname.match(/^\/(?:video|videos|embed)\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]) : null;
  };

  const BOOT = { gen: 0 };
  let current = null;
  async function boot() {
    const id = vidOf();
    if (!id) { current = null; BOOT.gen++; UI.reset(); return; }
    if (id === current && UI.host && UI.host.style.display !== 'none') { UI.fit(); return; }
    current = id;
    const my = ++BOOT.gen; // 快速切视频时，上一轮的结果不能再落地

    let tries = 0;
    while (!findAnchor() && tries++ < 40) {
      if (my !== BOOT.gen) return;
      await new Promise((r) => setTimeout(r, 150));
    }
    if (my !== BOOT.gen) return;

    hideGate();
    UI.show();
    UI.anchor = findAnchor();
    UI.watchAnchor();
    UI.fit();
    bindKeys();

    try { await UI.load(id, { gen: my }); }
    catch (e) { if (my === BOOT.gen) UI.status('取流失败：' + e.message + '\n点右上角 ⟳ 重试'); }
  }

  const maybe = () => { if (vidOf() !== current) boot(); };
  ['pushState', 'replaceState'].forEach((fn) => {
    const orig = history[fn];
    history[fn] = function () { const r = orig.apply(this, arguments); setTimeout(maybe, 60); return r; };
  });
  addEventListener('popstate', () => setTimeout(maybe, 60));

  setInterval(() => {
    maybe();
    if (UI.host && UI.host.style.display !== 'none') { muteSite(); hideGate(); UI.fit(); }
  }, 1000);

  new MutationObserver(hideGateSoon).observe(document.documentElement, { childList: true, subtree: true });

  boot();
})();
