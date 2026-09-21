// 字体下载
// https://github.com/10ta/twemoji-color-font/releases/latest/download/Twemoji.ttf

register({
  id: 'twemoji-everywhere',
  name: 'Twemoji 替换',
  description: 'Map common emoji font names to the locally installed Twemoji (COLR) font.',
  enabledByDefault: true,
  run(ctx) {
    const src = 'local("Twemoji Regular"), local("Twemoji")';
    const names = [
      'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'Android Emoji',
      'EmojiSymbols', 'EmojiOne Mozilla', 'Twemoji Mozilla', 'Segoe UI Symbol',
      'Noto Color Emoji Compat',
    ];
    ctx.addStyle(names.map(n => `@font-face { font-family: "${n}"; src: ${src}; }`).join('\n'));
  },
});
