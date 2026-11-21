---
name: track-duration-editor
overview: 把每曲时长做成 rkgk 曲目行的可编辑语法（曲目名后跟 (01:38)），解析/写出/Preview/trackTable 全链路支持；在「导入」按钮右侧新增独立曲目表粘贴面板（格式 1/2/pipe、艺术家顺序选项）；BGM 导入使用 API 每曲时长；单 Disc 汇总、多 Disc 仅 DISC 行写入 Infobox；维基端 userscript 消费 trackTable 第 5 列。
todos:
  - id: grammar-duration
    content: Use [subagent:code-explorer] to audit Track/duration call sites; add the duration grammar node, rebuild wasm, and update lang-rkgk/Track parsing.
    status: completed
  - id: writer-duration
    content: Update common.Track and buildDurationValue options; write duration in trackInfoWriter; update Preview, trackTable column 5 and Infobox sync.
    status: completed
    dependencies:
      - grammar-duration
  - id: paste-panel
    content: Implement tracklist.ts for formats 1/2/pipe and artist order; add TrackListPaste panel to the right of the Import button.
    status: completed
    dependencies:
      - writer-duration
  - id: bgm-sources
    content: Add SubjectEpInfo.duration and BGM length option; preserve duration in staffPatch; write durations in VocaDB and Tower.
    status: completed
    dependencies:
      - writer-duration
  - id: userscript-duration
    content: Update trackTableCommentedKeys to target column 4 or 5 and verify ep_list duration merge.
    status: completed
    dependencies:
      - writer-duration
  - id: verify-duration
    content: Verify grammar round-trip, formats 1/2/pipe, editor edits, BGM 728832, userscript, svelte-check and build; clean up temp scripts.
    status: completed
    dependencies:
      - paste-panel
      - bgm-sources
      - userscript-duration
---

## 产品概述

为工具端补齐每首曲目时长的解析、编辑、导出与维基端填充链路。时长不进入 patch，只用于曲目表的第 5 列和 Infobox 的播放时长；曲目表格式通过「导入」按钮右侧的独立粘贴面板识别。

## 核心功能

- rkgk 曲目行支持可编辑时长语法：曲目名后跟 `(01:38)` / `(1:39)` / `(01:02:03)`，解析、写出、Preview 全链路一致。
- 标题自身的普通括号（如 `Defectus(Intro)`）不被误判为时长。
- 「导入」按钮右侧新增独立「曲目表」粘贴面板，支持：
- 格式 1：`1. 后空 - 神遛儿 (01:38)`；
- 格式 2：`01<TAB>Defectus(Intro)<TAB>1:39`；
- 站内 pipe：`光盘编号|曲目编号|原文标题|简体中文标题|时长`。
- 提供「曲目名在前 / 艺术家在前」顺序选项；艺术家写入每首曲目的 `艺术家` credit，形成 `曲目名` 加 `艺术家：艺术家名`。
- 单 Disc：所有曲目时长求和，写入 Infobox `播放时长`，统一 `hh:mm:ss`。
- 多 Disc：只写 `[DISC 1|...]`、`[DISC 2|...]` 等 DISC 行，不写总时长行。
- BGM 导入使用 BGM API 的每曲时长，填充每曲时长、trackTable 第 5 列和 Infobox。
- 工具导出的 trackTable 第 5 列写入 `hh:mm:ss`；维基端 userscript 的「章节一键填注释」消费该列。
- VocaDB / Tower 等已有每曲秒数的导入源同步写入 `Track.duration`。
- 不修改 patch 的 trackCredits / epinfo 结构。

## 技术栈

- 现有 SvelteKit + TypeScript 项目，无新增运行时依赖。
- 语法层使用仓库内 `tree-sitter-rkgk` 与 `web-tree-sitter`；新增时长节点后重新生成 wasm。
- 曲目表解析、时长计算、导入源扩展均在现有 `src/lib/importSource` 与 `src/routes` 体系内完成。

## 实现方案

### 1. rkgk 语法与数据模型

- 修改 `tree-sitter-rkgk/grammar.js`：
- 新增 `duration` 规则，匹配标题后的 `(m:ss)` / `(hh:mm:ss)`，放在 `// comment` 之前；
- 通过词法优先级保证 `Defectus(Intro)` 的 `(Intro)` 不被识别为时长；
- 语法形态为「标题 + optional duration + optional comment」。
- 重新生成 wasm：
- 在 `tree-sitter-rkgk` 下运行 `tree-sitter generate` 与 `tree-sitter build --wasm`；
- 同步 `static/tree-sitter-rkgk.wasm` 与 `tree-sitter-rkgk/tree-sitter-rkgk.wasm`。
- `src/routes/lang-rkgk.ts`：
- `NODE_TYPES`、`SEMANTIC_TYPES` 加入 `duration`；
- `RawTrack` 增加 `duration: number | null`；
- `intoRawTrack` 识别 `duration` 节点，用 `durationToSeconds` 转秒，不再进入 unknown children。
- `src/routes/postprocess.ts`：
- `Track` 增加 `duration?: number`；
- `fromRawRelease` 把时长写入每首 `Track`；
- `Preview.svelte` 在曲目名后以低调样式显示时长。

### 2. 写出与 Infobox

- `src/lib/importSource/common.ts`：
- `Track` 增加 `duration?: number`（秒）；
- `buildDurationValue` 增加 `includeTotal?: boolean`：默认 true 保持兼容；传 false 时多 Disc 只返回 DISC 行；单 Disc 仍返回总和的 `hh:mm:ss`。
- `src/routes/trackInfoWriter.ts`：
- `writeTrackInfoCreditImport` / `Parts` / `Tracks` 在标题后写  `(hh:mm:ss)`，再写 `// comment`；
- `fromFormalRelease` 复制 `Track.duration`；
- `partsTracksConverter` 切换风格时时长不丢失。
- `src/routes/+page.svelte`：
- `marshal` 的 trackTable 第 5 列改为每曲时长的 `hh:mm:ss`；
- 监听 `currentRelease` 的每曲时长变化：单 Disc 全部有值时写总和；多 Disc 每碟都有值时写仅 DISC 行；缺值跳过，不输出残值；
- 用户仍可手动修改 Infobox，手动修改后再编辑曲目时长的行为保持一致。
- 编辑器手动修改 `(01:38)` 后，解析结果、Preview、trackTable 第 5 列、Infobox 同步更新。

### 3. 「导入」按钮右侧的曲目表粘贴面板

- 新增 `src/routes/TrackListPaste.svelte`：
- 工具栏「导入…」按钮右侧新增「曲目表」按钮；
- 面板包含 textarea、「曲目名在前 / 艺术家在前」选项、填入按钮；
- 独立于 ImportDialog 的 URL 源列表。
- 新增 `src/lib/importSource/tracklist.ts`：
- `parseTrackList(text, { artistFirst })` 返回 `common.Release`；
- pipe：第 3 列标题、第 4 列注释/简体中文标题、第 5 列时长；
- TSV：编号、曲目名、时长；
- 格式 1：编号、曲目名、艺术家、时长；
- `artistFirst` 决定  `- ` 左侧/右侧哪边是艺术家；艺术家写入 `Track.credits.艺术家`；
- 时长统一 `durationToSeconds`，按曲目号排序并生成 discs/tracks。
- 面板调用 `editor.setTrackInfo(release, 'import')`，时长随标题写入编辑器；同时写入 Infobox 播放时长。

### 4. BGM 导入与现有导入源

- `src/lib/client.ts`：`SubjectEpInfo` 增加 `duration?: number | string`；`getSubjectEpInfo` 保留并归一化时长。
- `src/lib/bangumiUtils.ts`：`assembleRelease` 把每曲时长写入 `Track.duration`。
- `src/lib/importSource/bangumi.ts`：
- 增加 `length`（播放时长，默认 true）选项；
- 计算每曲秒数、每碟秒数、总秒数；完整时写 Infobox；
- patch 分支继续使用 `applyStaffPatchToRelease`，时长由 base 保留。
- `src/lib/importSource/staffPatch.ts`：`applyStaffPatchToRelease` 复制 base 的 `Track.duration`，patch 只替换 credits。
- `src/lib/importSource/vocadb.ts` / `towerjp.ts`：写入 `Track.duration`；多 Disc 使用 `includeTotal: false`。

### 5. 维基端 userscript

- 修改 `bangumiscripts/音乐条目显示各曲目参与制作人员信息 ++ 维基端.user.js`：
- `trackTableCommentedKeys` 改为第 4 列或第 5 列非空都纳入「章节一键填注释」靶向；
- 提示文案改为「带注释/时长」；
- `mergeTrackTableIntoEpList` 已按列覆盖，第 5 列直接写入站内 ep_list。

## 数据流

```mermaid
flowchart LR
  A[曲目表文本或 BGM API] --> B[TrackList 解析或 assembleRelease]
  B --> C[common.Release Track.duration]
  C --> D[writeTrackInfo 写出标题与时长]
  D --> E[TrackInfo 编辑器解析]
  E --> F[postprocess Track.duration]
  F --> G[trackTable 第 5 列]
  F --> H[Infobox 播放时长]
  G --> I[维基端 userscript]
  I --> J[站内 ep_list 第 5 列]
```

## 目录结构

```
tree-sitter-rkgk/
├── grammar.js                         # [MODIFY] song 增加 duration 节点
└── tree-sitter-rkgk.wasm              # [MODIFY] 重新生成

static/
└── tree-sitter-rkgk.wasm              # [MODIFY] 同步 wasm

src/routes/
├── lang-rkgk.ts                       # [MODIFY] RawTrack.duration、duration 节点、SEMANTIC_TYPES
├── treeSitterParser.ts                # [MODIFY] semanticTypes 同步（如需要）
├── postprocess.ts                     # [MODIFY] Track.duration、fromRawRelease
├── trackInfoWriter.ts                 # [MODIFY] 写出时长、fromFormalRelease 保留时长
├── Preview.svelte                     # [MODIFY] 曲目名后显示时长
├── TrackListPaste.svelte              # [NEW] 导入按钮右侧的曲目表粘贴面板
├── ImportDialog.svelte                # [NO CHANGE] URL 源列表保持原样
└── +page.svelte                       # [MODIFY] 曲目表按钮、trackTable 第 5 列、Infobox 同步

src/lib/
├── importSource/
│   ├── common.ts                      # [MODIFY] Track.duration、buildDurationValue 选项
│   ├── tracklist.ts                   # [NEW] 格式 1/2/pipe 解析与 TrackList
│   ├── bangumi.ts                     # [MODIFY] length 选项、BGM API 时长
│   ├── staffPatch.ts                  # [MODIFY] 保留 duration
│   ├── vocadb.ts                      # [MODIFY] Track.duration、includeTotal:false
│   ├── towerjp.ts                     # [MODIFY] Track.duration、includeTotal:false
│   └── index.ts                       # [MODIFY] 导出 TrackList
├── client.ts                          # [MODIFY] SubjectEpInfo.duration
└── bangumiUtils.ts                    # [MODIFY] assembleRelease 写入 duration

bangumiscripts/
└── 音乐条目显示各曲目参与制作人员信息 ++ 维基端.user.js  # [MODIFY] 第 4/5 列靶向
```

## 关键代码结构

```ts
export interface Track {
  title: string;
  comment: string;
  duration?: number;
  credits: Credits;
}

export function buildDurationValue(
  discSeconds: (number | null)[],
  totalSeconds: number,
  options?: { includeTotal?: boolean }
): string | [string, string][];

export interface TrackListParseOptions {
  artistFirst?: boolean;
}

export function parseTrackList(text: string, options?: TrackListParseOptions): Release;
```

## 实现注意

- 语法优先级：`duration` 必须是标题后的独立节点；`(Intro)` 这类普通括号不能被误判；`// comment` 仍可跟在时长后。
- wasm 重建后要同时更新 `static/` 与 `tree-sitter-rkgk/` 下的产物，并验证 `TrackInfo` 能加载新 grammar。
- `Track.duration` 可选，现有导入源、`fromFormalRelease`、`writeTrackInfo` 不受影响。
- `buildDurationValue` 默认行为保持不变，新功能显式传 `includeTotal: false`。
- 时长只进入曲目表/Infobox，不进入 patch 的 trackCredits / epinfo。
- 手动编辑时长与自动计算 Infobox 的覆盖顺序要明确：仅在曲目时长完整时写入，缺值不输出残值。
- userscript 只有第 5 列时也要能靶向；第 4 列注释路径不能回归。

## 验证

- 语法：`曲目名 (01:38)`、`曲目名 (1:39) // 注释`、`曲目名 (01:02:03)` 解析为 duration；`Defectus(Intro)` 不受影响；写出后重新解析时长不变。
- 编辑器：手动把 `(01:38)` 改为 `(02:00)`，Preview、trackTable 第 5 列、Infobox 同步。
- 格式 1/2/pipe：曲目数、标题、艺术家、时长正确；两种艺术家顺序均得到预期结果。
- BGM 728832：`SubjectEpInfo.duration` 写入每曲；trackTable 第 5 列非空；单 Disc Infobox 为总和。
- 多 Disc：Infobox 仅 DISC 行。
- userscript：只有第 5 列的 trackTable 也能靶向并写入 ep_list 第 5 列；第 4 列注释不回归。
- VocaDB / Tower：trackTable 第 5 列有值。
- `svelte-check` 无新增错误；`npm run build` 通过；清理临时测试脚本。

## Agent Extensions

### SubAgent

- **code-explorer**
- Purpose: 审计 `Track`、`Release`、`buildDurationValue`、`trackTable`、`TrackInfo` 的所有调用点，确认新增 `duration` 字段、grammar 节点与 `includeTotal` 选项不会漏传或破坏现有导入源。
- Expected outcome: 产出调用点清单、风险点与需要同步修改的文件列表，作为数据模型与语法改动的依据。