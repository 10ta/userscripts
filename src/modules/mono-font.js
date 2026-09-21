/*
 * Use my own monospace font stack for code on every site.
 * Pure CSS injected at document-start: no DOM changes. Online code editors
 * (Monaco, CodeMirror) don't use these tags and keep their own fonts.
 */
const MONO_STACK = '"Inconsolata", "LXGW Neo XiHei", "Twemoji", monospace';

register({
  id: 'mono-font',
  name: '等宽字体替换（代码）',
  description: 'Force code / pre / kbd / samp to Inconsolata + LXGW Neo XiHei + Twemoji.',
  enabledByDefault: true,
  run(ctx) {
    ctx.addStyle(`
      code, pre, kbd, samp, tt, code *, pre * {
        font-family: ${MONO_STACK} !important;
      }
    `);
  },
});