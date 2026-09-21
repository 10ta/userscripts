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
| 解除复制/右键限制 (`remove-web-limits`) | 按网站（预置 61 个） | 全部 | Unblock copy, cut, text selection and the context menu on sites that disable them. |
| Twemoji 替换网页 emoji 字体 (`twemoji-everywhere`) | 开 | 全部 | Map Segoe UI Emoji / Apple Color Emoji / Noto Color Emoji to the locally installed Twemoji (COLR) font. |
<!-- modules:end -->

（上表由构建脚本根据 `src/modules/` 自动生成，不要手动修改。）

## 按网站开关的数据保存

按网站开关的"正式名单"是模块代码里的 `defaultSites`，跟随仓库同步到所有浏览器。在菜单里切换只会在当前浏览器记录**本地改动**（额外开启 / 额外关闭的网站），叠加在正式名单之上：

- 本地改动保存在 Tampermonkey 的脚本存储里，脚本更新不会丢失；删除脚本、卸载扩展或重置浏览器时会丢失。每个浏览器各自一份。
- 有本地改动时，菜单会出现 **📋 导出本地网站改动**：复制成可以直接粘贴进 `defaultSites` 的格式。整理进代码并 push 后，所有浏览器都会生效。
- 写回代码后，可以用 **🧹 清除本地网站改动** 清空本地记录（不清也没关系，已经写进名单的"额外开启"会自动变成多余项）。

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
  // scope: 'site',                  // 改为按网站开关（菜单显示"（本站）"），此时忽略 enabledByDefault
  // defaultSites: ['example.com'],  // 按网站开关时，默认开启的网站（含其子域名）
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

```
src/core.js           模块注册、开关菜单、运行时
src/modules/*.js      每个文件一个功能（以 _ 开头的文件不会被打包）
scripts/build.mjs     构建：拼接、语法检查、生成 README 功能表
scripts/new-module.mjs 新建模块模板
```

版本号格式为 `年.月.日.构建序号`，保证每次发布都比上一次大，Tampermonkey 能正确识别更新。

## 致谢与许可

`src/modules/remove-web-limits.js` 基于 [Cat73/remove-web-limits](https://github.com/Cat7373/remove-web-limits) 及 [qxin 的修改版](https://github.com/qxinGitHub/Remove-web-limits-) 重写，原项目采用 LGPLv3 许可。

