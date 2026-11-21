---
name: fix-infobox-duration-per-disc
overview: 修复「曲目表识别」在多碟/部分碟缺时长时不写 Infobox「播放时长」的问题：改为按碟判断完整度，只写已完整获得时长的碟；多碟格式为 `{ [DISC 1|hh:mm:ss] ... }`（不含总时长行），单碟为单值 `hh:mm:ss`。
todos:
  - id: rewrite-duration-core
    content: 在 common.ts 重写 buildDurationValue 并新增 discSecondsOf、applyDurationField
    status: completed
  - id: update-import-callers
    content: 改造 bangumi/vocadb/musicbrainz/towerjp 与 TrackListPaste 的时长写入逻辑
    status: completed
    dependencies:
      - rewrite-duration-core
  - id: fix-page-duration-effect
    content: 重写 +page.svelte 播放时长同步 effect 并删除调试开关
    status: completed
    dependencies:
      - rewrite-duration-core
  - id: verify-duration-output
    content: 运行 check 并在 dev server 验证单碟/多碟/部分碟三种 Infobox 输出
    status: completed
    dependencies:
      - update-import-callers
      - fix-page-duration-effect
---

## 用户需求

曲目表识别/导入拿到的时长应正确写入 Infobox 的「播放时长」字段，并按用户给定的格式规则输出。

## 现状问题（本次要修的三点）

1. **一碟不完整就整条不写**：当前 `fill()`、导入源与页面同步 effect 都要求「所有碟全部曲目都有时长」才写入；用户只补到 DISC 1 的 10 首（DISC 2 无时长）时，Infobox 里什么都不出现。
2. **多碟多写了「总时长」行**：多碟形态被写成 `{ [总时长] [DISC 1|x] ... }`，与用户规则冲突。
3. **上一轮的错误改动需回滚**：`TrackListPaste.svelte` 里的「总时长」注释与 `includeTotal` 默认行为、`+page.svelte` 中的 `globalThis.__DISABLE_DURATION_EFFECT__` 调试开关、`bangumi.ts`/`vocadb.ts` 被移除的 `includeTotal: false`。

## 目标格式规则（以用户描述为准）

- 单碟、曲目时长齐备：单行 `|播放时长= hh:mm:ss`（等效 `{ [hh:mm:ss] }`）。
- 多碟：多行形态 `{ [DISC 1|hh:mm:ss] [DISC 2|hh:mm:ss] ... }`，**不写总时长行**。
- 多碟且部分碟完整：只写已完整碟的条目，例如 `{ [DISC 1|39:29] }`（用户期望「该 DISC 的时长被填充」）。
- 完全没有可用时长：不新增、不改动该字段（不留残值、不写空数组）。
- 字段默认往往不存在：需要在 Infobox 中新增该行；已存在空行则原地替换。
- 时长统一样式 `hh:mm:ss`（含小时补零）。

## 视觉/交互效果

在 Infobox 面板中，「播放时长」行随曲目时长的变化自动出现并被填充：单碟显示为直接输入的 `hh:mm:ss` 文本；多碟显示为可展开的键值列表（每行一个 `DISC N`），不出现空的总时长行。曲目时长后续补全时该字段自动刷新为新结果，用户无需手动点按钮。

## 现状核实（已读代码）

- `src/lib/importSource/common.ts:142-154` `buildDurationValue(discSeconds, totalSeconds, { includeTotal })`：`includeTotal !== false` 时插入 `["", 总时长]` 首行；且只有「多于 1 碟且全碟齐备」才走多级，否则退化为单行总时长。
- `src/routes/TrackListPaste.svelte:37-48`：`discSeconds` 中不完整碟为 `null`，随后 `every(...)` 要求全部为数字才写入（且注释/行为已按「总时长行」写错）。
- `src/routes/+page.svelte:238-255`：`$effect` 中 `all.some((s) => s == null || s <= 0)` 直接 `return`，任一首缺时长即整条跳过；并残留调试开关 `globalThis.__DISABLE_DURATION_EFFECT__`。
- `src/lib/importSource/bangumi.ts:80-93`、`vocadb.ts:77-95`（`complete` 为整专辑标志，不完整时 `discSeconds=[]`）、`musicbrainz.ts:99-110`、`towerjp.ts:48-60`：各自重复「碟完整度 + 累加」逻辑，写入方式不一致。
- `src/routes/InfoBox.svelte:78-93` `editField(key, value, { editOnly })` → `editRich([[key, value]], valueWiki.data)`；`src/lib/richInfoBox/RichInfoBox.svelte:45-79` `edit()` 中 `if (!val && i === -1) return;`、`valueWiki[i][1] = v`，数组值由 `PlainArray` 渲染（`RichInfoBox.svelte:216-229`）。
- 默认模板 `src/routes/Settings.svelte:31` 已含 `|播放时长= ` 空行，故写入为原地替换；`src/lib/richInfoBox/lintConfig.ts:50-61 `的 `autofixDuration` 会把每个值单元格归一为 `hh:mm:ss`，与本方案口径一致。
- 项目无测试框架（`package.json` 仅 `check`/`lint`/`build`），验证走 `npm run check` + dev server 实测。

## 实现策略

1. **`common.ts` 作为唯一真源**，把「碟时长计算 + 字段写入」收敛为两个函数，消除 5 处重复：

- `discSecondsOf(discs)`：沿用各调用方相同的判定（`disc.tracks` 非空且每首 `duration` 为正数才累加），返回 `(number | null)[]`。
- `buildDurationValue(discSeconds, totalSeconds, opts)`：按「逐碟独立」重写，默认**不写总时长行**，无可用数据时返回 `null`。
- `applyDurationField(editor, discSeconds, totalSeconds)`：`null` 时跳过，否则 `editor.setInfoBoxField('播放时长', value)`，返回是否写入。

2. **判定改为逐碟**：任一碟曲目齐备即产出该碟条目；多碟只列已完整的碟；单碟完整走单行。
3. **写入与总时长解耦**：`totalSeconds` 仅用于「无任何碟齐备」时的单行回退（如 tower.jp 的「合計収録時間」），不参与多碟形态。
4. **页面同步 effect 重写**：签名改为「最终字段值的序列化串」，避免重复写入与残值；`null` 不写、且清空签名以便后续补全时再次触发。

关键接口（唯一代码片段）：

```ts
export function discSecondsOf(discs: Disc[]): (number | null)[];

export function buildDurationValue(
    discSeconds: (number | null)[],
    totalSeconds: number,
    options?: { includeTotal?: boolean }   // 默认 false：多碟不写总时长行
): string | [string, string][] | null;     // null = 不写

export function applyDurationField(
    editor: AutoEditor,
    discSeconds: (number | null)[],
    totalSeconds: number
): boolean;
```

## 逐碟形态判定表

| discSeconds | 结果 |
| --- | --- |
| 无任何有效碟 | `null`（若 `totalSeconds > 0` 则回退单行 `hh:mm:ss`） |
| 单碟且有效 | 单行 `hh:mm:ss` |
| 多碟、全部有效 | `[["DISC 1","hh:mm:ss"], ...]`，无总时长行 |
| 多碟、部分有效 | 仅列有效碟的 `["DISC i", ...]` |
| 多碟、无一有效 | 同「无任何有效碟」 |


## 执行注意点

- **绝不能把 `null` 传给 `editField`**：`edit()` 只在「值为空且行不存在」时跳过；若行已存在会被赋 `null`，`PlainArray` 渲染即报错。写入前必须 `value != null` 判断。
- 回滚项：删除 `+page.svelte` 的 `__DISABLE_DURATION_EFFECT__` 调试行；删除 `TrackListPaste.svelte:45-47` 的「总时长」注释；`towerjp.ts:59` 的显式 `{ includeTotal: false }` 可移除（新默认即为不写总时长）。
- `vocadb.ts` 需把整专辑 `complete` 标志改为逐碟累计（先按 `discNumber` 分组，再对每碟判断），否则本次修复对它无效。
- 保持 `secondsToHMS`（固定 `hh:mm:ss`）不变；不要引入 `mm:ss` 变体，避免与 Infobox 归一规则冲突。
- 兼容性：`buildDurationValue` 返回值新增 `null`，所有调用点都要判空；`infoBox.editField` 与 `AutoEditor` 签名不变，无跨模块破坏。
- 性能：全部为 O(曲目数) 的纯计算；effect 以序列化值做签名短路，避免重复写 `$state` 引发的额外渲染。
- 不改动 `writeTrackInfo` / 曲目行格式（曲目里仍是 `mm:ss`），本次只改 Infobox 的「播放时长」。

## 目录结构

```
src/
├── lib/importSource/
│   ├── common.ts        # [MODIFY] 重写 buildDurationValue（逐碟、无总时长行、null 语义）；新增 discSecondsOf / applyDurationField
│   ├── bangumi.ts       # [MODIFY] 用 discSecondsOf + applyDurationField 替换 80-93 行重复逻辑
│   ├── vocadb.ts        # [MODIFY] 按 discNumber 分组逐碟判断，改用 applyDurationField
│   ├── musicbrainz.ts   # [MODIFY] 改用 applyDurationField（默认不再写总时长行）
│   └── towerjp.ts       # [MODIFY] 移除 includeTotal 显式参数，改用 applyDurationField
└── routes/
    ├── TrackListPaste.svelte  # [MODIFY] fill() 用 discSecondsOf + applyDurationField；删除「总时长」注释
    └── +page.svelte           # [MODIFY] 重写播放时长同步 $effect（逐碟 + 序列化签名 + null 跳过）；删除调试开关
```

## 验证方案

1. `npm run check` 通过（类型：`null` 返回值需在所有调用点收窄）。
2. dev server（`http://127.0.0.1:5199/`）实测三组数据：

- 两碟 + 只补 DISC 1 → Infobox 出现 `播放时长 = { [DISC 1|...] }`；
- 两碟全部补全 → `{ [DISC 1|...] [DISC 2|...] }`，无总时长行；
- 单碟补全 → `|播放时长= hh:mm:ss` 单行。

3. 回归：清空曲目或删掉某首时长后，不出现空数组/`null` 行；再次补全能自动刷新。