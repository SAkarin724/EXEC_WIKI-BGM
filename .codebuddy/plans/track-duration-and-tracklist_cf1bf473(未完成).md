---
name: track-duration-and-tracklist
overview: 为工具端增加曲目表时长的解析与导出：支持两种曲目表格式、两种「曲目名/艺术家」顺序，填充每曲时长与 trackTable 第 5 列；单 Disc 汇总为 Infobox 播放时长，多 Disc 只写 DISC 行；BGM 导入使用 API 每曲时长；维基端「章节一键填注释」消费第 5 列时长。
todos:
  - id: duration-model
    content: 用 [subagent:code-explorer] 审计 Track/duration 调用点；补 Track.duration、SubjectEpInfo.duration 与 buildDurationValue 的 includeTotal 选项。
    status: pending
  - id: tracklist-import
    content: 实现 TrackList 解析器（格式 1/2/pipe、艺术家顺序选项），并在导入对话框加入粘贴面板，写出曲目信息与播放时长。
    status: pending
    dependencies:
      - duration-model
  - id: bgm-durations
    content: BGM 导入增加 length 选项，使用 SubjectEpInfo.duration；staffPatch 保留 duration；+page 填充 trackTable 第 5 列。
    status: pending
    dependencies:
      - duration-model
  - id: source-durations
    content: VocaDB/Tower 补 Track.duration，并把多 Disc 播放时长改为仅 DISC 行。
    status: pending
    dependencies:
      - duration-model
  - id: userscript-duration
    content: 维基端 userscript 的 trackTableCommentedKeys 改为第 4 或第 5 列非空都靶向，验证 ep_list 时长列合并。
    status: pending
    dependencies:
      - bgm-durations
  - id: verify-duration
    content: 验证格式 1/2/pipe、两种艺术家顺序、BGM 728832、trackTable 第 5 列与 userscript；跑 svelte-check/build 并清理临时测试。
    status: pending
    dependencies:
      - tracklist-import
      - bgm-durations
      - source-durations
      - userscript-duration
---

## 需求概述

工具端当前没有每首曲目的时长输入与导出能力。需要补齐从曲目表解析、存储、导出到维基端的完整链路，并让 BGM 条目导入也携带每曲时长。时长不进入 patch，只用于曲目表第 5 列和 Infobox 的 `播放时长`。

## 核心功能

- 支持两种曲目表文本：
- 格式 1：`1. 后空 - 神遛儿 (01:38)`，包含序号、曲目名、艺术家、时长；
- 格式 2：`01\tDefectus(Intro)\t1:39`，包含序号、曲目名、时长；
- 同时支持站内 pipe 往返格式：`光盘编号|曲目编号|原文标题|简体中文标题|时长`。
- 提供「曲目名在前 / 艺术家在前」顺序选项：
- 曲目名在前：`后空 - 神遛儿` 解析为曲目 `后空`、艺术家 `神遛儿`；
- 艺术家在前：`神遛儿 - 后空` 解析为曲目 `后空`、艺术家 `神遛儿`；
- 艺术家写入每首曲目的 `艺术家` credit，最终曲目信息形如 `曲目名` 加 `艺术家：艺术家名`。
- 时长统一为 `hh:mm:ss` 显示：
- 单 Disc：所有曲目时长求和，写入 Infobox 的 `播放时长`；
- 多 Disc：只写 `[DISC 1|...]`、`[DISC 2|...]` 等 DISC 行，不写总时长行。
- BGM 导入使用 BGM API 返回的每曲时长，填充每曲时长、trackTable 第 5 列和 Infobox。
- 工具导出的 `trackTable` 第 5 列写入每曲时长；维基端 userscript 的「章节一键填注释」消费该列。
- VocaDB/Tower 等已有每曲秒数的导入源也写入 `Track.duration`，让 trackTable 第 5 列保持一致。
- 不修改 patch 的 `trackCredits`/`epinfo` 结构。

## 技术栈

- 现有 SvelteKit + TypeScript 项目，无新增运行时依赖。
- 曲目表解析、时长计算、导入源扩展均在现有 `src/lib/importSource` 与 `src/routes` 体系内完成。
- 维基端 userscript 继续沿用现有 `trackTable` 合并与 ep_list 提交逻辑。

## 实现方案

### 1. 数据模型与时长归一

- `src/lib/importSource/common.ts`：
- `Track` 增加可选 `duration?: number`，单位为秒。
- `buildDurationValue(discSeconds, totalSeconds, options?: { includeTotal?: boolean })`：
    - 默认 `includeTotal: true`，保持现有调用方兼容；
    - 新曲目表与 BGM 导入传 `includeTotal: false`，多 Disc 只输出 DISC 行；
    - 单 Disc 仍返回 `secondsToHMS(totalSeconds)`；
    - 多 Disc 且所有碟时长完整时返回 `[["DISC 1", "00:39:14"], ...]`；
    - 任一时长缺失时由调用方跳过 Infobox 写入，避免输出残值。
- `src/lib/client.ts`：
- `SubjectEpInfo` 增加可选 `duration?: number | string`。
- `getSubjectEpInfo` 保留原始 `duration`；数值按秒处理，字符串通过 `durationToSeconds` 转换。
- `src/lib/bangumiUtils.ts`：
- `assembleRelease` 把每曲时长写入 `Track.duration`。
- `src/lib/importSource/staffPatch.ts`：
- `applyStaffPatchToRelease` 复制 base 曲目的 `duration`，保证 patch 只替换 credits 时不丢时长。

### 2. 新「粘贴曲目表」导入源

- 新增 `src/lib/importSource/tracklist.ts`：
- `TrackList implements ImportSource`，持有用户粘贴的文本与 `artistFirst` 选项。
- `parseTrackList(text, { artistFirst })` 返回 `common.Release`：
    - pipe 行按 5 列解析，第 3 列标题、第 4 列注释/简体中文标题、第 5 列时长；
    - TSV 行按 3 到 5 列解析；
    - 格式 1 用行首编号、末尾括号时长和 ` - ` 分隔曲目名/艺术家；
    - `artistFirst` 决定 ` - ` 左右哪边是艺术家；
    - 时长通过 `durationToSeconds` 统一转秒；
    - 艺术家写入 `Track.credits.艺术家`；
    - 按曲目号排序并生成 discs/tracks。
- `apply`：
    - 调 `editor.setTrackInfo(release, 'import')`，保持每首曲目顺序与空行；
    - 计算每碟秒数与总秒数，调 `editor.setInfoBoxField("播放时长", buildDurationValue(..., { includeTotal: false }))`；
    - 不设置 patch、不修改 `trackCredits`。
- `src/routes/ImportDialog.svelte`：
- 增加「粘贴曲目表」面板/按钮，显示文本框与「艺术家在前」复选框；
- 复用当前 `TrackList` 实例，点击导入时调用 `apply`；
- 保留现有 URL 导入源列表与选项。
- `src/lib/importSource/index.ts`：
- 导出 `TrackList` 类型，供 ImportDialog 与测试使用。

### 3. BGM 导入

- `src/lib/importSource/bangumi.ts`：
- `options` 增加 `{ id: "length", text: "播放时长", default: true }`；
- 从 `SubjectEpInfo` 计算每曲秒数、每碟秒数、总秒数；
- 全部曲目时长完整时 `setInfoBoxField("播放时长", buildDurationValue(..., { includeTotal: false }))`；
- patch 分支仍用 `applyStaffPatchToRelease(..., 'import')`，时长由 `staffPatch` 保留；
- 不改动现有 title/intro/infobox/rela 选项。
- `src/routes/+page.svelte`：
- 新增 `trackDurations` 状态（按 `disc.track` 记录秒数）；
- `setTrackInfo` 从 `info.discs` 提取 `duration`，写入 map；`setTrackInfoText` 清空 map；
- `marshal` 生成 trackTable 第 5 列时读取该 map，用 `secondsToHMS` 输出；
- 保留现有 `preserveCircleParenthesesOnNextParse` 逻辑。

### 4. 现有导入源

- `src/lib/importSource/vocadb.ts`：
- 构建 `Disc` 时把 `track.song.lengthSeconds` 写入 `Track.duration`；
- `setInfoBoxField` 改为 `buildDurationValue(..., { includeTotal: false })`。
- `src/lib/importSource/towerjp.ts`：
- `parseDiscInfo` 的每曲秒数写入 `Track.duration`；
- `setInfoBoxField` 改用 `includeTotal: false`。
- 其他没有每曲时长的源保持现状，`trackTable` 第 5 列为空。

### 5. 维基端 userscript

修改 `bangumiscripts/音乐条目显示各曲目参与制作人员信息 ++ 维基端.user.js`：

- `trackTableCommentedKeys` 改为检查第 4 列或第 5 列：
- 只有注释、只有时长、两者都有，都纳入「章节一键填注释」的靶向范围；
- 提示文案从「带注释」调整为「带注释/时长」。
- `mergeTrackTableIntoEpList` 已按列覆盖，无需改动；第 5 列会写入站内 ep_list。
- 验证只有第 5 列时也能提交对应章节，且第 4 列注释路径不回归。

## 数据流

```mermaid
flowchart LR
  A[曲目表文本或 BGM API] --> B[TrackList 解析或 assembleRelease]
  B --> C[common.Release Track.duration]
  C --> D[editor.setTrackInfo import 写法]
  D --> E[+page trackDurations map]
  E --> F[trackTable 第 5 列]
  C --> G[buildDurationValue includeTotal false]
  G --> H[InfoBox 播放时长]
  F --> I[维基端 userscript]
  I --> J[站内 ep_list 第 5 列]
```

## 架构与兼容性

- `Track.duration` 设为可选，现有导入源、`fromFormalRelease`、`writeTrackInfo` 不受影响。
- 时长不进入 rkgk 编辑器文本，避免改变现有语法；通过 `setTrackInfo` 的 release 数据和 `+page` map 传给 trackTable/Infobox。
- `buildDurationValue` 通过选项保持兼容；新功能统一 `includeTotal: false`，已有 VocaDB/Tower 同步改为仅 DISC 行。
- 时长计算复杂度为 O(曲目数)，trackTable 生成与 userscript 合并均为线性，无额外网络请求。

## 目录结构

```
src/lib/importSource/
├── tracklist.ts        # [NEW] 曲目表文本解析、TrackList 导入源、单/多 Disc 时长计算
├── common.ts           # [MODIFY] Track.duration、buildDurationValue 的 includeTotal 选项
├── bangumi.ts          # [MODIFY] BGM 导入增加 length 选项、使用 SubjectEpInfo.duration
├── staffPatch.ts       # [MODIFY] applyStaffPatchToRelease 保留 Track.duration
├── vocadb.ts           # [MODIFY] 写入 Track.duration，多 Disc 仅 DISC 行
├── towerjp.ts          # [MODIFY] 写入 Track.duration，多 Disc 仅 DISC 行
└── index.ts            # [MODIFY] 导出 TrackList

src/lib/
├── client.ts           # [MODIFY] SubjectEpInfo.duration，getSubjectEpInfo 保留时长
└── bangumiUtils.ts     # [MODIFY] assembleRelease 写入 Track.duration

src/routes/
├── ImportDialog.svelte # [MODIFY] 粘贴曲目表面板、艺术家顺序选项
└── +page.svelte        # [MODIFY] trackDurations map、marshal 第 5 列

bangumiscripts/
└── 音乐条目显示各曲目参与制作人员信息 ++ 维基端.user.js  # [MODIFY] 第 4/5 列靶向、ep_list 时长
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

## 验证

- 格式 1 单 Disc：10 首曲目、艺术家 credit、时长、单 Disc 总和 `hh:mm:ss`。
- 格式 2 单 Disc：10 首曲目、时长正确、无艺术家 credit。
- pipe 多 Disc：标题/注释/时长往返正确，多 Disc 只输出 DISC 行，不输出总时长。
- 两种艺术家顺序：`后空 - 神遛儿` 与 `神遛儿 - 后空` 均得到曲目 `后空`、艺术家 `神遛儿`。
- BGM 728832：`SubjectEpInfo.duration` 写入每曲；trackTable 第 5 列非空；单 Disc `播放时长` 为总和。
- userscript：只有第 5 列的 trackTable 也能靶向并写入 ep_list 第 5 列；第 4 列注释不回归。
- VocaDB/Tower：trackTable 第 5 列有值，多 Disc 仅 DISC 行。
- `svelte-check` 无新增错误；`npm run build` 通过；清理临时测试脚本。

## Agent Extensions

### SubAgent

- **code-explorer**
- Purpose: 审计 `Track`、`Release`、`buildDurationValue`、`trackTable` 的所有调用点，确认新增 `duration` 字段和 `includeTotal` 选项不会漏传或破坏现有导入源。
- Expected outcome: 产出调用点清单、风险点与需要同步修改的文件列表，作为数据模型改动和验证的依据。