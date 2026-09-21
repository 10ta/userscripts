# Toolkit 自用油猴脚本合集

一个脚本，多个小功能。每个功能在 Tampermonkey 菜单里有独立开关（✅ 开 / ⬜ 关），点一下切换并自动刷新页面。只显示对当前网站生效的功能。

## 安装

安装 Tampermonkey（或 Violentmonkey）后，打开下面的链接即可安装，之后会随 Release 自动更新：

https://github.com/10ta/userscripts/releases/latest/download/toolkit.user.js

## 功能列表

<!-- modules:start -->
| 模块 | 默认 | 作用站点 | 说明 |
|---|---|---|---|
| Twemoji 替换网页 emoji 字体 (`twemoji-everywhere`) | 开 | 全部 | Map Segoe UI Emoji / Apple Color Emoji / Noto Color Emoji to the locally installed Twemoji (COLR) font. Download Twemoji for Windows: https://github.com/10ta/twemoji-color-font/releases/latest/download/Twemoji.ttf|
<!-- modules:end -->

（上表由构建脚本根据 `src/modules/` 自动生成，不要手动修改。）

## 新增功能

```bash
npm run new -- my-feature "我的新功能"   # 生成 src/modules/my-feature.js
# 编辑 run(ctx) 里的逻辑
npm run build                            # 本地构建到 dist/toolkit.user.js
```

把 `dist/toolkit.user.js` 的内容粘贴进 Tampermonkey 就能在本地测试。确认没问题后 push 到 main，GitHub Actions 会自动构建、发布 Release，已安装的脚本随后自动更新。

模块写法：

```js
register({
  id: 'my-feature',                 // 唯一 ID，也是开关的存储键，发布后不要再改
  name: '我的新功能',               // 菜单显示名称
  description: '一句话说明',
  enabledByDefault: false,          // 首次安装时是否默认开启
  match: [/(^|\.)example\.com$/],   // 只在这些域名生效；省略则对所有网站生效
  run(ctx) {
    ctx.addStyle('body { ... }');           // 注入 CSS
    ctx.onReady(() => { /* 操作 DOM */ });  // 等 DOM 就绪
    ctx.get('key', 默认值);                 // 本模块私有存储
    ctx.set('key', 值);
    ctx.log('调试信息');
  },
});
```

`run` 在 `document-start` 阶段执行，注入样式不会闪烁；需要操作页面元素时放进 `ctx.onReady`。每个模块在独立作用域里运行，顶层变量不会互相冲突。

## 目录结构

```
src/core.js           模块注册、开关菜单、运行时
src/modules/*.js      每个文件一个功能（以 _ 开头的文件不会被打包）
scripts/build.mjs     构建：拼接、语法检查、生成 README 功能表
scripts/new-module.mjs 新建模块模板
```

版本号格式为 `年.月.日.构建序号`，保证每次发布都比上一次大，Tampermonkey 能正确识别更新。
