---
name: merge-disc-info-enhance-into-staff-display
overview: 把「音乐条目 Disc 信息增强」能力合并进「音乐条目显示各曲目参与制作人员信息 ++」，新增从条目简介解析 Disc 命名并内联到曲目列表 Disc 标题，修复品番数量少于 Disc 数时的映射失效，并让独立脚本在合并版存在时自动让位。
todos:
  - id: disc-parse-module
    content: 在 ++ 脚本内建 DISC_META 闭包子模块，移植解析与样式，修正品番区间部分填充
    status: completed
  - id: disc-heading-inline
    content: 实现 Disc 标题内联命名、徽章重建签名去重与 Infobox 摘要详情弹层
    status: completed
    dependencies:
      - disc-parse-module
  - id: disc-per-track
    content: 接入逐曲时长拉取与缓存，改为三处观察加 80ms 防抖 observer
    status: completed
    dependencies:
      - disc-heading-inline
  - id: disc-config-switch
    content: 注册 staffDiscMetaEnabled 云配置开关并实现启停即时重绘
    status: completed
    dependencies:
      - disc-heading-inline
  - id: standalone-yield
    content: 合并版打标记并接管清理，独立脚本检测标记后自动退出并清理自身 DOM
    status: completed
    dependencies:
      - disc-parse-module
  - id: verify-642363
    content: 更新版本号与描述，用 642363 回归验证双装单份显示与开关还原
    status: completed
    dependencies:
      - disc-per-track
      - disc-config-switch
      - standalone-yield
---

## 用户需求

把独立脚本「音乐条目 Disc 信息增强」的能力整合进「音乐条目显示各曲目参与制作人员信息 ++」，同时保证独立脚本在启用状态下不会干扰合并版；并修复品番映射问题、新增 Disc 命名填充。

## 产品概述

在 bgm.tv 音乐条目页，曲目列表的 Disc 标题行由合并后的单脚本统一渲染：标题内联 Disc 命名（如 `Disc 1 - Profectio`），右侧仍保留 `[品番] [时长]` 徽章；Infobox 的多碟「播放时长 / 品番」仍以「摘要 + 详情弹层」呈现；曲目列表仍显示逐曲时长。两个脚本同时安装时页面只出现一套显示，无重复、无闪烁、无互相覆盖。

## 核心功能

- 简介解析：从条目简介尾部按行识别 `Disc N - 名称`（兼容全角/半角连字符、冒号、`DISC` 大小写、行首 `-`/`・`/`*` 前缀），生成 Disc 号到名称的映射，并填入曲目列表对应 Disc 标题。
- Disc 标题渲染：标题文本改为 `Disc N - 名称`（无命名时保持 `Disc N`），右侧徽章顺序仍为 `[品番]` 再 `[时长]`；支持一键还原为原始 `Disc N`。
- 品番修复：品番为区间写法（如 `ANST-0001~4`）且数量少于实际 Disc 数时，按 Disc 1..N 部分填充，多出的 Disc 不显示品番徽章；数量多于 Disc 数时不推导，避免错位。
- Infobox 增强：多碟「播放时长 / 品番」折叠为摘要（总时长 / N Disc / 详情），悬浮或点击展开逐碟明细。
- 逐曲时长：从曲目页拉取时长并显示在曲目行，可随总开关关闭而移除。
- 共存让位：合并版启动即打标记并接管页面；独立脚本检测到标记后自行退出、清理自己插入的节点并恢复被隐藏的子项。
- 配置开关：通过 `chiiLib.ukagaka.addGeneralConfig` 新增「Disc 信息增强」开关（默认开启），切换后即时重绘；该功能不受「原始显示 / 组件显示」切换影响。

## 技术选型

- 运行形态：Tampermonkey 用户脚本，原生 ES2019+ 浏览器 API，`@grant none`，单文件 IIFE，无构建、无依赖、无测试框架（沿用目录现有约定）。
- 目标文件：`e:\Programs\EXEC_WIKI-BGM\bangumiscripts\音乐条目显示各曲目参与制作人员信息 ++.user.js`（主改）、`e:\Programs\EXEC_WIKI-BGM\bangumiscripts\音乐条目 Disc 信息增强.user.js`（加让位守卫）。
- 配置通道：复用现有 `chiiApp.cloud_settings` + `chiiLib.ukagaka.addGeneralConfig` 机制，不引入新的存储层。

## 实现方案

### 总体策略

把独立脚本整段能力搬进 ++ 脚本，但**不是直接复制粘贴**，而是包进一个独立子模块闭包，并把所有对外可见标识（class、dataset、style id、函数名）改名加前缀，从根上消除同名覆盖与 DOM 互相误删。

三个关键决策：

1. **子模块闭包隔离**（避免全局符号冲突）。两个脚本都定义了 `getSubjectId()`；若直接平铺复制，后声明的函数会覆盖前者，导致 ++ 的 `/subject/123/ep` 页判断失效。因此合并代码写成：
`const DISC_META = (function () { ... return { mount, unmount, setEnabled, refresh } })();`
内部函数一律保留原名，外部只暴露 4 个入口，零污染。

2. **DOM 标识全面换名**（解决「谁删谁」）。独立脚本的节点用 `.bgm-disc-meta-wrap` / `.bgm-disc-summary` / `.bgm-disc-popover` / `.bgm-ep-duration` / `#bgm-disc-meta-badges-style-v2` / `data-bgm-disc-meta-enhanced`；合并版全部改用 `bgm-dm-*` 前缀（`bgm-dm-wrap`、`bgm-dm-badge`、`bgm-dm-summary`、`bgm-dm-popover`、`bgm-dm-ep-duration`、`#bgm-dm-style`、`data-bgm-dm-*`）。
这样独立脚本的「清理自身」只删 `.bgm-disc-*`，永远不会碰到合并版节点；合并版的接管清理也只删旧前缀。这比「靠属性反查归属」更简单可靠。

3. **让位采用主动退出 + 幂等接管**（解决竞态）。++ 脚本在 IIFE 顶部**同步**设置 `window.__BGM_DISC_META_MERGED__ = true`（早于任何 await，也早于独立脚本 `document-idle` 的启动）；独立脚本在入口和 `enhance()` / observer 回调里都检查该标记，命中就 `disconnect` + 清理自身 DOM 后 `return`。
反向兜底：合并版在 `mount()` 时执行一次 `takeOverDiscMeta()`（删旧样式、删无主 `.bgm-disc-*` 节点、恢复 `#infobox li.sub` 的 `display`、清旧 dataset 标记），确保「独立脚本先跑完、合并版后跑」也不残留双份显示。

### 数据流

```
简介 #subject_summary 尾部行
  └─ parseDiscNames() ──► Map<discNo, name>
InfoBox 播放时长 / 品番（含 .sub 子项，或区间主值）
  └─ collectDiscMap() ──► Map<"DISC N", value>
        └─ expandSequentialCatalogRange(..., discCount)  ← 此处修复部分填充
  └─ 四路合并 ──► 每个 li.cat：Disc N [- name] + [品番徽章][时长徽章]
  └─ 摘要 + 详情弹层 ──► Infobox 对应 section
/subject/{id}/ep  ──► Map<epId, "mm:ss"> ──► cite 内 <small>时长:xx:xx / </small>
```

### 关键修复点

`expandSequentialCatalogRange(mainValue, discCount)` 现有硬校验 `expectedCount !== discCount → 返回空 Map`，在「品番 4 张 / 曲目列表 5 个 Disc」时整份映射作废。改为：

- `expectedCount > discCount` → 仍返回空（区间比碟多，说明数据不可信，不猜）；
- `expectedCount <= discCount` → 生成 `DISC 1..expectedCount` 的映射，剩余 Disc 无徽章。
调用处 `collectDiscMap` 的判定 `derivedMap.size >= 2` 保持不变，天然满足 `hasMulti` 语义；`enhanceInfoboxSection` 的 `entries.length` 会自动显示为 `4 Disc`，无需额外改动。

### 标题重写与幂等

`li.cat` 首次处理时写入 `li.dataset.bgmDmBaseLabel = "Disc N"` 与 `li.dataset.bgmDmNo = "N"`；重绘时用 `textContent = baseLabel + (name ? " - " + name : "")` 后重建徽章，而不是追加文本（避免多次运行叠加成 `Disc 1 - X - X`）。用 `li.dataset.bgmDmSig = ["N", name, catalog, duration].join("|")` 做签名比对，签名未变直接跳过，避免「写入 → 触发 observer → 再写入」的抖动。所有 Disc 号查询一律走 `bgmDmNo`，不再依赖标题文本正则（标题已被改写）。

### 性能与可靠性

- observer 合并：只观察 `ul.line_list_music`、`#infobox`、`#subject_summary` 三处，`subtree: true`，回调经 80ms 防抖后单次 `enhance()`；替换独立脚本对 `document.body` 的**无节流**全页监听（原实现每次 DOM 变更都跑全量解析）。
- 逐曲时长地图按 `subjectId` 缓存在模块内（`discDurationMapCache`），页面生命周期内只 `fetch` 一次 `/subject/{id}/ep`；开关关闭或非主条目页不发起请求。
- 单次 `enhance()` 复杂度 O(元素数)：一次遍历收集 Disc 映射，一次遍历写标题，一次遍历写 Infobox；无嵌套查询循环。
- 失败兜底：`fetch` 非 200 / 解析异常时 `return` 静默降级为「无逐曲时长」，不阻断标题与徽章渲染；复用现有 `console.warn('[staff-display] ...')` 前缀，不打印页面大段文本。
- 作用域收敛：Disc 相关逻辑只在 `/^\/subject\/\d+\/?$/` 主条目页运行（`/ep` 页的列表结构不同，不碰）；保留原 `isLikelyMusicSubjectPage()` 判定，避免误伤非音乐条目。
- 与现有逻辑零耦合：`renderAllTracks("raw")` 只处理 `.epinfo`，Disc 模块的 DOM 不参与，因此「原始显示」下 Disc 增强照常显示（符合用户确认），无需改动渲染分支。

## 目录结构

```
bangumiscripts/
├── 音乐条目显示各曲目参与制作人员信息 ++.user.js   [MODIFY]
│   ├── 头部 @version 0.1.9 → 0.1.10，@description 补「Disc 命名 / 品番 / 时长」
│   ├── IIFE 顶部：同步设置 window.__BGM_DISC_META_MERGED__ = true
│   ├── 配置常量区（~334 行 INSTRUMENT_DISPLAY_MODE_KEY 附近）：
│   │   新增 DISC_META_ENABLED_KEY = "staffDiscMetaEnabled"、discMetaEnabled 变量、
│   │   safeGetDiscMetaEnabled() / safeUpdateDiscMetaEnabled()
│   ├── tryInstallInstrumentDisplayConfig()（~436-452 后）：追加第三条 radio 配置
│   │   「Disc 信息增强」开/关，onChange → 更新值 + DISC_META.setEnabled()
│   ├── bootInstrumentDisplayConfig()（~475）：启动时读取开关值
│   ├── collectTrackRows()（~1757）：li.cat 分支优先读 li.dataset.bgmDmNo，
│   │   读不到再回退 textContent.match(/Disc\s*(\d+)/i)（兼容标题已改写）
│   ├── 新增 DISC_META 子模块（建议插在 positionCompareToggle 之后、init 之前，~2858）：
│   │   ensureDiscMetaStyle / normalizeWhitespace / normalizeDurationText /
│   │   parseDurationSeconds / formatSecondsToHHMMSS / parseDiscNamesFromSummary /
│   │   getSectionWithSubs / collectDiscMap / collectCatalogInfo /
│   │   expandSequentialCatalogRange（修正版）/ shouldUseDurationOnHeadings /
│   │   getDiscHeadingNodes / enhanceDiscHeadings / makePopover / bindPopover /
│   │   enhanceInfoboxSection / collectHomeEpItems / fetchDurationMapFromSubjectEpPage /
│   │   extractDurationFromText / renderDurations / takeOverDiscMeta / clearDiscMeta /
│   │   enhance（防抖调度）/ mount / unmount / setEnabled / refresh
│   └── init()（~2860）：ensureCompareToggleStyle() 后同步 DISC_META.mount()；
│       末尾在 startEpinfoDedupeGuard() 之后无需额外改动（模块自管 observer）
└── 音乐条目 Disc 信息增强.user.js   [MODIFY]
    ├── 头部 @version 0.0.5 → 0.0.6，@description 标注「已并入 ++ 脚本，仅在合并版缺席时工作」
    ├── IIFE 起始：检测 window.__BGM_DISC_META_MERGED__，命中则 cleanupOwnDom() 后 return
    ├── enhance()（~801）：入口处再次检查标记，命中则 disconnect + cleanup + return
    └── init()（~829）：observer 回调内检查标记，支持「独立脚本先启动、合并版后接管」场景
```

## 关键接口约定

```js
// 跨脚本让位标记：合并版同步置 true，独立脚本只读
window.__BGM_DISC_META_MERGED__ = true;

// 合并版对外暴露的模块入口
DISC_META.mount();              // 接管旧 DOM、注入样式、启动防抖 observer
DISC_META.unmount();            // 移除全部 bgm-dm-* 节点、还原标题为 Disc N、断开 observer
DISC_META.setEnabled(boolean);  // 开关切换：false → unmount；true → mount
DISC_META.refresh();            // 强制重算（如 Disc 列表后续异步加载）

// 新增云配置
const DISC_META_ENABLED_KEY = "staffDiscMetaEnabled"; // "on" | "off"，默认 "on"
```