# Toolkit 自用油猴脚本合集

一个脚本，多个小功能。每个功能在 Tampermonkey 菜单里有独立开关（✅ 开 / ⬜ 关），点一下切换并自动刷新页面。只显示对当前网站生效的功能。

开关分两种：全局开关对所有网站生效；标有"（本站）"的是按网站开关，只对当前网站开启或关闭（例如解除复制限制，只在需要的网站上开）。

## 安装

安装 Tampermonkey（或 Violentmonkey）后，打开下面的链接即可安装，之后会随 Release 自动更新：

https://github.com/10ta/userscripts/releases/latest/download/toolkit.user.js

## 功能列表

<!-- modules:start -->
| 模块 | 默认 | 作用站点 | 说明 |
|---|---|---|---|
| 字体替换 (`font-inject`) | 按网站（预置 0 个） | 全部 | Use my own sans / serif / mono font stacks on pages, keeping icon fonts intact. |
| 改用衬线字体 (`font-serif`) | 按网站（预置 0 个） | 全部 | Use the serif stack of font-inject on this site. |
| 点时间戳复制 fxtwitter 链接 (`fxtwitter-link`) | 开 | /(^|\.)x\.com$/ /(^|\.)twitter\.com$/ | Post timestamp links on X/Twitter point to fxtwitter.com (tracking parameters removed). |
| 隐藏分享按钮 (`x-hide-share`) | 开 | /(^|\.)x\.com$/ /(^|\.)twitter\.com$/ | Hide the Share button under posts on X/Twitter. |
| 解除复制/右键限制 (`remove-web-limits`) | 按网站（预置 61 个） | 全部 | Unblock copy, cut, text selection and the context menu on sites that disable them. |
| Twemoji 替换 (`twemoji-everywhere`) | 开 | 全部 | Map common emoji font names to the locally installed Twemoji (COLR) font. |
<!-- modules:end -->

（上表由构建脚本根据 `src/modules/` 自动生成，不要手动修改。）

## 独立脚本（standalone）

放在 `standalone/` 目录里的 `*.user.js` 不打包进 Toolkit，而是各自作为独立脚本发布，在 Tampermonkey 里单独安装：每个脚本拥有完整的原生运行环境（自己的 `@grant`、`@run-at`、沙箱），开关用 Tampermonkey 弹出菜单里每个脚本自带的启用开关。构建时会把 `@updateURL` / `@downloadURL` 指向本仓库的 Release，修改脚本时记得提高 `@version`，否则 Tampermonkey 不会更新。

安装链接：

<!-- standalone:start -->
（暂无）
<!-- standalone:end -->

**新功能放哪里：**

- **Toolkit 模块**（`src/modules/`，`register` 写法）：小功能、纯 CSS 或少量事件处理，希望和其他功能共用一个脚本、统一在 Toolkit 菜单里开关，适合按网站开关的功能。
- **独立脚本**（`standalone/`）：现成的第三方脚本；需要 `@grant none` 在网页环境里运行、依赖精确的 `@run-at` 时机、用到 `@require` / `@resource` / `@connect`；逻辑较复杂、希望出问题时不影响其他功能。

## 按网站开关的数据保存

按网站开关的"正式名单"是模块代码里的 `enabledByDefault` 加上例外名单 `defaultSites`，跟随仓库同步到所有浏览器。在菜单里切换只会在当前浏览器记录**本地改动**（额外开启 / 额外关闭的网站），叠加在正式名单之上：

- 本地改动保存在 Tampermonkey 的脚本存储里，脚本更新不会丢失；删除脚本、卸载扩展或重置浏览器时会丢失。每个浏览器各自一份。
- 有本地改动时，对应模块下面会出现 **📋 导出本地改动**：复制成可以直接粘贴进 `defaultSites` 的格式。整理进代码并 push 后，所有浏览器都会生效。
- 写回代码后，可以用 **🧹 清除本地改动** 清空本地记录（不清也没关系，已经写进名单的"额外开启"会自动变成多余项）。

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
  // parent: 'font-inject',          // 在菜单中缩进显示在另一个模块下面（作为它的子选项）
  // scope: 'site',                  // 改为按网站开关（菜单显示"（本站）"）
  // defaultSites: ['example.com'],  // 按网站开关时的例外名单（含子域名）：
  //                                 //   enabledByDefault 为 false 时是"默认开启的网站"，为 true 时是"默认关闭的网站"
  run(ctx) {
    ctx.addStyle('body { ... }');           // 注入 CSS
    ctx.onReady(() => { /* 操作 DOM */ });  // 等 DOM 就绪
    ctx.get('key', 默认值);                 // 本模块私有存储
    ctx.set('key', 值);
    ctx.log('调试信息');
    ctx.host;                               // 当前域名
    ctx.page;                               // 页面真实的 window，用于修改页面自身的 JS
    ctx.expose(fn);                         // 把函数交给页面 JS 调用前先包一层（Firefox 需要）
  },
});
```

`run` 在 `document-start` 阶段执行，注入样式不会闪烁；需要操作页面元素时放进 `ctx.onReady`。每个模块在独立作用域里运行，顶层变量不会互相冲突。

## 目录结构

``` bash
src/core.js           模块注册、开关菜单、运行时
src/modules/*.js      每个文件一个功能（以 _ 开头的文件不会被打包）
scripts/build.mjs     构建：拼接、语法检查、生成 README 功能表
scripts/new-module.mjs 新建模块模板
standalone/*.user.js  独立脚本，单独发布、单独安装
```

版本号格式为 `年.月日.构建序号`（月日、构建序号补零，如 `2026.0922.00020`），保证按数字比较时始终递增，Tampermonkey 能正确识别更新，GitHub 的 Release/Tag 列表也能按正确顺序排列。

## Debug

在控制台查询实际调用名字: 当前示例为merri开头的

```javascript
(await queryLocalFonts())
  .filter(f => /merri/i.test(f.family))
  .map(f => `${f.family} | ${f.fullName} | ${f.style}`)

```

## 致谢与许可

`src/modules/remove-web-limits.js` 基于 [Cat73/remove-web-limits](https://github.com/Cat7373/remove-web-limits) 及 [qxin 的修改版](https://github.com/qxinGitHub/Remove-web-limits-) 重写，原项目采用 LGPLv3 许可。