/*
 * Lift copy / cut / select / right-click restrictions on chosen websites.
 *
 * Based on "Remove web limits" by Cat73 (https://github.com/Cat7373/remove-web-limits)
 * and its modified version by iqxin (https://github.com/qxinGitHub/Remove-web-limits-),
 * licensed LGPLv3. Rewritten for Toolkit: per-site toggle in the menu instead of
 * the floating button; same event lists and default site list.
 *
 * How it works: at document-start, before any page script runs, capture-phase
 * listeners on window stop the restricted events from reaching page handlers
 * (addEventListener ones and inline oncopy/oncontextmenu alike), while the
 * browser's default action (copy, selection, context menu) still happens.
 * preventDefault() / returnValue=false on those events are neutralised too,
 * and CSS forces text to be selectable.
 */

// Events whose page handlers are blocked. Mirrors the original rule sets.
const RULES = {
  default: ['contextmenu', 'select', 'selectstart', 'copy', 'cut', 'dragstart', 'mousemove', 'beforeunload'],
  plus: ['contextmenu', 'select', 'selectstart', 'copy', 'cut', 'dragstart', 'mousedown', 'mouseup', 'mousemove', 'beforeunload'],
  zhihu: ['contextmenu', 'select', 'selectstart', 'copy', 'cut', 'dragstart', 'mousemove'],
};

const RULE_BY_SITE = {
  'www.uslsoftware.com': 'plus',
  'www.longmabookcn.com': 'plus',
  'boke112.com': 'plus',
  'www.shangc.net': 'plus',
  'zhihu.com': 'zhihu',
  'www.zhihu.com': 'zhihu',
};

register({
  id: 'remove-web-limits',
  name: '解除复制/右键限制',
  description: 'Unblock copy, cut, text selection and the context menu on sites that disable them.',
  scope: 'site',
  defaultSites: [
    'kkys20.com',
    '3g.163.com', 'b.faloo.com', 'bbs.coocaa.com', 'boke112.com', 'book.hjsm.tom.com',
    'book.zhulang.com', 'book.zongheng.com', 'chokstick.com', 'chuangshi.qq.com', 'city.udn.com',
    'cutelisa55.pixnet.net', 'doc.guandang.net', 'huayu.baidu.com', 'imac.hk', 'leetcode.cn',
    'life.tw', 'luxmuscles.com', 'm.haodf.com', 'movie.douban.com', 'news.missevan.com',
    'origenapellido.com', 'read.qidian.com', 'vipreader.qidian.com', 'votetw.com', 'www.15yan.com',
    'www.17k.com', 'www.18183.com', 'www.360doc.com', 'www.51dongshi.com', 'www.alphapolis.co.jp',
    'www.bimiacg.net', 'www.coco01.net', 'www.daodoc.com', 'www.dianyuan.com', 'www.eyu.com',
    'www.hongshu.com', 'www.hongxiu.com', 'www.imooc.com', 'www.jianbiaoku.com', 'www.jjwxc.net',
    'www.longmabookcn.com', 'www.lu-xu.com', 'www.myhtebooks.com', 'www.myhtlmebook.com',
    'www.pigai.org', 'www.ppkao.com', 'www.readnovel.com', 'www.ruiwen.com', 'www.sdifen.com',
    'www.shangc.net', 'www.soyoung.com', 'www.szxx.com.cn', 'www.tadu.com', 'www.uta-net.com',
    'www.wcqjyw.com', 'www.xiegw.cn', 'www.xxsy.net', 'www.yuque.com', 'www.z3z4.com',
    'www.zhihu.com', 'yuedu.163.com',
  ],
  run(ctx) {
    const W = ctx.page;
    const events = RULES[RULE_BY_SITE[ctx.host] || 'default'];
    const blocked = new Set(events);

    // 1. Stop page handlers. Registered first (document-start, capture, on window),
    //    so no page listener or inline on* handler sees these events.
    const stop = ctx.expose(e => { e.stopImmediatePropagation(); });
    for (const type of events) W.addEventListener(type, stop, true);

    // 2. Belt and braces for handlers that still get to run (e.g. in iframes the
    //    page created before us): ignore preventDefault / returnValue = false.
    const proto = W.Event.prototype;
    const preventDefault = proto.preventDefault;
    proto.preventDefault = ctx.expose(function () {
      if (!blocked.has(this.type)) return preventDefault.apply(this, arguments);
    });
    const rv = Object.getOwnPropertyDescriptor(proto, 'returnValue');
    if (rv && rv.set) {
      Object.defineProperty(proto, 'returnValue', {
        configurable: true,
        enumerable: rv.enumerable,
        get: rv.get,
        set: ctx.expose(function (v) {
          if (v === false && blocked.has(this.type)) return;
          rv.set.call(this, v);
        }),
      });
    }

    // 3. Make text selectable even where CSS forbids it.
    ctx.addStyle(`
      html, body, body * { -webkit-user-select: text !important; user-select: text !important; }
      ::selection { color: #fff !important; background: #3390ff !important; }
    `);
  },
});
