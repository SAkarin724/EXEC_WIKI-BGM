---
name: Alt 键复制曲目表
overview: 让「复制 Patch」按钮在悬停并按住 Alt 时切换为复制当前 Release 的曲目表（光盘|曲目|原文标题|简体中文标题|时长），其余修饰键行为保持不变。
todos:
  - id: extract-track-table
    content: 在 +page.svelte 提取 buildTrackTable 并让 marshal 复用
    status: completed
  - id: alt-copy-mode
    content: 新增 useAltOnCopy 状态，扩展 copyPatch 支持曲目表复制与空数据提示
    status: completed
    dependencies:
      - extract-track-table
  - id: button-labels
    content: 更新复制 Patch 按钮文案与 title，Alt 优先于 Shift
    status: completed
    dependencies:
      - alt-copy-mode
  - id: verify-ui
    content: 使用 [skill:playwright-cli] 验证 Alt 切换、剪贴板格式与控制台
    status: completed
    dependencies:
      - button-labels
---

## 产品概述

在现有工具主页面的「复制 Patch」按钮上增加 Alt 修饰键模式：鼠标悬停并按住 Alt 时，按钮切换为「复制曲目表」；点击后把当前条目的曲目信息按管道分隔文本复制到剪贴板。

## 核心功能

- 悬停「复制 Patch」按钮并按住 Alt：按钮文案与悬浮提示切换为「复制曲目表」。
- 点击输出当前所有碟片的曲目表，列顺序为：光盘|曲目|原文标题|简体中文标题|时长；每行一条曲目，无字面表头行。
- 时长沿用现有 hh:mm:ss 格式化；未填写时该列留空。
- 保留默认「复制 Patch」与 Shift「复制全部 Patch」行为；Alt 与 Shift 同时按下时 Alt 优先。
- 当前没有曲目数据时给出提示，不写入空剪贴板。

## 技术栈

沿用现有项目：SvelteKit 2 + Svelte 5（runes）+ TypeScript + UnoCSS；校验命令为 `npm run check`、`npm run lint`。

## 实现思路

主要修改 `src/routes/+page.svelte`：

1. 把 `marshal()` 中生成 `trackTable` 的表达式提取为独立纯函数（如 `buildTrackTable(release)`），`marshal()` 改为调用它，避免复制逻辑与打包逻辑两处格式漂移。
2. 新增派生状态 `useAltOnCopy = $derived(hoverCopyPatchBtn && optMode)`；`optMode` 已由 `syncModifiers()` 从实时 `e.altKey` 更新，窗口 blur 时也会清除，无需新增事件监听。
3. 扩展 `copyPatch()`：按 Alt > Shift > 默认 的优先级分派。Alt 分支调用 `buildTrackTable(currentRelease)`，空表时 toast 提示，否则写入剪贴板并 toast「已复制曲目表到剪贴板」。
4. 按钮的 `title` 与显示文案增加 Alt 分支，保证文案与实际复制内容一致；按钮宽度 `w-31` 已足够容纳「复制曲目表」，无需改布局。

## 实现注意

- 只改主页面文件，不调整 `marshal()` 返回结构，JSON 打包内容保持向后兼容。
- `secondsToHMS` 已在文件顶部导入，直接复用，不新增依赖。
- 不输出字面表头行：`src/lib/importSource/tracklist.ts` 会把含 `|` 的每行都当数据解析，表头会被误识别为曲目。
- 修饰键沿用「悬停按钮才生效」的既有交互，避免裸按 Alt 改变按钮状态。
- 性能：`buildTrackTable` 是一次 O(曲目数) 的线性拼接，仅在点击时执行；提取为纯函数不增加响应式依赖，也不影响渲染。

## 目录结构

```
e:/Programs/EXEC_WIKI-BGM/
└── src/routes/
    └── +page.svelte  # [MODIFY] 提取 buildTrackTable 供 marshal 与复制分支复用；新增 useAltOnCopy 派生状态；扩展 copyPatch 的 Alt 分支与空数据提示；更新按钮 title/文案（Alt 优先于 Shift）
```

## Agent Extensions

### Skill

- **playwright-cli**
- Purpose: 在本地 dev server 中自动化验证「复制 Patch」按钮的 Alt 悬停切换、点击复制内容与剪贴板文本格式。
- Expected outcome: 确认默认、Shift、Alt 三种状态下按钮文案正确；Alt 点击后剪贴板为 `光盘|曲目|原文标题|简体中文标题|时长` 对应的管道分隔数据行且无表头；控制台无异常。