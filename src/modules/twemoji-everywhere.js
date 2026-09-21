register({
  id: 'twemoji-everywhere',
  name: 'Twemoji 替换网页 emoji 字体',
  description: 'Map Segoe UI Emoji / Apple Color Emoji / Noto Color Emoji to the locally installed Twemoji (COLR) font.',
  enabledByDefault: true,
  run(ctx) {
    const src = 'local("Twemoji Regular"), local("Twemoji-Regular")';
    const names = ['Segoe UI Emoji', 'Segoe UI Symbol', 'Apple Color Emoji', 'Noto Color Emoji'];
    ctx.addStyle(names.map(n => `@font-face { font-family: "${n}"; src: ${src}; }`).join('\n'));
  },
});
