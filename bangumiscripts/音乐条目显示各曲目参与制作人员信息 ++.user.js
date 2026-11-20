// ==UserScript==
// @name         音乐条目显示各曲目参与制作人员信息 ++
// @namespace    org.sakarin.bgm.music.staff.patch.display
// @version      0.1.10
// @description  为 Bangumi 音乐条目曲目列表显示制作人员补丁；并显示 Disc 命名 / 品番 / 播放时长（合自「音乐条目 Disc 信息增强」）
// @author       GPT / SilenceAkarin
// @match        https://chii.in/subject/*
// @match        https://bangumi.tv/subject/*
// @match        https://bgm.tv/subject/*
// @run-at       document-end
// ==/UserScript==

(function () {
    "use strict";

    // 合并版标记：独立脚本「音乐条目 Disc 信息增强」检测到它之后会自动让位
    // （清理自己插入的节点与样式），保证两个脚本同时启用时页面只有一套 Disc 增强显示。
    // 必须在任何 await 之前同步置位：本脚本 @run-at document-end，早于独立脚本的 document-idle。
    window.__BGM_DISC_META_MERGED__ = true;

    const WORKER_URL = "https://worker.sakarin724.top";

    const EPINFO_TRACK_KEY = "__epinfo__";

    const DATA_URL_BUILDERS = [
        subjectId => `https://raw.githubusercontent.com/nightStarLights/bangumi-wiki-staff-display-fix/main/data/${subjectId}.json?ts=${Date.now()}`,
        subjectId => `https://cdn.jsdelivr.net/gh/nightStarLights/bangumi-wiki-staff-display-fix@main/data/${subjectId}.json?ts=${Date.now()}`,
        subjectId => `https://gitee.com/SilenceChen/bangumi-wiki-staff-display-fix/raw/main/data/${subjectId}.json?ts=${Date.now()}`,

    ];

    const LABEL_TO_ROLES = {
        "艺术家": ["artist"],
        "作词": ["lyricist"],
        "作曲": ["composer"],
        "编曲": ["arranger"],
        "厂牌": ["label"],
        "声乐": ["vocal"],
        "和声": ["chorus"],
        "录音": ["recording"],
        "混音": ["mixing"],
        "母带制作": ["mastering"],
        "乐器": ["instrument"],
        "制作人": ["producer"],
        "插图": ["illustrator"],
        "原作": ["original"],
        "脚本": ["script"],
        "出版方": ["publisher"],
        "人声编辑": ["vocaledit"],
        "人声指导": ["vocaldirection"],
        "音响监督": ["sounddirector"],
        "客串": ["featured"],
        "合唱": ["choir"],
        "旁白": ["narration"],
        "念白": ["narration"],
        "旁白/念白": ["narration"],
        "念白/旁白": ["narration"],
        "ナレーション": ["narration"],
        "设计": ["design"],

        "艺术家、作词": ["artist", "lyricist"],
        "艺术家、作詞": ["artist", "lyricist"],
        "艺术家、作词、作曲": ["artist", "lyricist", "composer"],
        "艺术家、作詞、作曲": ["artist", "lyricist", "composer"],
        "艺术家、作词、作曲、编曲": ["artist", "lyricist", "composer", "arranger"],
        "艺术家、作詞、作曲、编曲": ["artist", "lyricist", "composer", "arranger"],

        "艺术家、作词、编曲": ["artist", "lyricist", "arranger"],
        "艺术家、作詞、编曲": ["artist", "lyricist", "arranger"],

        "作词、编曲": ["lyricist", "arranger"],
        "作詞、编曲": ["lyricist", "arranger"],

        "艺术家、作编曲": ["artist", "composer", "arranger"],
        "艺术家、作词作曲": ["artist", "lyricist", "composer"],
        "艺术家、作詞作曲": ["artist", "lyricist", "composer"],
        "艺术家、作词作编曲": ["artist", "lyricist", "composer", "arranger"],
        "艺术家、作詞作编曲": ["artist", "lyricist", "composer", "arranger"],

        "作编曲": ["composer", "arranger"],
        "作词作曲": ["lyricist", "composer"],
        "作詞作曲": ["lyricist", "composer"],
        "作词作编曲": ["lyricist", "composer", "arranger"],
        "作詞作编曲": ["lyricist", "composer", "arranger"],

        "作曲、编曲": ["composer", "arranger"],
        "作词、作曲": ["lyricist", "composer"],
        "作词、作曲、编曲": ["lyricist", "composer", "arranger"],

        "艺术家、声乐": ["artist", "vocal"],
        "艺术家、和声": ["artist", "chorus"],

        "艺术家、作曲、声乐": ["artist", "composer", "vocal"],
        "艺术家、作曲、和声": ["artist", "composer", "chorus"],

        "艺术家、作词、声乐": ["artist", "lyricist", "vocal"],
        "艺术家、作詞、声乐": ["artist", "lyricist", "vocal"],
        "艺术家、作词、和声": ["artist", "lyricist", "chorus"],
        "艺术家、作詞、和声": ["artist", "lyricist", "chorus"],

        "艺术家、作词、作曲、声乐": ["artist", "lyricist", "composer", "vocal"],
        "艺术家、作詞、作曲、声乐": ["artist", "lyricist", "composer", "vocal"],
        "艺术家、作词、作曲、和声": ["artist", "lyricist", "composer", "chorus"],
        "艺术家、作詞、作曲、和声": ["artist", "lyricist", "composer", "chorus"],

        "艺术家、作词、作曲、编曲、声乐": ["artist", "lyricist", "composer", "arranger", "vocal"],
        "艺术家、作詞、作曲、编曲、声乐": ["artist", "lyricist", "composer", "arranger", "vocal"],
        "艺术家、作词、作曲、编曲、和声": ["artist", "lyricist", "composer", "arranger", "chorus"],
        "艺术家、作詞、作曲、编曲、和声": ["artist", "lyricist", "composer", "arranger", "chorus"],
    };

    const ROLE_LABELS = {
        artist: "艺术家",
        lyricist: "作词",
        composer: "作曲",
        arranger: "编曲",
        label: "厂牌",
        chorus: "和声",
        recording: "录音",
        mixing: "混音",
        mastering: "母带制作",
        instrument: "乐器",
        producer: "制作人",
        illustrator: "插图",
        original: "原作",
        script: "脚本",
        publisher: "出版方",
        vocaledit: "人声编辑",
        vocaldirection: "人声指导",
        sounddirector: "音响监督",
        featured: "客串",
        choir: "合唱",
        narration: "念白/旁白",
        design: "设计",
        vocal: "声乐"
    };

    /**
     * 总体显示顺序（同一人跨职位合并时，也按这个顺序取职位名）。
     */
    const ROLE_ORDER = [
        // 艺术家
        "artist",

        // 声乐、客串、和声、合唱、念白/旁白、原作
        "vocal",
        "featured",
        "chorus",
        "choir",
        "narration",
        "original",

        // 作词、作曲、编曲
        "lyricist",
        "composer",
        "arranger",

        // 乐器（演奏类，排在录音/混音之前）
        "instrument",

        // 混音、录音、母带制作、插图、设计
        "mixing",
        "recording",
        "mastering",
        "illustrator",
        "design",

        // 人声编辑、人声指导、音响监督
        "vocaledit",
        "vocaldirection",
        "sounddirector",

        // 脚本、制作人、厂牌、出版方
        "script",
        "producer",
        "label",
        "publisher",

        // 自定义职位（custom-*）在 restRoleKeys 里追加到最后
    ];

    /**
     * 「同一人写成一行」只允许在同一个顺序组内发生。
     * 跨组合并会让整行跑到别的组的位置上（例如 作词+编曲+制作人 会一起插到作曲前面），
     * 所以这里按上面的顺序把职位分段。
     *
     * 例外：整首曲只有一个人时（所有职位都是他），允许跨组合并成一行，
     * 见 mergeRolesForRender 里的 singlePersonTrack。
     */
    const ROLE_MERGE_GROUPS = [
        ["artist"],
        ["vocal", "featured", "chorus", "choir", "narration", "original"],
        ["lyricist", "composer", "arranger"],
        ["instrument"],
        ["mixing", "recording", "mastering", "illustrator", "design"],
        ["vocaledit", "vocaldirection", "sounddirector"],
        ["script", "producer", "label", "publisher"],
    ];

    /**
     * 可带子职位的职位（与 EXEC_WIKI 的 PREFIXABLE_ROLES 保持一致）。
     * 这些职位支持「职位-子职位」写法，例如：
     *   乐器-Guitar / 设计-Web / 插图-内页 / 作曲-钢琴 / 作词-英文词 ...
     * 普通写法（不带 “-”，如 乐器 / 设计 / 作曲）不受影响。
     */
    const PREFIXABLE_ROLE_LABELS = [
        "乐器",
        "设计",
        "插图",
        "作曲",
        "作词",
        "编曲",
        "制作人",
        "声乐",
        "和声",
        "合唱",
        "录音",
        "混音",
        "母带制作",
    ];

    const PREFIXABLE_LABEL_TO_ROLE = (() => {
        const map = {};

        for (const label of PREFIXABLE_ROLE_LABELS) {
            const roles = LABEL_TO_ROLES[label];
            if (roles && roles.length === 1) {
                map[label] = roles[0];
            }
        }

        return map;
    })();

    const PREFIXABLE_ROLE_KEYS = new Set(Object.values(PREFIXABLE_LABEL_TO_ROLE));

    /**
     * 把「职位-子职位」（如 乐器-Guitar）拆成 { roleKey, subRole }。
     * 仅识别 PREFIXABLE_ROLES 里的职位；custom-xxx 等不走这里。
     */
    function matchPrefixableRoleLabel(label) {
        const s = String(label || "").trim();
        if (!s) return null;

        const m = s.match(/^(.+?)\s*[-－]\s*(.+)$/);
        if (!m) return null;

        const baseLabel = m[1].trim();
        const subRole = m[2].trim();
        if (!subRole) return null;

        const roleKey = PREFIXABLE_LABEL_TO_ROLE[baseLabel];
        if (!roleKey) return null;

        return { roleKey, subRole };
    }

    // 艺术家1 ARTIST_JOINERS 艺术家2
    const ARTIST_JOINERS = [
        " feat. ",
        " ft ",
        " fw ",
        " vs ",
        " x ",
        " + ",
        " with ",
        "&",
        " × ",
        " starring ",
    ];

    /* ---------自定义职位--------- */
    function isCustomRoleKey(roleKey) {
        return typeof roleKey === "string" && /^custom-/i.test(roleKey);
    }

    function hasCustomRoleInRoleMap(roleMap) {
        if (!roleMap || typeof roleMap !== "object") return false;

        return Object.keys(roleMap).some(roleKey => {
            if (!Array.isArray(roleMap[roleKey]) || !roleMap[roleKey].length) return false;
            return isCustomRoleKey(roleKey);
        });
    }

    function getRenderRoleLabel(roleKey) {
        if (isCustomRoleKey(roleKey)) {
            return String(roleKey).replace(/^custom-/i, "").trim() || roleKey;
        }
        return ROLE_LABELS[roleKey] || roleKey;
    }
    /* ---------自定义职位--------- */

    function resolveLabelToRoles(label) {
        if (!label) return null;

        const direct = LABEL_TO_ROLES[label];
        if (direct && direct.length) {
            return direct.slice();
        }

        const parts = label
            .split("、")
            .map(s => s.trim())
            .filter(Boolean);

        if (parts.length <= 1) return null;

        const roles = [];
        for (const part of parts) {
            const mapped = LABEL_TO_ROLES[part];
            if (!mapped || mapped.length !== 1) {
                return null;
            }

            const role = mapped[0];
            if (!roles.includes(role)) {
                roles.push(role);
            }
        }

        return roles.length ? roles : null;
    }

    const STAFF_DISPLAY_RUNTIME = {
        subjectId: null,
        data: null,
        baseTrackState: new Map(),
        baseGlobalEpinfoRows: [],
        globalMap: new Map(),
        compareMode: "after",
        trackRows: null,
        patchMap: {}
    };

    // 注意：存储 key 与内部变量名沿用 instrument* 前缀，是为了兼容已有的云配置；
    // 该配置已从「乐器职位显示方式」泛化为「子职位显示方式」，实际作用于
    // PREFIXABLE_ROLES 里的所有职位（乐器 / 设计 / 插图 / 作曲 / 作词 / ...）。
    const INSTRUMENT_DISPLAY_MODE_KEY = "staffInstrumentDisplayMode";

    let instrumentDisplayMode = "legacy";
    let instrumentDisplayConfigInstalled = false;

    function normalizeInstrumentDisplayMode(value) {
        return ["legacy", "by_instrument", "inline_by_instrument"].includes(value)
            ? value
            : "legacy";
    }

    function safeGetInstrumentDisplayMode() {
        try {
            if (typeof chiiApp !== "undefined" && chiiApp.cloud_settings) {
                const val = chiiApp.cloud_settings.get(INSTRUMENT_DISPLAY_MODE_KEY);
                return normalizeInstrumentDisplayMode(val);
            }
        } catch (e) {
            console.warn("[staff-display] get cloud config failed:", e);
        }
        return "legacy";
    }

    function safeUpdateInstrumentDisplayMode(value) {
        const mode = normalizeInstrumentDisplayMode(value);
        try {
            if (typeof chiiApp !== "undefined" && chiiApp.cloud_settings) {
                chiiApp.cloud_settings.update({
                    [INSTRUMENT_DISPLAY_MODE_KEY]: mode
                });
            }
        } catch (e) {
            console.warn("[staff-display] update cloud config failed:", e);
        }
    }

    /**
     * 「拆分多行」时的子职位标签格式：
     *   sub_role_only：纯子职位名（Guitar：ケンシロー）
     *   with_prefix  ：职位-子职位（乐器-Guitar：ケンシロー）
     * 默认保留原来的纯子职位名。
     */
    const SUB_ROLE_LABEL_MODE_KEY = "staffSubRoleLabelMode";

    let subRoleLabelMode = "sub_role_only";

    function normalizeSubRoleLabelMode(value) {
        return ["sub_role_only", "with_prefix"].includes(value)
            ? value
            : "sub_role_only";
    }

    function safeGetSubRoleLabelMode() {
        try {
            if (typeof chiiApp !== "undefined" && chiiApp.cloud_settings) {
                const val = chiiApp.cloud_settings.get(SUB_ROLE_LABEL_MODE_KEY);
                return normalizeSubRoleLabelMode(val);
            }
        } catch (e) {
            console.warn("[staff-display] get sub-role label config failed:", e);
        }
        return "sub_role_only";
    }

    function safeUpdateSubRoleLabelMode(value) {
        const mode = normalizeSubRoleLabelMode(value);
        try {
            if (typeof chiiApp !== "undefined" && chiiApp.cloud_settings) {
                chiiApp.cloud_settings.update({
                    [SUB_ROLE_LABEL_MODE_KEY]: mode
                });
            }
        } catch (e) {
            console.warn("[staff-display] update sub-role label config failed:", e);
        }
    }

    /**
     * 「Disc 信息增强」总开关（合并自「音乐条目 Disc 信息增强」）：
     *   on ：曲目列表 Disc 标题内联简介里的 Disc 命名，右侧追加 [品番] [时长]；
     *        Infobox 多碟「播放时长 / 品番」折叠成「摘要 + 详情弹层」；
     *        曲目行显示逐曲时长（取自 /subject/{id}/ep）。
     *   off：完全还原成原站形态（移除全部注入节点与样式）。
     * 与「原始显示 / 组件显示++」切换互相独立：后者只影响制作人员 epinfo。
     */
    const DISC_META_ENABLED_KEY = "staffDiscMetaEnabled";

    let discMetaEnabled = true;

    function normalizeDiscMetaEnabled(value) {
        return value === "off" ? "off" : "on";
    }

    function safeGetDiscMetaEnabled() {
        try {
            if (typeof chiiApp !== "undefined" && chiiApp.cloud_settings) {
                const val = chiiApp.cloud_settings.get(DISC_META_ENABLED_KEY);
                return normalizeDiscMetaEnabled(val) === "on";
            }
        } catch (e) {
            console.warn("[staff-display] get disc meta config failed:", e);
        }
        return true;
    }

    function safeUpdateDiscMetaEnabled(value) {
        const mode = value ? "on" : "off";
        try {
            if (typeof chiiApp !== "undefined" && chiiApp.cloud_settings) {
                chiiApp.cloud_settings.update({
                    [DISC_META_ENABLED_KEY]: mode
                });
            }
        } catch (e) {
            console.warn("[staff-display] update disc meta config failed:", e);
        }
    }

    function rerenderCurrentStaffDisplay() {
        if (!STAFF_DISPLAY_RUNTIME.trackRows) return;

        renderAllTracks(
            STAFF_DISPLAY_RUNTIME.trackRows,
            STAFF_DISPLAY_RUNTIME.patchMap || {},
            STAFF_DISPLAY_RUNTIME.globalMap || new Map(),
            STAFF_DISPLAY_RUNTIME.compareMode || "after"
        );
    }

    function tryInstallInstrumentDisplayConfig() {
        if (instrumentDisplayConfigInstalled) return true;

        if (
            typeof chiiLib === "undefined" ||
            !chiiLib?.ukagaka ||
            typeof chiiApp === "undefined" ||
            !chiiApp?.cloud_settings
        ) {
            return false;
        }

        instrumentDisplayConfigInstalled = true;

        chiiLib.ukagaka.addGeneralConfig({
            title: "子职位显示方式",
            name: INSTRUMENT_DISPLAY_MODE_KEY,
            type: "radio",
            defaultValue: "legacy",
            getCurrentValue: () => instrumentDisplayMode,
            onChange: value => {
                instrumentDisplayMode = normalizeInstrumentDisplayMode(value);
                safeUpdateInstrumentDisplayMode(instrumentDisplayMode);
                rerenderCurrentStaffDisplay();
            },
            options: [
                { value: "legacy", label: "合并显示" },
                { value: "by_instrument", label: "拆分多行" },
                { value: "inline_by_instrument", label: "拆分单行" }
            ]
        });

        // 「拆分多行」时的标签格式（仅在 子职位显示方式 = 拆分多行 时生效）
        chiiLib.ukagaka.addGeneralConfig({
            title: "子职位标签格式",
            name: SUB_ROLE_LABEL_MODE_KEY,
            type: "radio",
            defaultValue: "sub_role_only",
            getCurrentValue: () => subRoleLabelMode,
            onChange: value => {
                subRoleLabelMode = normalizeSubRoleLabelMode(value);
                safeUpdateSubRoleLabelMode(subRoleLabelMode);
                rerenderCurrentStaffDisplay();
            },
            options: [
                { value: "sub_role_only", label: "纯子职位名" },
                { value: "with_prefix", label: "职位-子职位" }
            ]
        });

        // 「Disc 信息增强」总开关：Disc 命名 / 品番 / 时长徽章 / 逐曲时长
        chiiLib.ukagaka.addGeneralConfig({
            title: "Disc 信息增强",
            name: DISC_META_ENABLED_KEY,
            type: "radio",
            defaultValue: "on",
            getCurrentValue: () => (discMetaEnabled ? "on" : "off"),
            onChange: value => {
                discMetaEnabled = normalizeDiscMetaEnabled(value) === "on";
                safeUpdateDiscMetaEnabled(discMetaEnabled);
                syncDiscMetaEnabled();
            },
            options: [
                { value: "on", label: "开启" },
                { value: "off", label: "关闭" }
            ]
        });

        return true;
    }

    function bootInstrumentDisplayConfig() {
        instrumentDisplayMode = safeGetInstrumentDisplayMode();
        subRoleLabelMode = safeGetSubRoleLabelMode();
        discMetaEnabled = safeGetDiscMetaEnabled();

        if (tryInstallInstrumentDisplayConfig()) return;

        let retry = 0;
        const timer = setInterval(() => {
            retry++;
            if (tryInstallInstrumentDisplayConfig() || retry >= 40) {
                clearInterval(timer);
            }
        }, 500);
    }

    bootInstrumentDisplayConfig();

    function gmRequest(url) {
        return fetch(url, {
            method: "GET",
            credentials: "omit",
            cache: "no-store"
        }).then(async (res) => {
            return {
                status: res.status,
                responseText: await res.text()
            };
        });
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function fetchFromWorker(subjectId) {
        const url = `${WORKER_URL}/subject-content?subjectId=${encodeURIComponent(subjectId)}&ts=${Date.now()}`;

        try {
            const res = await gmRequest(url);

            if (res.status !== 200) {
                return { ok: false, status: res.status, source: "worker" };
            }

            const data = JSON.parse(res.responseText || "{}");
            if (!data.ok) {
                return { ok: false, status: res.status, source: "worker", detail: data };
            }

            if (!data.found) {
                return { ok: true, found: false, source: "worker" };
            }

            return {
                ok: true,
                found: true,
                source: data.source || "worker",
                content: data.content || null
            };
        } catch (err) {
            return {
                ok: false,
                source: "worker",
                error: err instanceof Error ? err.message : String(err)
            };
        }
    }

    async function fetchFromMirrors(subjectId) {
        for (const build of DATA_URL_BUILDERS) {
            const url = build(subjectId);

            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const res = await gmRequest(url);

                    if (res.status === 200) {
                        return JSON.parse(res.responseText);
                    }

                    if (res.status === 404) {
                        break;
                    }
                } catch (err) {
                    console.warn("[staff-patch] mirror request failed:", url, attempt + 1, err);
                }

                await sleep(300 * (attempt + 1));
            }
        }

        return null;
    }

    async function fetchPatchData(subjectId) {
        // 1) 先走 Worker 读 GitHub API
        const workerRes = await fetchFromWorker(subjectId);

        if (workerRes.ok) {
            if (workerRes.found) {
                return workerRes.content;
            }
            // Worker 明确说主分支没有这个文件，那就直接返回 null
            return null;
        }

        console.warn("[staff-patch] worker fetch failed, fallback to mirror:", workerRes);

        // 2) Worker 不通 / GitHub API 失败时，再走 Gitee 镜像
        const mirrorData = await fetchFromMirrors(subjectId);
        if (mirrorData) return mirrorData;

        return null;
    }

    async function waitForTrackRowsReady(timeoutMs = 3000) {
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            const trackRows = collectTrackRows();
            if (trackRows.size) {
                return trackRows;
            }
            await sleep(120);
        }

        return collectTrackRows();
    }

    async function applyPatchesWhenReady(trackRows, patchMap, globalMap, timeoutMs = 8000) {
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            let applied = 0;

            for (const [trackKey, trackPatch] of Object.entries(patchMap)) {
                const li = trackRows.get(trackKey);
                if (!li) continue;

                renderTrackFromBase(li, trackKey, trackPatch, globalMap);
                applied++;
            }

            if (applied > 0) return applied;

            await sleep(300);
            trackRows = collectTrackRows();
        }

        return 0;
    }

    function getSubjectId() {
        const m = location.pathname.match(/^\/subject\/(\d+)/);
        return m ? m[1] : null;
    }

    const INPUT_SPLITTERS = new Set(["、", "，", ",", "/", "／", "\\", "|", "｜", ";", "；"]);

    function splitOutsideParens(text) {
        const result = [];
        let buf = "";
        let depth = 0;

        for (const ch of text) {
            if (ch === "(" || ch === "（") depth++;
            if (ch === ")" || ch === "）") depth = Math.max(0, depth - 1);

            if (depth === 0 && INPUT_SPLITTERS.has(ch)) {
                if (buf.trim()) result.push(buf.trim());
                buf = "";
            } else {
                buf += ch;
            }
        }

        if (buf.trim()) result.push(buf.trim());
        return result;
    }

    function isTrackExpr(expr) {
        const parts = expr.split(",").map(s => s.trim()).filter(Boolean);
        if (!parts.length) return false;

        return parts.every(part => {
            // 支持：
            // 1.1
            // 1.2-4
            // 1
            // 2-4   （默认 Disc 1）
            return /^(\d+)(?:\.(\d+))?(?:-(\d+))?$/.test(part);
        });
    }

    function extractTrailingTrackExpr(item) {
        const s = item.trim();
        if (!s.endsWith(")") && !s.endsWith("）")) return null;

        let depth = 0;
        for (let i = s.length - 1; i >= 0; i--) {
            const ch = s[i];
            if (ch === ")" || ch === "）") {
                depth++;
            } else if (ch === "(" || ch === "（") {
                depth--;
                if (depth === 0) {
                    const inside = s.slice(i + 1, s.length - 1).trim();
                    if (isTrackExpr(inside)) {
                        return {
                            name: s.slice(0, i).trim(),
                            trackExpr: inside
                        };
                    }
                    return null;
                }
            }
        }

        return null;
    }

    function expandTrackExpr(expr) {
        const out = [];
        const parts = expr.split(",").map(s => s.trim()).filter(Boolean);

        for (const part of parts) {
            const m = part.match(/^(\d+)(?:\.(\d+))?(?:-(\d+))?$/);
            if (!m) continue;

            let disc;
            let start;
            let end;

            if (m[2]) {
                // 1.2 / 1.2-4
                disc = Number(m[1]);
                start = Number(m[2]);
                end = m[3] ? Number(m[3]) : start;
            } else {
                // 1 / 2-4
                // 默认按 Disc 1
                disc = 1;
                start = Number(m[1]);
                end = m[3] ? Number(m[3]) : start;
            }

            for (let i = start; i <= end; i++) {
                out.push(`${disc}.${i}`);
            }
        }

        return out;
    }

    function parseNameWithOptionalRef(rawName) {
        const m = rawName.match(/^(.*?)(?:\{(p:\d+|n:[^}]+)\})?$/);
        if (!m) return { text: rawName.trim(), ref: null };

        return {
            text: m[1].trim(),
            ref: m[2] ? m[2].trim() : null
        };
    }

    function tryParseEmbeddedParenItem(text) {
        const raw = (text || "").trim();
        if (!raw) return null;

        // 只支持半角括号
        const m = raw.match(/^(.*?)\s*\(([^(){}]+)(?:\{(p:\d+|n:[^}]+)\})?\)\s*$/);
        if (!m) return null;

        const outerText = m[1].trim();
        const innerText = m[2].trim();
        const innerRef = m[3] || null;

        if (!outerText || !innerText) return null;

        // 如果括号内文字本身就出现在外层显示名里，优先按“显示组件风格”拆成混合片段
        const idx = outerText.indexOf(innerText);
        if (idx >= 0) {
            const prefix = outerText.slice(0, idx);
            const suffix = outerText.slice(idx + innerText.length);

            const segs = [];
            if (prefix) segs.push(makeTextSeg(prefix));
            segs.push(makeEntitySeg(innerText, innerRef));
            if (suffix) segs.push(makeTextSeg(suffix));

            return makeItem(segs);
        }

        // 否则退回传统的 alias_person 风格
        return makeItem([
            makeEntitySeg(outerText, null, true),
            makeTextSeg(" ("),
            makeEntitySeg(innerText, innerRef),
            makeTextSeg(")")
        ]);
    }

    function splitPatchLine(line) {
        const s = line.trim();
        const m = s.match(/^(.+?)\s*[:：﹕︰;；|｜=＝]\s*(.+)$/);
        if (!m) return null;

        return {
            left: m[1].trim(),
            right: m[2].trim()
        };
    }

    function makeTextSeg(text) {
        return { kind: "text", text };
    }

    function makeEntitySeg(text, ref = null, noLink = false) {
        return {
            kind: "entity",
            text,
            ref: ref || null,
            noLink: !!noLink
        };
    }

    function makeItem(segments) {
        return { segments };
    }

    /* ---------团体标注：@团体 / (团体)--------- */

    const HIDE_GROUPS_KEY = "staffHideGroupAnnotations";

    // 勾选后隐藏 @ 和括号里的团体 / 社团 / 公司名
    let hideGroupAnnotations = false;

    // 当前条目里出现过的「人名 / 团体名」（NFKC + 小写），
    // 用来区分「(森羅万象)」这种团体括号和「(主题作词)」这种子职位括号。
    let knownGroupNames = new Set();

    function normalizeGroupName(text) {
        return String(text || "").normalize("NFKC").toLowerCase().trim();
    }

    function makeGroupTextSeg(text) {
        const seg = makeTextSeg(text);
        seg.group = true;
        return seg;
    }

    /** 尾部 `名字 @团体`（@ 前可有空白，@ 后不能为空） */
    function splitAtGroupText(text) {
        const s = String(text || "");
        const at = s.indexOf("@");
        if (at <= 0) return null;
        if (!s.slice(at + 1).trim()) return null;

        let start = at;
        while (start > 0 && /\s/.test(s[start - 1])) start--;

        const head = s.slice(0, start).trim();
        if (!head) return null;

        return { head: s.slice(0, start), group: s.slice(start) };
    }

    /** 尾部 `名字 (团体)`，且括号内容是一个已知的人名 / 团体名 */
    function splitKnownParenGroupText(text) {
        const s = String(text || "");
        const m = s.match(/^(.*?)(\s*[（(]([^()（）]+)[)）])\s*$/);
        if (!m) return null;

        const content = m[3].trim();
        if (!content || !knownGroupNames.has(normalizeGroupName(content))) return null;

        const head = m[1].trim();
        if (!head) return null;

        return { head: m[1], group: m[2] };
    }

    /** 整段就是团体标注（`@xxx` / `(已知团体)`） */
    function isPureGroupText(text) {
        const s = String(text || "");
        if (/^\s*[@＠]/.test(s)) return true;

        const m = s.match(/^\s*[（(]([^()（）]+)[)）]\s*$/);
        return !!m && knownGroupNames.has(normalizeGroupName(m[1]));
    }

    /** 这段文本里是否带团体标注（用于阻止把团体当子职位抬到职位名上） */
    function isGroupLikeSeg(seg) {
        if (!seg) return false;
        if (seg.group) return true;
        if (seg.kind !== "text" && seg.kind !== "entity") return false;

        const text = String(seg.text || "");
        if (isPureGroupText(text)) return true;
        if (splitAtGroupText(text)) return true;
        return !!splitKnownParenGroupText(text);
    }

    /** 渲染前把 segment 里的团体标注拆成独立 text 段，方便整体隐藏 / 显示 */
    function expandGroupSegments(seg) {
        if (!seg || seg.group) return [seg];

        const text = String(seg.text || "");
        if (!text) return [seg];
        if (isPureGroupText(text)) return [makeGroupTextSeg(text)];

        const paren = splitKnownParenGroupText(text);
        if (paren) {
            return [{ ...seg, text: paren.head }, makeGroupTextSeg(paren.group)];
        }

        const at = splitAtGroupText(text);
        if (at) {
            return [{ ...seg, text: at.head }, makeGroupTextSeg(at.group)];
        }

        return [seg];
    }

    /**
     * 收集当前条目出现过的名字：patchMap 里的实体、页面上已有的 person 链接、people 表。
     * 括号里的内容命中这些名字时，按团体处理（而不是子职位）。
     */
    function collectKnownGroupNames(patchMap, globalMap, people = {}) {
        const names = new Set();

        const add = (text) => {
            const key = normalizeGroupName(text);
            if (key.length >= 2) names.add(key);
        };

        for (const roleMap of Object.values(patchMap || {})) {
            if (!roleMap || typeof roleMap !== "object") continue;

            for (const items of Object.values(roleMap)) {
                for (const item of items || []) {
                    for (const seg of item?.segments || []) {
                        if (seg?.kind === "entity" && seg.text) add(seg.text);
                    }
                }
            }
        }

        for (const name of globalMap?.keys?.() || []) add(name);
        for (const name of Object.values(people || {})) add(name);

        return names;
    }

    function buildArtistJoinerRegex(requireLeadingSpace = true) {
        // ARTIST_JOINERS 里的连接词自带空格（如 " feat. "），这里先 trim 再用，
        // 否则会变成「前缀空白 + 连接词自带空白」的双重空白要求，
        // 导致 A feat. B / A(B)feat.C / A(B)ft.C / A(B)fw.C / A(B)vs.C 这类写法全部失配
        const body = ARTIST_JOINERS
            .map(s => String(s || "").trim())
            .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .filter(Boolean)
            .join("|");

        return new RegExp(
            `^${requireLeadingSpace ? "\\s+" : ""}((?:${body})\\.?)\\s*`,
            "i"
        );
    }

    function tryParseJoinedArtistItem(text) {
        const raw = (text || "").trim();
        if (!raw) return null;

        const joinerWithSpaceRe = buildArtistJoinerRegex(true);
        const joinerAfterParenRe = buildArtistJoinerRegex(false);

        function parseSingleArtistUnit(unitText) {
            const unit = (unitText || "").trim();
            if (!unit) return null;

            const embedded = tryParseEmbeddedParenItem(unit);
            if (embedded) {
                return embedded.segments.slice();
            }

            const parsed = parseNameWithOptionalRef(unit);
            if (!parsed.text) return null;

            return [makeEntitySeg(parsed.text, parsed.ref)];
        }

        const segments = [];
        let buf = "";
        let depth = 0;
        let foundJoiner = false;
        let i = 0;

        function flushCurrentUnit() {
            const segs = parseSingleArtistUnit(buf);
            if (!segs) return false;
            segments.push(...segs);
            buf = "";
            return true;
        }

        while (i < raw.length) {
            const ch = raw[i];

            if (ch === "(" || ch === "（") {
                depth++;
                buf += ch;
                i++;
                continue;
            }

            if (ch === ")" || ch === "）") {
                depth = Math.max(0, depth - 1);
                buf += ch;
                i++;
                continue;
            }

            if (depth === 0) {
                let m = raw.slice(i).match(joinerWithSpaceRe);
                let consumeLen = m ? m[0].length : 0;

                // 允许这种写法：A(B)feat.C / A(B)ft.C / A(B)fw.C / A(B)vs.C
                if (!m && /[)）]\s*$/.test(buf)) {
                    m = raw.slice(i).match(joinerAfterParenRe);
                    consumeLen = m ? m[0].length : 0;
                }

                if (m && buf.trim()) {
                    if (!flushCurrentUnit()) return null;

                    foundJoiner = true;
                    segments.push(makeTextSeg(` ${m[1]} `));
                    i += consumeLen;
                    continue;
                }
            }

            buf += ch;
            i++;
        }

        if (!foundJoiner) return null;
        if (!buf.trim()) return null;
        if (!flushCurrentUnit()) return null;

        return makeItem(segments);
    }

    function parseGroupWithCVs(text) {
        const trimmed = text.trim();
        let m = trimmed.match(/^《(.*?)》\s*\[(.*?)\]\s*$/);
        let groupName = null;
        let inner = null;

        if (m) {
            groupName = m[1].trim();
            inner = m[2].trim();
        } else {
            // 兼容没有《》的情况，但要求方括号前的内容作为团体名
            m = trimmed.match(/^(.*?)\s*\[(.*?)\]\s*$/);
            if (m) {
                groupName = m[1].trim();
                inner = m[2].trim();
            }
        }

        if (!groupName || !inner) return null;

        const parts = splitOutsideParens(inner);
        if (!parts.length) return null;

        const segs = [];
        segs.push(makeTextSeg(`《${groupName}》 [`));

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i].trim();
            if (!part) continue;

            const item = parsePatchDisplayItem(part);
            if (item && item.segments && item.segments.length) {
                segs.push(...item.segments);
            } else {
                segs.push(makeTextSeg(part));
            }

            if (i < parts.length - 1) {
                segs.push(makeTextSeg("、"));
            }
        }

        segs.push(makeTextSeg("]"));
        return makeItem(segs);
    }

    function parsePatchDisplayItem(text) {
        const normalizedText = text.trim();

        // 优先团体解析
        const group = parseGroupWithCVs(normalizedText);
        if (group) return group;

        // 原有解析：CV
        const cvMatch = normalizedText.match(/^(.*?\(CV:)([^(){}]+)(?:\{(p:\d+|n:[^}]+)\})?(\))$/);
        if (cvMatch) {
            return makeItem([
                makeTextSeg(cvMatch[1]),
                makeEntitySeg(cvMatch[2].trim(), cvMatch[3] || null),
                makeTextSeg(cvMatch[4])
            ]);
        }

        // joinedArtist
        const joinedArtist = tryParseJoinedArtistItem(normalizedText);
        if (joinedArtist) {
            return joinedArtist;
        }

        const embedded = tryParseEmbeddedParenItem(normalizedText);
        if (embedded) {
            return embedded;
        }

        const parsed = parseNameWithOptionalRef(normalizedText);
        return makeItem([makeEntitySeg(parsed.text, parsed.ref)]);
    }

    /**
     * 「职位-子职位」的条目：名字会带上 “ (子职位)” 后缀，
     * 例如 乐器-Guitar -> `名字 (Guitar)`；显示方式由「子职位显示方式」控制。
     */
    function parsePatchSubRoleItem(name, subRole) {
        const embedded = tryParseEmbeddedParenItem(name);
        if (embedded) {
            embedded.segments.push(makeTextSeg(` (${subRole})`));
            return embedded;
        }

        const parsed = parseNameWithOptionalRef(name);
        return makeItem([
            makeEntitySeg(parsed.text, parsed.ref),
            makeTextSeg(` (${subRole})`)
        ]);
    }

    function resolvePersonText(ref, text, people = {}) {
        if (text) return text;

        if (ref && /^p:\d+$/.test(ref)) {
            const id = ref.replace(/^p:/, "");
            return people[id] || `#${id}`;
        }

        return "";
    }

    function normalizeLegacyValueToItem(value, roleKey, people = {}) {
        if (typeof value === "string") {
            if (/^p:\d+$/.test(value)) {
                return makeItem([makeEntitySeg(resolvePersonText(value, null, people), value)]);
            }
            if (/^n:/.test(value)) {
                return makeItem([makeEntitySeg(value.replace(/^n:/, ""), null)]);
            }
            return makeItem([makeEntitySeg(value, null)]);
        }

        if (!value || typeof value !== "object") {
            return makeItem([makeTextSeg(String(value ?? ""))]);
        }

        if (Array.isArray(value.parts)) {
            return makeItem(
                value.parts.map(part => {
                    if (typeof part === "string") return makeTextSeg(part);
                    const ref = part.ref || null;
                    const text = resolvePersonText(ref, part.text || null, people);
                    return makeEntitySeg(text, ref);
                })
            );
        }

        if (value.type === "person" && value.person) {
            const ref = value.person.ref || null;
            const text = resolvePersonText(ref, value.person.text || null, people);
            return makeItem([makeEntitySeg(text, ref)]);
        }

        if (value.type === "alias_person") {
            const segs = [];
            if (value.alias) {
                const aliasRef = value.alias.ref || null;
                const aliasText = resolvePersonText(aliasRef, value.alias.text || null, people);
                segs.push(makeEntitySeg(aliasText, null, true));
            }
            segs.push(makeTextSeg(" ("));
            if (value.person) {
                const personRef = value.person.ref || null;
                const personText = resolvePersonText(personRef, value.person.text || null, people);
                segs.push(makeEntitySeg(personText, personRef));
            }
            segs.push(makeTextSeg(")"));
            return makeItem(segs);
        }

        if (value.type === "cv_credit") {
            const cvRef = value.cv?.ref || null;
            const cvText = resolvePersonText(cvRef, value.cv?.text || null, people);
            return makeItem([
                makeTextSeg(`${value.character || ""}(CV:`),
                makeEntitySeg(cvText, cvRef),
                makeTextSeg(")")
            ]);
        }

        if (value.type === "alias_instrument_credit") {
            const aliasRef = value.alias?.ref || null;
            const aliasText = resolvePersonText(aliasRef, value.alias?.text || null, people);

            const personRef = value.person?.ref || null;
            const personText = resolvePersonText(personRef, value.person?.text || null, people);

            return makeItem([
                makeEntitySeg(aliasText, null, true),
                makeTextSeg(" ("),
                makeEntitySeg(personText, personRef),
                makeTextSeg(`) (${value.inst || ""})`)
            ]);
        }

        if (value.type === "instrument_credit" || value.inst) {
            const ref = value.person?.ref || value.ref || null;
            const text = resolvePersonText(ref, value.person?.text || value.text || null, people);
            return makeItem([
                makeEntitySeg(text, ref),
                makeTextSeg(` (${value.inst || ""})`)
            ]);
        }

        if (value.type === "text") {
            return makeItem([makeEntitySeg(value.text || "", null)]);
        }

        if (value.ref || value.text) {
            const ref = value.ref || null;
            const text = resolvePersonText(ref, value.text || null, people);
            return makeItem([makeEntitySeg(text, ref)]);
        }

        return makeItem([makeTextSeg(JSON.stringify(value))]);
    }

    function isRenderableCreditObject(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;

        return (
            Array.isArray(value.parts) ||
            value.type === "person" ||
            value.type === "alias_person" ||
            value.type === "cv_credit" ||
            value.type === "instrument_credit" ||
            value.type === "alias_instrument_credit" ||
            value.type === "text" ||
            !!value.ref ||
            !!value.text ||
            !!value.inst ||
            !!value.person
        );
    }

    function normalizeAnyCreditValue(rawValue, roleKey, people = {}) {
        if (rawValue == null) return [];

        if (Array.isArray(rawValue)) {
            return rawValue.map(v => normalizeLegacyValueToItem(v, roleKey, people));
        }

        if (typeof rawValue === "string") {
            return [normalizeLegacyValueToItem(rawValue, roleKey, people)];
        }

        if (isRenderableCreditObject(rawValue)) {
            return [normalizeLegacyValueToItem(rawValue, roleKey, people)];
        }

        if (rawValue && typeof rawValue === "object") {
            // 可带子职位的职位：{ 子职位: [人...] } 结构按子职位展开
            if (PREFIXABLE_ROLE_KEYS.has(roleKey)) {
                const flattened = [];
                for (const [subRoleName, arr] of Object.entries(rawValue)) {
                    if (Array.isArray(arr)) {
                        for (const item of arr) {
                            if (isRenderableCreditObject(item)) {
                                flattened.push(normalizeLegacyValueToItem({ ...item, inst: item.inst || subRoleName }, roleKey, people));
                            } else if (typeof item === "string") {
                                flattened.push(
                                    normalizeLegacyValueToItem(
                                        {
                                            person: { ref: /^p:/.test(item) ? item : null, text: /^p:/.test(item) ? null : item },
                                            inst: subRoleName
                                        },
                                        roleKey,
                                        people
                                    )
                                );
                            }
                        }
                    } else if (isRenderableCreditObject(arr)) {
                        flattened.push(normalizeLegacyValueToItem({ ...arr, inst: arr.inst || subRoleName }, roleKey, people));
                    } else if (typeof arr === "string") {
                        flattened.push(
                            normalizeLegacyValueToItem(
                                {
                                    person: { ref: /^p:/.test(arr) ? arr : null, text: /^p:/.test(arr) ? null : arr },
                                    inst: subRoleName
                                },
                                roleKey,
                                people
                            )
                        );
                    }
                }
                return flattened;
            }

            const flattened = [];
            for (const value of Object.values(rawValue)) {
                flattened.push(...normalizeAnyCreditValue(value, roleKey, people));
            }
            return flattened;
        }

        return [];
    }

    function ensureCompareToggleStyle() {
        if (document.getElementById("bgm-staff-compare-style")) return;

        const style = document.createElement("style");
        style.id = "bgm-staff-compare-style";
        style.textContent = `
        .subject_ep_section {
            position: relative;
        }

/* 本组件渲染的 .epinfo：让职位标签与人名使用同一字号
   （不带标记的 .epinfo 是页面原生 / 其它组件渲染的，不在这里处理） */
.epinfo[data-staff-display-owned="1"],
.epinfo[data-staff-display-owned="1"] .tip,
.epinfo[data-staff-display-owned="1"] .l {
    font-size: 12px;
}

#bgm-staff-compare-toggle {
    position: absolute;
    z-index: 3;

    border: 1px solid #F09199;
    border-radius: 999px;
    padding: 1px 8px;
    cursor: pointer;
    font-size: 11px;
    line-height: 1.2;
    height: 1.2rem;
    box-sizing: border-box;
    white-space: nowrap;
    align-items: center;

    background: #F09199;
    color: #fff;
}

#bgm-staff-compare-toggle:hover {
    filter: brightness(0.96);
}

#bgm-staff-compare-toggle.is-on {
    background: #333;
    border-color: #555;
    color: #bbb;
}

#bgm-staff-hide-groups {
    position: absolute;
    z-index: 3;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 1.2rem;
    box-sizing: border-box;
    padding: 1px 8px;
    border: 1px solid #F09199;
    border-radius: 999px;
    background: #F09199;
    color: #fff;
    font-size: 11px;
    line-height: 1.2;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
}

#bgm-staff-hide-groups:hover {
    filter: brightness(0.96);
}

/* 勾选后与「原始显示」按钮同款深色 */
#bgm-staff-hide-groups.is-on {
    background: #333;
    border-color: #555;
    color: #bbb;
}

#bgm-staff-hide-groups input {
    margin: 0;
    accent-color: #fff;
}

#bgm-staff-hide-groups.is-on input {
    accent-color: #bbb;
}
    `;
        document.head.appendChild(style);
    }

    /* ---------与他人组件共存：.epinfo 去重--------- */

    // 本组件渲染的 .epinfo 会带上这个标记，用来和其它组件 / 页面原生的 .epinfo 区分。
    // 另一个组件（BGM音乐条目显示各曲目参与制作人员信息）会往同样的位置插入自己的
    // .epinfo，两者时序不定时页面上会出现两套显示，这里统一收敛成本组件这一套。
    const OWNED_EPINFO_ATTR = "data-staff-display-owned";

    function createEpinfoContainer() {
        const el = document.createElement("div");
        el.className = "epinfo";
        el.setAttribute(OWNED_EPINFO_ATTR, "1");
        return el;
    }

    function isOwnedEpinfo(el) {
        return !!el && typeof el.getAttribute === "function" &&
            el.getAttribute(OWNED_EPINFO_ATTR) === "1";
    }

    function isEpinfoElement(el) {
        return !!el && el.nodeType === 1 && !!el.classList && el.classList.contains("epinfo");
    }

    /** 移除同一容器下「非本组件渲染」的 .epinfo */
    function removeForeignEpinfo(containerEl) {
        if (!containerEl) return;

        Array.from(containerEl.children).forEach(child => {
            if (!isEpinfoElement(child)) return;
            if (isOwnedEpinfo(child)) return;
            child.remove();
        });
    }

    /** 清理整份曲目列表里非本组件渲染的 .epinfo（全局 + 逐曲目） */
    function removeAllForeignEpinfo() {
        const list = document.querySelector("ul.line_list_music");
        if (!list) return;

        removeForeignEpinfo(list);
        list.querySelectorAll("li").forEach(li => removeForeignEpinfo(li));
    }

    /**
     * 把其它组件渲染的 .epinfo 收进本组件的 base 里（仅在 base 还是空的时候）。
     *
     * 另一个组件显示的是站内关联，本组件的补丁只覆盖一部分条目 / 曲目，
     * 没有补丁覆盖的地方要靠它的显示兜底；所以清理它的 .epinfo 之前，
     * 先把内容吸收进 base，再用 base + patch 重新渲染，避免丢信息。
     *
     * @returns {boolean} 是否吸收到了新内容（吸收到就需要重渲染）
     */
    function absorbForeignEpinfoIntoBase() {
        const list = document.querySelector("ul.line_list_music");
        if (!list) return false;

        const trackRows = STAFF_DISPLAY_RUNTIME.trackRows;
        let absorbed = false;

        // 全局（条目级）
        const globalRows = STAFF_DISPLAY_RUNTIME.baseGlobalEpinfoRows || [];
        if (!globalRows.length) {
            const foreignGlobal = Array.from(list.children)
                .find(el => isEpinfoElement(el) && !isOwnedEpinfo(el));

            if (foreignGlobal) {
                STAFF_DISPLAY_RUNTIME.baseGlobalEpinfoRows =
                    cloneParsedRows(parseEpinfoRows(foreignGlobal));
                absorbed = true;
            }
        }

        // 逐曲目
        if (trackRows) {
            for (const [trackKey, li] of trackRows) {
                const base = STAFF_DISPLAY_RUNTIME.baseTrackState.get(trackKey);
                if (base && Array.isArray(base.rows) && base.rows.length) continue;

                const foreign = Array.from(li.children)
                    .find(el => isEpinfoElement(el) && !isOwnedEpinfo(el));
                if (!foreign) continue;

                const h6 = li.querySelector("h6");
                STAFF_DISPLAY_RUNTIME.baseTrackState.set(trackKey, {
                    title: h6 ? h6.textContent.trim().replace(/^\d+\s+/, "") : "",
                    rows: cloneParsedRows(parseEpinfoRows(foreign))
                });
                absorbed = true;
            }
        }

        return absorbed;
    }

    let epinfoDedupeTimer = null;
    let epinfoObserver = null;

    function scheduleEpinfoDedupe() {
        if (epinfoDedupeTimer) return;

        epinfoDedupeTimer = setTimeout(() => {
            epinfoDedupeTimer = null;
            if (!STAFF_DISPLAY_RUNTIME.trackRows) return;

            const list = document.querySelector("ul.line_list_music");
            if (!list) return;

            // 1) 先把别的组件的显示收进 base（base 还空着的位置）
            const absorbed = absorbForeignEpinfoIntoBase();

            // 2) 再去掉别的组件插进来的 .epinfo
            removeAllForeignEpinfo();

            // 3) 吸收了新内容 / 本组件的显示被整体清掉时，重新渲染
            if (absorbed || !list.querySelector(`.epinfo[${OWNED_EPINFO_ATTR}="1"]`)) {
                rerenderCurrentStaffDisplay();
            }
        }, 60);
    }

    function hasForeignEpinfo(node) {
        if (isEpinfoElement(node)) return !isOwnedEpinfo(node);
        if (!node.querySelectorAll) return false;
        return Array.from(node.querySelectorAll(".epinfo")).some(el => !isOwnedEpinfo(el));
    }

    /** 监听曲目列表变化，确保页面上只保留本组件渲染的那一套 .epinfo */
    function startEpinfoDedupeGuard() {
        if (epinfoObserver) return;

        const list = document.querySelector("ul.line_list_music");
        if (!list) return;

        epinfoObserver = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (hasForeignEpinfo(node)) {
                        scheduleEpinfoDedupe();
                        return;
                    }
                }
            }
        });

        epinfoObserver.observe(list, { childList: true, subtree: true });
    }

    function normalizeTrackCreditsToPatchMap(trackCredits = {}, people = {}) {
        const patchMap = {};

        for (const [trackKey, roleMap] of Object.entries(trackCredits || {})) {
            if (!patchMap[trackKey]) patchMap[trackKey] = {};

            for (const [roleKey, rawValue] of Object.entries(roleMap || {})) {
                if (roleKey === "title") continue;
                if (!rawValue) continue;

                const items = normalizeAnyCreditValue(rawValue, roleKey, people);
                if (items.length) {
                    patchMap[trackKey][roleKey] = items;
                }
            }
        }

        return patchMap;
    }

    function buildPatchMapFromData(data) {
        if (!data) return {};

        const patchMap = {};

        if (data.trackCredits || data.epinfo) {
            for (const [trackKey, roleMap] of Object.entries(data.trackCredits || {})) {
                if (!patchMap[trackKey]) patchMap[trackKey] = {};

                for (const [roleKey, rawValue] of Object.entries(roleMap || {})) {
                    if (roleKey === "title") continue;
                    if (!rawValue) continue;

                    const items = normalizeAnyCreditValue(rawValue, roleKey, data.people || {});
                    if (items.length) {
                        patchMap[trackKey][roleKey] = items;
                    }
                }
            }

            if (data.epinfo && typeof data.epinfo === "object") {
                patchMap[EPINFO_TRACK_KEY] = {};

                for (const [roleKey, rawValue] of Object.entries(data.epinfo || {})) {
                    if (!rawValue) continue;

                    const items = normalizeAnyCreditValue(rawValue, roleKey, data.people || {});
                    if (items.length) {
                        patchMap[EPINFO_TRACK_KEY][roleKey] = items;
                    }
                }

                if (!Object.keys(patchMap[EPINFO_TRACK_KEY]).length) {
                    delete patchMap[EPINFO_TRACK_KEY];
                }
            }

            return patchMap;
        }

        if (data.rawPatches) {
            return parseRawPatches(data.rawPatches);
        }

        return {};
    }

    function parseRawPatches(rawPatches) {
        const patchMap = {};

        const allLines = [];
        for (const value of Object.values(rawPatches || {})) {
            if (typeof value !== "string") continue;
            const lines = value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            allLines.push(...lines);
        }

        for (const line of allLines) {
            const split = splitPatchLine(line);
            if (!split) continue;

            const left = split.left;
            const right = split.right;

            let roleKey = null;
            let subRole = null;

            const normalizedLeft = String(left || "").trim();

            // 「职位-子职位」（乐器-Guitar / 设计-Web / 作曲-钢琴 ...）
            const subRoleMatch = matchPrefixableRoleLabel(normalizedLeft);
            if (subRoleMatch) {
                roleKey = subRoleMatch.roleKey;
                subRole = subRoleMatch.subRole;
            } else {
                const customMatch = normalizedLeft.match(/^custom\s*[-]\s*(.+)$/i);
                if (customMatch) {
                    const customLabel = customMatch[1].trim();
                    if (!customLabel) continue;
                    roleKey = `custom-${customLabel}`;
                } else {
                    const roles = LABEL_TO_ROLES[normalizedLeft];
                    if (!roles || roles.length !== 1) continue;
                    roleKey = roles[0];
                }
            }

            if (!roleKey || !right) continue;

            const entries = splitOutsideParens(right);

            for (const entry of entries) {
                const extracted = extractTrailingTrackExpr(entry);

                if (extracted) {
                    const { name, trackExpr } = extracted;
                    const trackKeys = expandTrackExpr(trackExpr);

                    for (const trackKey of trackKeys) {
                        if (!patchMap[trackKey]) patchMap[trackKey] = {};
                        if (!patchMap[trackKey][roleKey]) patchMap[trackKey][roleKey] = [];

                        patchMap[trackKey][roleKey].push(
                            subRole
                                ? parsePatchSubRoleItem(name, subRole)
                                : parsePatchDisplayItem(name)
                        );
                    }

                    continue;
                }

                // 无曲目标记 -> epinfo
                // （沿用原行为：epinfo 不收乐器；其余职位、含子职位，正常收入）
                if (roleKey === "instrument") continue;

                const plainName = entry.trim();
                if (!plainName) continue;

                if (!patchMap[EPINFO_TRACK_KEY]) patchMap[EPINFO_TRACK_KEY] = {};
                if (!patchMap[EPINFO_TRACK_KEY][roleKey]) patchMap[EPINFO_TRACK_KEY][roleKey] = [];

                patchMap[EPINFO_TRACK_KEY][roleKey].push(
                    subRole
                        ? parsePatchSubRoleItem(plainName, subRole)
                        : parsePatchDisplayItem(plainName)
                );
            }
        }

        return patchMap;
    }

    function getGlobalEpinfoElement() {
        return document.querySelector("ul.line_list_music > .epinfo");
    }

    function snapshotBaseGlobalEpinfoState() {
        const epinfo = getGlobalEpinfoElement();
        STAFF_DISPLAY_RUNTIME.baseGlobalEpinfoRows = epinfo
            ? cloneParsedRows(parseEpinfoRows(epinfo))
            : [];
    }

    function rebuildOriginalGlobalEpinfo() {
        const list = document.querySelector("ul.line_list_music");
        if (!list) return;

        const current = getGlobalEpinfoElement();
        const rows = STAFF_DISPLAY_RUNTIME.baseGlobalEpinfoRows || [];

        if (!rows.length) {
            // 同上：只清本组件渲染的那一份
            if (isOwnedEpinfo(current) && current.parentNode) current.remove();
            return;
        }

        const newEpinfo = createEpinfoContainer();

        for (const row of rows) {
            newEpinfo.appendChild(document.createTextNode(row.indent || "　　　　"));

            const labelSpan = document.createElement("span");
            labelSpan.className = "tip";
            labelSpan.textContent = row.label;
            newEpinfo.appendChild(labelSpan);

            newEpinfo.appendChild(document.createTextNode(row.colonText || "："));

            for (const node of row.nodes || []) {
                newEpinfo.appendChild(node.cloneNode(true));
            }

            newEpinfo.appendChild(document.createElement("br"));
        }

        if (current && current.parentNode) {
            current.replaceWith(newEpinfo);
        } else {
            list.insertBefore(newEpinfo, list.firstChild);
        }

        removeForeignEpinfo(list);
    }

    function collectTrackRows() {
        const list = document.querySelector("ul.line_list_music");
        const map = new Map();
        if (!list) return map;

        let currentDisc = 1;

        for (const li of list.querySelectorAll(":scope > li")) {
            if (li.classList.contains("cat")) {
                // Disc 标题可能已被 Disc 信息增强改写成「Disc 1 - Profectio」，
                // 优先读模块写入的碟号，读不到再退回文本匹配
                const discNo = Number(li.dataset.bgmDmNo || 0);

                if (discNo) {
                    currentDisc = discNo;
                } else {
                    const m = li.textContent.match(/Disc\s+(\d+)/i);
                    if (m) currentDisc = Number(m[1]);
                }

                continue;
            }

            if (!li.classList.contains("line_odd") && !li.classList.contains("line_even")) {
                continue;
            }

            const h6 = li.querySelector("h6");
            if (!h6) continue;

            const text = h6.textContent.trim();
            const m = text.match(/^(\d+)\s+/);
            if (!m) continue;

            const trackNo = Number(m[1]);
            map.set(`${currentDisc}.${trackNo}`, li);
        }

        return map;
    }

    function cloneParsedRows(rows) {
        return rows.map(row => ({
            label: row.label,
            indent: row.indent,
            colonText: row.colonText,
            nodes: row.nodes.map(node => node.cloneNode(true))
        }));
    }

    function snapshotBaseTrackState(trackRows) {
        STAFF_DISPLAY_RUNTIME.baseTrackState.clear();

        for (const [trackKey, li] of trackRows) {
            const epinfo = li.querySelector(".epinfo");
            const h6 = li.querySelector("h6");
            if (!h6) continue;

            STAFF_DISPLAY_RUNTIME.baseTrackState.set(trackKey, {
                title: h6.textContent.trim().replace(/^\d+\s+/, ""),
                rows: epinfo ? cloneParsedRows(parseEpinfoRows(epinfo)) : []
            });
        }
    }

    function parseEpinfoRows(epinfo) {
        const rows = [];
        const nodes = Array.from(epinfo.childNodes);
        let indent = "　　　　";

        for (let i = 0; i < nodes.length;) {
            let currentIndent = "";
            while (i < nodes.length && nodes[i].nodeType === Node.TEXT_NODE) {
                const t = nodes[i].textContent || "";
                if (/[^\\s\\u3000：:]/.test(t)) break;
                currentIndent += t;
                i++;
            }

            if (!currentIndent) currentIndent = indent;
            else indent = currentIndent;

            if (i >= nodes.length) break;

            const tipNode = nodes[i];
            if (!(tipNode.nodeType === Node.ELEMENT_NODE && tipNode.tagName === "SPAN" && tipNode.classList.contains("tip"))) {
                i++;
                continue;
            }

            const label = tipNode.textContent.trim().replace(/：$/, "").replace(/:$/, "");
            i++;

            let colonText = "：";
            if (i < nodes.length && nodes[i].nodeType === Node.TEXT_NODE) {
                const t = nodes[i].textContent || "";
                const m = t.match(/^([：:]+)/);
                if (m) {
                    colonText = m[1];
                    const rest = t.slice(m[1].length);
                    i++;

                    const contentNodes = [];
                    if (rest) contentNodes.push(document.createTextNode(rest));

                    while (i < nodes.length) {
                        const n = nodes[i];
                        if (n.nodeType === Node.ELEMENT_NODE && n.tagName === "BR") {
                            i++;
                            rows.push({
                                label,
                                indent: currentIndent || "　　　　",
                                colonText,
                                nodes: contentNodes
                            });
                            break;
                        }
                        contentNodes.push(n.cloneNode(true));
                        i++;
                    }

                    if (i >= nodes.length) {
                        rows.push({
                            label,
                            indent: currentIndent || "　　　　",
                            colonText,
                            nodes: contentNodes
                        });
                    }
                    continue;
                }
            }

            const contentNodes = [];
            while (i < nodes.length) {
                const n = nodes[i];
                if (n.nodeType === Node.ELEMENT_NODE && n.tagName === "BR") {
                    i++;
                    break;
                }
                contentNodes.push(n.cloneNode(true));
                i++;
            }

            rows.push({
                label,
                indent: currentIndent || "　　　　",
                colonText,
                nodes: contentNodes
            });
        }

        return rows;
    }

    function splitFragmentNodesOutsideParens(nodes) {
        const result = [];
        let current = [];
        let depth = 0;

        function flush() {
            const meaningful = current.some(n => {
                if (n.nodeType === Node.TEXT_NODE) return n.textContent.trim();
                return true;
            });
            if (meaningful) result.push(current);
            current = [];
        }

        for (const node of nodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent || "";
                let buf = "";

                for (const ch of text) {
                    if (ch === "(" || ch === "（") depth++;
                    if (ch === ")" || ch === "）") depth = Math.max(0, depth - 1);

                    if (ch === "、" && depth === 0) {
                        if (buf) {
                            current.push(document.createTextNode(buf));
                            buf = "";
                        }
                        flush();
                    } else {
                        buf += ch;
                    }
                }

                if (buf) current.push(document.createTextNode(buf));
            } else {
                current.push(node.cloneNode(true));
            }
        }

        flush();
        return result;
    }

    function parseNodesToItem(nodes) {
        const segments = [];

        for (const node of nodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent || "";
                if (text) segments.push(makeTextSeg(text));
            } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "A") {
                const href = node.getAttribute("href") || "";
                const text = node.textContent.trim();
                const m = href.match(/\/person\/(\d+)/);
                segments.push(makeEntitySeg(text, m ? `p:${m[1]}` : null));
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const text = node.textContent || "";
                if (text) segments.push(makeTextSeg(text));
            }
        }

        return makeItem(segments);
    }

    function parseExistingRoleItems(nodes) {
        const groups = splitFragmentNodesOutsideParens(nodes);
        return groups.map(parseNodesToItem);
    }

    /** 给条目补上 “ (子职位)” 后缀（用于解析页面上已渲染的「职位-子职位」行） */
    function appendSubRoleToItem(item, subRole) {
        const cloned = cloneDisplayItem(item);
        const segs = cloned.segments || [];
        const last = segs[segs.length - 1];

        // 末尾已经是 “ (xxx)” 就不重复补
        if (last && last.kind === "text" && /^\s*\([^()]+\)\s*$/.test(last.text)) {
            return cloned;
        }

        segs.push(makeTextSeg(` (${subRole})`));
        return cloned;
    }

    function buildRoleDataFromRows(rows) {
        const roleData = {};
        const extras = [];

        for (const row of rows) {
            // 「职位-子职位」行（如 乐器-Guitar：xxx）
            const subRoleMatch = matchPrefixableRoleLabel(row.label);
            if (subRoleMatch) {
                const items = parseExistingRoleItems(row.nodes)
                    .map(item => appendSubRoleToItem(item, subRoleMatch.subRole));

                roleData[subRoleMatch.roleKey] =
                    (roleData[subRoleMatch.roleKey] || []).concat(items);
                continue;
            }

            const roles = resolveLabelToRoles(row.label);
            if (!roles) {
                extras.push(row);
                continue;
            }

            const items = parseExistingRoleItems(row.nodes);
            for (const roleKey of roles) {
                roleData[roleKey] = items;
            }
        }

        return { roleData, extras, indent: rows[0]?.indent || "　　　　" };
    }

    function normalizeRoleItems(items) {
        return JSON.stringify(items);
    }

    function mergeRolesForRender(roleData) {
        const groups = [];
        const seen = new Set();

        // 子职位拆分结果缓存（roleKey -> splitItemsBySubRole 结果）
        const subRoleSplits = new Map();

        function getSubRoleSplit(roleKey) {
            if (subRoleSplits.has(roleKey)) return subRoleSplits.get(roleKey);

            const items = roleData[roleKey];
            const result = (PREFIXABLE_ROLE_KEYS.has(roleKey) && Array.isArray(items) && items.length)
                ? splitItemsBySubRole(items)
                : { parsedCount: 0, groups: [] };

            subRoleSplits.set(roleKey, result);
            return result;
        }

        function hasSubRoleItems(roleKey) {
            return getSubRoleSplit(roleKey).parsedCount > 0;
        }

        // 整首曲只有一个人（所有非空职位的人完全相同）时，允许跨组合并成一行；
        // 否则严格按 ROLE_MERGE_GROUPS 分段合并，避免顺序错乱
        const allSignatures = new Set();
        Object.values(roleData || {}).forEach(items => {
            if (!Array.isArray(items) || !items.length) return;
            allSignatures.add(normalizeRoleItems(items));
        });
        const singlePersonTrack = allSignatures.size === 1;

        for (const roleKey of ROLE_ORDER) {
            const items = roleData[roleKey];
            if (!items || !items.length || seen.has(roleKey)) continue;

            // 含子职位的职位：按「子职位显示方式」拆分 / 合并显示，不参与跨职位合并
            if (hasSubRoleItems(roleKey)) {
                const splitResult = getSubRoleSplit(roleKey);
                const baseLabel = ROLE_LABELS[roleKey] || roleKey;

                // 只有一个子职位（且没有无子职位的散条目）时，拆分没有意义：
                // 标签会变成「Main Vocals」/「声乐-Main Vocals」，人名上也看不到子职位。
                // 这种情况退回合并显示：
                //   声乐：あしゅ (Main Vocals)、暁星ちかげ (Main Vocals)、…
                const onlyOneSubRole =
                    splitResult.groups.length === 1 &&
                    splitResult.groups[0].label !== "__fallback__";

                if (instrumentDisplayMode === "by_instrument" && !onlyOneSubRole) {
                    for (const group of splitResult.groups) {
                        groups.push({
                            roles: [roleKey],
                            items: group.items,
                            labelOverride: group.label === "__fallback__"
                                ? baseLabel
                                : (subRoleLabelMode === "with_prefix"
                                    ? `${baseLabel}-${group.label}`
                                    : group.label)
                        });
                    }
                } else if (instrumentDisplayMode === "inline_by_instrument") {
                    groups.push({
                        roles: [roleKey],
                        items,
                        labelOverride: baseLabel,
                        inlineSubRoleGroups: splitResult.groups
                    });
                } else {
                    groups.push({ roles: [roleKey], items });
                }

                seen.add(roleKey);
                continue;
            }

            // 无子职位：只与 ROLE_ORDER 里「紧邻且人完全相同」的职位合并成一行，
            // 于是 作词+作曲 -> 作词、作曲；作曲+编曲 -> 作曲、编曲；混音+录音 -> 混音、录音。
            // 中间一旦出现「别人担任」的职位就断开——例如 作词、编曲 之间夹着别人的作曲时，
            // 不再合并，各自回到自己的顺序位置单独显示。
            const signature = normalizeRoleItems(items);
            const mergedRoles = [roleKey];
            const mergeGroup = ROLE_MERGE_GROUPS.find(group => group.includes(roleKey));
            seen.add(roleKey);

            for (let i = ROLE_ORDER.indexOf(roleKey) + 1; i < ROLE_ORDER.length; i++) {
                const otherRole = ROLE_ORDER[i];
                if (seen.has(otherRole)) break;

                const otherItems = roleData[otherRole];
                if (!Array.isArray(otherItems) || !otherItems.length) continue; // 空职位不阻断

                // 有内容但不是「同组同人」-> 断开
                if (hasSubRoleItems(otherRole)) break;
                if (!singlePersonTrack && (!mergeGroup || !mergeGroup.includes(otherRole))) break;
                if (normalizeRoleItems(otherItems) !== signature) break;

                mergedRoles.push(otherRole);
                seen.add(otherRole);
            }

            groups.push({ roles: mergedRoles, items });
        }

        /* ---------自定义职位--------- */
        // 追加剩余角色（custom-*），自定义职位排在最后
        const restRoleKeys = Object.keys(roleData || {})
            .filter(roleKey => !seen.has(roleKey) && Array.isArray(roleData[roleKey]) && roleData[roleKey].length)
            .sort((a, b) => {
                const aCustom = isCustomRoleKey(a);
                const bCustom = isCustomRoleKey(b);
                if (aCustom !== bCustom) return aCustom ? 1 : -1;
                return getRenderRoleLabel(a).localeCompare(getRenderRoleLabel(b), "zh-Hans-CN");
            });

        for (const roleKey of restRoleKeys) {
            groups.push({ roles: [roleKey], items: roleData[roleKey] });
            seen.add(roleKey);
        }
        /* ---------自定义职位--------- */

        return groups;
    }

    function getMergedRoleLabel(roleKeys) {
        return roleKeys.map(getRenderRoleLabel).join("、");
    }

    function buildGlobalLinkMap() {
        const map = new Map();
        document.querySelectorAll("a[href*='/person/']").forEach(a => {
            const text = a.textContent.trim();
            const href = a.getAttribute("href");
            if (text && href && !map.has(text)) {
                map.set(text, href);
            }
        });
        return map;
    }

    function createLinkedOrText(seg, globalMap) {
        if (seg.kind === "text") {
            return document.createTextNode(seg.text);
        }

        if (seg.noLink) {
            return document.createTextNode(seg.text);
        }

        if (seg.ref && /^p:\d+$/.test(seg.ref)) {
            const a = document.createElement("a");
            a.href = `/person/${seg.ref.replace(/^p:/, "")}`;
            a.className = "l";
            a.textContent = seg.text;
            return a;
        }

        const href = globalMap.get(seg.text);
        if (!href) return document.createTextNode(seg.text);

        const a = document.createElement("a");
        a.href = href;
        a.className = "l";
        a.textContent = seg.text;
        return a;
    }

    function renderItems(items, globalMap) {
        const frag = document.createDocumentFragment();

        items.forEach((item, idx) => {
            for (const rawSeg of item.segments) {
                for (const seg of expandGroupSegments(rawSeg)) {
                    if (hideGroupAnnotations && seg.group) continue;
                    frag.appendChild(createLinkedOrText(seg, globalMap));
                }
            }
            if (idx < items.length - 1) {
                frag.appendChild(document.createTextNode("、"));
            }
        });

        return frag;
    }

    function cloneDisplayItem(item) {
        return makeItem(
            (item?.segments || []).map(seg => ({ ...seg }))
        );
    }

    function splitSubRoleItemForDisplay(item) {
        const cloned = cloneDisplayItem(item);
        const segs = cloned.segments || [];
        if (!segs.length) return null;

        const last = segs[segs.length - 1];
        if (!last || last.kind !== "text") return null;

        // 团体标注（@团体 / (团体)）不是子职位，不能抬到职位名上
        if (isGroupLikeSeg(last)) return null;

        // 普通：名字 (Guitar)
        let m = last.text.match(/^\s*\(([^()]+)\)\s*$/);
        if (m) {
            segs.pop();
            return {
                subRole: m[1].trim(),
                item: cloned
            };
        }

        // alias：别名 (真名) (Guitar)
        m = last.text.match(/^\)\s*\(([^()]+)\)\s*$/);
        if (m) {
            segs[segs.length - 1] = makeTextSeg(")");
            return {
                subRole: m[1].trim(),
                item: cloned
            };
        }

        return null;
    }

    function splitItemsBySubRole(items) {
        const grouped = new Map();
        let parsedCount = 0;

        for (const item of items || []) {
            const parsed = splitSubRoleItemForDisplay(item);

            if (!parsed) {
                if (!grouped.has("__fallback__")) grouped.set("__fallback__", []);
                grouped.get("__fallback__").push(item);
                continue;
            }

            parsedCount++;

            if (!grouped.has(parsed.subRole)) grouped.set(parsed.subRole, []);
            grouped.get(parsed.subRole).push(parsed.item);
        }

        return {
            parsedCount,
            groups: Array.from(grouped.entries()).map(([label, items]) => ({
                label,
                items
            }))
        };
    }

    function renderInlineSubRoleGroups(subRoleGroups, globalMap) {
        const frag = document.createDocumentFragment();

        subRoleGroups.forEach((group, idx) => {
            if (group.label === "__fallback__") {
                frag.appendChild(renderItems(group.items, globalMap));
            } else {
                frag.appendChild(document.createTextNode(`${group.label}: `));
                frag.appendChild(renderItems(group.items, globalMap));
            }

            if (idx < subRoleGroups.length - 1) {
                frag.appendChild(document.createTextNode(" | "));
            }
        });

        return frag;
    }

    function getComparableUnitsForDisplayItem(item) {
        const segs = item?.segments || [];
        const units = [];

        // alias_person: 别名 (真实人物)
        if (
            segs.length === 4 &&
            segs[0]?.kind === "entity" &&
            segs[1]?.kind === "text" &&
            segs[1].text === " (" &&
            segs[2]?.kind === "entity" &&
            segs[3]?.kind === "text" &&
            segs[3].text === ")"
        ) {
            const alias = normalizeCompareText(segs[0].text || "");
            if (alias) units.push(alias);
            return units;
        }

        // 普通情况：把所有 entity 都展开
        for (const seg of segs) {
            if (seg.kind === "entity" && seg.text) {
                const name = normalizeCompareText(seg.text);
                if (name) units.push(name);
            }
        }

        return [...new Set(units)];
    }

    function buildComparableUnitSetForDisplay(items) {
        const set = new Set();

        for (const item of items || []) {
            for (const unit of getComparableUnitsForDisplayItem(item)) {
                set.add(unit);
            }
        }

        return set;
    }

    function hasCompositeDisplayItem(items) {
        return (items || []).some(item => {
            const entityCount = (item?.segments || []).filter(seg => seg.kind === "entity").length;
            return entityCount >= 2;
        });
    }

    function baseDisplayCanCoverPatchedItems(baseItems, patchedItems) {
        const baseSet = buildComparableUnitSetForDisplay(baseItems);
        const patchSet = buildComparableUnitSetForDisplay(patchedItems);

        if (!baseSet.size || !patchSet.size) return false;

        for (const unit of patchSet) {
            if (!baseSet.has(unit)) return false;
        }

        return true;
    }

    function normalizeCompareText(text) {
        return (text || "")
            .trim()
            .normalize("NFKC")
            .replace(/\s+/g, " ");
    }

    function getItemAliasTexts(item) {
        const segs = item?.segments || [];
        const names = [];

        if (segs[0]?.kind === "entity" && segs[0]?.text) {
            names.push(normalizeCompareText(segs[0].text));
        }

        if (segs.length === 1 && segs[0]?.kind === "entity" && segs[0]?.text) {
            names.push(normalizeCompareText(segs[0].text));
        }

        return [...new Set(names.filter(Boolean))];
    }

    function itemHasStrongAssociation(item) {
        const segs = item?.segments || [];
        const entitySegs = segs.filter(seg => seg.kind === "entity");
        const refCount = entitySegs.filter(seg => seg.ref && /^p:\d+$/.test(seg.ref)).length;

        // 有两个实体，通常就是 alias_person / alias_instrument / 之类更强结构
        if (entitySegs.length >= 2) return true;

        // 单实体但已经有明确 person ref，也算强
        if (refCount >= 1) return true;

        return false;
    }

    function itemsReferSameAlias(patchItem, baseItem) {
        const a = new Set(getItemAliasTexts(patchItem));
        const b = new Set(getItemAliasTexts(baseItem));

        for (const name of a) {
            if (b.has(name)) return true;
        }
        return false;
    }

    function chooseBetterItem(patchItem, baseItems) {
        // repo 里已经是强信息，就保留 repo
        if (itemHasStrongAssociation(patchItem)) {
            return patchItem;
        }

        for (const baseItem of baseItems || []) {
            if (!itemsReferSameAlias(patchItem, baseItem)) continue;
            if (!itemHasStrongAssociation(baseItem)) continue;
            return baseItem;
        }

        return patchItem;
    }

    function upgradePatchedItemsWithBaseItems(patchedItems, baseItems) {
        if (!Array.isArray(patchedItems) || !patchedItems.length) return patchedItems || [];
        if (!Array.isArray(baseItems) || !baseItems.length) return patchedItems;

        // 如果 base 已经是更强的复合展示（如 feat./vs），
        // 且它覆盖了 repo patch 里的全部人物单元，就整体沿用 base
        if (hasCompositeDisplayItem(baseItems) && baseDisplayCanCoverPatchedItems(baseItems, patchedItems)) {
            return baseItems;
        }

        return patchedItems.map(item => chooseBetterItem(item, baseItems));
    }

    function rebuildEpinfo(epinfo, li, finalRoleData, extras, indent, globalMap) {
        const groups = mergeRolesForRender(finalRoleData);
        const hasContent = groups.length > 0 || (extras && extras.length > 0);

        if (!hasContent) {
            // 只移除本组件渲染的那一份；别的组件 / 页面原生的先留着，
            // 交给去重逻辑（它会先把内容吸收进 base，再清理）
            if (isOwnedEpinfo(epinfo) && epinfo.parentNode) {
                epinfo.remove();
            }
            return;
        }

        const newEpinfo = createEpinfoContainer();

        for (const group of groups) {
            newEpinfo.appendChild(document.createTextNode(indent || "　　　　"));

            const labelSpan = document.createElement("span");
            labelSpan.className = "tip";
            // labelSpan.textContent = getMergedRoleLabel(group.roles);
            labelSpan.textContent = group.labelOverride || getMergedRoleLabel(group.roles);
            newEpinfo.appendChild(labelSpan);

            newEpinfo.appendChild(document.createTextNode("："));

            if (group.inlineSubRoleGroups) {
                newEpinfo.appendChild(renderInlineSubRoleGroups(group.inlineSubRoleGroups, globalMap));
            } else {
                newEpinfo.appendChild(renderItems(group.items, globalMap));
            }

            newEpinfo.appendChild(document.createElement("br"));
        }

        for (const row of extras || []) {
            newEpinfo.appendChild(document.createTextNode(row.indent || indent || "　　　　"));

            const labelSpan = document.createElement("span");
            labelSpan.className = "tip";
            labelSpan.textContent = row.label;
            newEpinfo.appendChild(labelSpan);

            newEpinfo.appendChild(document.createTextNode(row.colonText || "："));
            for (const node of row.nodes) {
                newEpinfo.appendChild(node.cloneNode(true));
            }
            newEpinfo.appendChild(document.createElement("br"));
        }

        if (epinfo && epinfo.parentNode) {
            epinfo.replaceWith(newEpinfo);
        } else if (li) {
            const h6 = li.querySelector("h6");
            if (h6 && h6.parentNode === li) {
                h6.insertAdjacentElement("afterend", newEpinfo);
            } else {
                li.appendChild(newEpinfo);
            }
        }

        removeForeignEpinfo(li);
    }

    function rebuildGlobalEpinfo(finalRoleData, globalMap) {
        const list = document.querySelector("ul.line_list_music");
        if (!list) return;

        const current = getGlobalEpinfoElement();
        const rows = STAFF_DISPLAY_RUNTIME.baseGlobalEpinfoRows || [];
        const repoOnly = hasCustomRoleInRoleMap(finalRoleData);

        let roleData = {};
        let extras = [];
        let indent = "　　　　";

        if (!repoOnly) {
            const parsedBase = rows.length
                ? buildRoleDataFromRows(cloneParsedRows(rows))
                : { roleData: {}, extras: [], indent: "　　　　" };

            roleData = parsedBase.roleData || {};
            extras = parsedBase.extras || [];
            indent = parsedBase.indent || "　　　　";
        }

        for (const [roleKey, items] of Object.entries(finalRoleData || {})) {
            if (!Array.isArray(items) || !items.length) continue;

            if (repoOnly) {
                roleData[roleKey] = items;
            } else {
                const baseItems = roleData[roleKey] || [];
                roleData[roleKey] = upgradePatchedItemsWithBaseItems(items, baseItems);
            }
        }

        const groups = mergeRolesForRender(roleData);
        const hasContent = groups.length > 0 || (!repoOnly && extras.length > 0);

        if (!hasContent) {
            // 同上：只清本组件渲染的那一份
            if (isOwnedEpinfo(current) && current.parentNode) current.remove();
            return;
        }

        const newEpinfo = createEpinfoContainer();

        for (const group of groups) {
            newEpinfo.appendChild(document.createTextNode(indent || "　　　　"));

            const labelSpan = document.createElement("span");
            labelSpan.className = "tip";
            labelSpan.textContent = group.labelOverride || getMergedRoleLabel(group.roles);
            newEpinfo.appendChild(labelSpan);

            newEpinfo.appendChild(document.createTextNode("："));

            if (group.inlineSubRoleGroups) {
                newEpinfo.appendChild(renderInlineSubRoleGroups(group.inlineSubRoleGroups, globalMap));
            } else {
                newEpinfo.appendChild(renderItems(group.items, globalMap));
            }

            newEpinfo.appendChild(document.createElement("br"));
        }

        if (!repoOnly) {
            for (const row of extras || []) {
                newEpinfo.appendChild(document.createTextNode(row.indent || indent || "　　　　"));

                const labelSpan = document.createElement("span");
                labelSpan.className = "tip";
                labelSpan.textContent = row.label;
                newEpinfo.appendChild(labelSpan);

                newEpinfo.appendChild(document.createTextNode(row.colonText || "："));

                for (const node of row.nodes || []) {
                    newEpinfo.appendChild(node.cloneNode(true));
                }

                newEpinfo.appendChild(document.createElement("br"));
            }
        }

        if (current && current.parentNode) {
            current.replaceWith(newEpinfo);
        } else {
            list.insertBefore(newEpinfo, list.firstChild);
        }

        removeForeignEpinfo(list);
    }

    function rebuildOriginalEpinfo(epinfo, li, rows) {
        const hasRows = Array.isArray(rows) && rows.length > 0;

        if (!hasRows) {
            // 同上：只清本组件渲染的那一份
            if (isOwnedEpinfo(epinfo) && epinfo.parentNode) {
                epinfo.remove();
            }
            return;
        }

        const newEpinfo = createEpinfoContainer();

        for (const row of rows) {
            newEpinfo.appendChild(document.createTextNode(row.indent || "　　　　"));

            const labelSpan = document.createElement("span");
            labelSpan.className = "tip";
            labelSpan.textContent = row.label;
            newEpinfo.appendChild(labelSpan);

            newEpinfo.appendChild(document.createTextNode(row.colonText || "："));

            for (const node of row.nodes || []) {
                newEpinfo.appendChild(node.cloneNode(true));
            }

            newEpinfo.appendChild(document.createElement("br"));
        }

        if (epinfo && epinfo.parentNode) {
            epinfo.replaceWith(newEpinfo);
        } else if (li) {
            const h6 = li.querySelector("h6");
            if (h6 && h6.parentNode === li) {
                h6.insertAdjacentElement("afterend", newEpinfo);
            } else {
                li.appendChild(newEpinfo);
            }
        }

        removeForeignEpinfo(li);
    }

    function renderRawTrackFromBase(li, trackKey) {
        const base = STAFF_DISPLAY_RUNTIME.baseTrackState.get(trackKey);
        if (!base) return;

        const epinfo = li.querySelector(".epinfo");
        rebuildOriginalEpinfo(epinfo, li, cloneParsedRows(base.rows || []));
    }

    function applyTrackPatch(epinfo, trackPatch, globalMap) {
        const li = epinfo ? epinfo.closest("li") : null;
        const repoOnly = hasCustomRoleInRoleMap(trackPatch);

        let roleData = {};
        let extras = [];
        let indent = "　　　　";

        if (!repoOnly) {
            const rows = epinfo ? parseEpinfoRows(epinfo) : [];
            const parsedBase = rows.length
                ? buildRoleDataFromRows(rows)
                : { roleData: {}, extras: [], indent: "　　　　" };

            roleData = parsedBase.roleData || {};
            extras = parsedBase.extras || [];
            indent = parsedBase.indent || "　　　　";
        }

        for (const [roleKey, items] of Object.entries(trackPatch || {})) {
            if (!Array.isArray(items) || !items.length) continue;

            if (repoOnly) {
                roleData[roleKey] = items;
            } else {
                roleData[roleKey] = items;
            }
        }

        rebuildEpinfo(epinfo, li, roleData, extras, indent, globalMap);
    }

    function findEpinfoToggleAnchor() {
        return document.querySelector(".subject_ep_section .epinfo-toggle, #epinfo-toggle");
    }

    // 另一个组件的 .epinfo-toggle 是它脚本一加载就同步插入的，等一小会儿即可；
    // 等不到（单独使用本组件）就先用兜底位置，之后再出现会被重新贴合。
    async function waitForEpinfoToggleAnchor(timeoutMs = 1500) {
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            const anchor = findEpinfoToggleAnchor();
            if (anchor) return anchor;
            await sleep(200);
        }

        return null;
    }

    function renderTrackFromBase(li, trackKey, trackPatch, globalMap) {
        const base = STAFF_DISPLAY_RUNTIME.baseTrackState.get(trackKey);
        if (!base) return;

        const epinfo = li.querySelector(".epinfo");
        const repoOnly = hasCustomRoleInRoleMap(trackPatch);

        let roleData = {};
        let extras = [];
        let indent = "　　　　";

        if (!repoOnly) {
            const parsedBase = base.rows && base.rows.length
                ? buildRoleDataFromRows(cloneParsedRows(base.rows))
                : { roleData: {}, extras: [], indent: "　　　　" };

            roleData = parsedBase.roleData || {};
            extras = parsedBase.extras || [];
            indent = parsedBase.indent || "　　　　";
        }

        if (trackPatch) {
            for (const [roleKey, items] of Object.entries(trackPatch)) {
                if (!Array.isArray(items) || !items.length) continue;

                if (repoOnly) {
                    roleData[roleKey] = items;
                } else {
                    const baseItems = roleData[roleKey] || [];
                    roleData[roleKey] = upgradePatchedItemsWithBaseItems(items, baseItems);
                }
            }
        }

        rebuildEpinfo(epinfo, li, roleData, extras, indent, globalMap);
    }

    function renderAllTracks(trackRows, patchMap, globalMap, mode = "after") {
        if (mode === "raw") {
            rebuildOriginalGlobalEpinfo();

            for (const [trackKey, li] of trackRows) {
                renderRawTrackFromBase(li, trackKey);
            }

            STAFF_DISPLAY_RUNTIME.compareMode = mode;
            return;
        }

        const globalPatch = patchMap?.[EPINFO_TRACK_KEY] || null;
        rebuildGlobalEpinfo(globalPatch, globalMap);

        for (const [trackKey, li] of trackRows) {
            const trackPatch = patchMap[trackKey] || null;
            renderTrackFromBase(li, trackKey, trackPatch, globalMap);
        }

        STAFF_DISPLAY_RUNTIME.compareMode = mode;
    }

    function injectCompareToggle(anchor, trackRows, patchMap, globalMap, hasRepoPatch) {
        if (document.getElementById("bgm-staff-compare-toggle")) return;

        // 有另一个组件的 .epinfo-toggle 时贴着它放；没有（单独使用本组件）时
        // 退回到曲目区域右上角，保证切换按钮始终可用
        const section = (anchor && anchor.closest(".subject_ep_section"))
            || document.querySelector(".subject_ep_section");
        if (!section) return;

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.id = "bgm-staff-compare-toggle";
        toggle.className = "bgm-staff-fix-compare-toggle";

        function syncToggleUI() {
            if (STAFF_DISPLAY_RUNTIME.compareMode === "raw") {
                toggle.classList.add("is-on");
                toggle.textContent = "原始显示";
            } else {
                toggle.classList.remove("is-on");
                toggle.textContent = hasRepoPatch ? "组件显示++" : "组件显示";
            }
        }

        toggle.addEventListener("click", () => {
            const nextMode = STAFF_DISPLAY_RUNTIME.compareMode === "after" ? "raw" : "after";
            renderAllTracks(trackRows, patchMap, globalMap, nextMode);
            syncToggleUI();
            positionCompareToggle(toggle, anchor);
        });

        // 「隐藏团体」勾选框：放在组件显示按钮左边
        const hideLabel = document.createElement("label");
        hideLabel.id = "bgm-staff-hide-groups";
        hideLabel.title = "勾选后按原始布局显示，并隐藏 @ / 括号里的团体 / 社团 / 公司名";

        const hideCheckbox = document.createElement("input");
        hideCheckbox.type = "checkbox";
        hideCheckbox.checked = hideGroupAnnotations;
        hideCheckbox.addEventListener("change", () => {
            hideGroupAnnotations = hideCheckbox.checked;
            hideLabel.classList.toggle("is-on", hideGroupAnnotations);
            try {
                localStorage.setItem(HIDE_GROUPS_KEY, hideGroupAnnotations ? "1" : "0");
            } catch (_) { }

            // 只在组件显示++下隐藏团体；原始显示本来就是原文，不做处理
            if (STAFF_DISPLAY_RUNTIME.compareMode !== "raw") {
                renderAllTracks(
                    STAFF_DISPLAY_RUNTIME.trackRows,
                    STAFF_DISPLAY_RUNTIME.patchMap || {},
                    STAFF_DISPLAY_RUNTIME.globalMap || new Map(),
                    "after"
                );
            }
        });

        hideLabel.appendChild(hideCheckbox);
        hideLabel.appendChild(document.createTextNode("隐藏团体"));
        hideLabel.classList.toggle("is-on", hideGroupAnnotations);

        syncToggleUI();

        section.appendChild(hideLabel);
        section.appendChild(toggle);

        positionCompareToggle(toggle, anchor);

        // 单独使用本组件时先走兜底位置；如果另一个组件的 .epinfo-toggle
        // 稍后才出现，再贴回它左边，避免两个按钮叠在一起
        if (!anchor) {
            const anchorObserver = new MutationObserver(() => {
                const found = findEpinfoToggleAnchor();
                if (!found) return;

                anchorObserver.disconnect();
                positionCompareToggle(toggle, found);
            });
            anchorObserver.observe(section, { childList: true, subtree: true });
        }
    }

    /** 切换按钮定位：有 .epinfo-toggle 时贴在它左边，否则放在曲目区域右上角 */
    function positionCompareToggle(toggle, anchor) {
        let right;
        let top;

        if (anchor) {
            const anchorStyle = window.getComputedStyle(anchor);
            const anchorRight = parseFloat(anchorStyle.right) || 8;
            const anchorTop = parseFloat(anchorStyle.top);
            const anchorWidth = anchor.getBoundingClientRect().width || 20;
            const gap = 6;

            right = anchorRight + anchorWidth + gap;
            top = Number.isFinite(anchorTop) ? anchorTop : 7;
        } else {
            right = 8;
            top = 8;
        }

        toggle.style.right = `${right}px`;
        toggle.style.top = `${top}px`;

        const hideLabel = document.getElementById("bgm-staff-hide-groups");
        if (!hideLabel) return;

        const toggleWidth = toggle.getBoundingClientRect().width || 0;
        hideLabel.style.right = `${right + toggleWidth + 6}px`;
        hideLabel.style.top = `${top}px`;
    }

    /* ================= Disc 信息增强（合并自「音乐条目 Disc 信息增强」） ================= */

    /**
     * 本模块负责（全部挂在 /subject/{id} 主条目页）：
     *   1. 从简介（#subject_summary）尾部解析「Disc N - 名称」，内联到曲目列表的 Disc 标题；
     *   2. 在 Disc 标题右侧追加 [品番] [时长] 徽章；
     *   3. 把 Infobox 的多碟「播放时长 / 品番」折叠成「摘要 + 详情弹层」；
     *   4. 从 /subject/{id}/ep 抓取逐曲时长，插到曲目行。
     *
     * 所有 DOM 标识统一使用 bgm-dm-* 前缀，与被合并的独立脚本（bgm-disc-*）完全分开：
     * 独立脚本清理自己时只删 .bgm-disc-*，本模块也只删 .bgm-dm-*，两者不会互相误删。
     */
    const DISC_META = (function () {
        // 本模块注入的 DOM / 样式标识
        const STYLE_ID = "bgm-dm-style";
        const WRAP_CLASS = "bgm-dm-wrap";
        const SUMMARY_CLASS = "bgm-dm-summary";
        const POPOVER_CLASS = "bgm-dm-popover";
        const EP_DURATION_CLASS = "bgm-dm-ep-duration";
        const INFOBOX_ATTR = "bgmDmInfobox";

        // Disc 标题上的数据集标记（注意：标题文本会被改写，碟号一律以 dataset 为准）
        const BASE_LABEL_ATTR = "bgmDmBaseLabel";
        const DISC_NO_ATTR = "bgmDmNo";
        const SIG_ATTR = "bgmDmSig";

        const DURATION_LABEL = "播放时长";
        const CATALOG_LABELS = ["品番", "商品番号", "商品编号", "编号", "Catalog", "Catalog Number"];

        // 独立脚本（待让位的旧版本）注入的节点 / 样式
        const LEGACY_NODE_SELECTOR = ".bgm-disc-meta-wrap, .bgm-disc-summary, .bgm-disc-popover, .bgm-disc-detail-trigger";
        const LEGACY_STYLE_ID = "bgm-disc-meta-badges-style-v2";

        // 逐曲时长：按 subjectId 缓存，页面生命周期内只请求一次
        const durationMapCache = new Map();
        const durationFetching = new Set();

        let mounted = false;
        let observer = null;
        let observedListEl = null;
        let debounceTimer = null;

        /* -------------------- 基础工具 -------------------- */

        function normalizeWhitespace(text) {
            return String(text || "")
                .replace(/&nbsp;|\u00A0/gi, " ")
                .replace(/\s+/g, " ")
                .trim();
        }

        function normalizeDiscLabel(text) {
            return normalizeWhitespace(text).toUpperCase();
        }

        function normalizeTipLabel(text) {
            return normalizeWhitespace(text).replace(/[：:]\s*$/, "");
        }

        function pad2(n) {
            return String(n).padStart(2, "0");
        }

        function formatSecondsToHHMMSS(totalSeconds) {
            totalSeconds = Number(totalSeconds);
            if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "";

            const h = Math.floor(totalSeconds / 3600);
            const m = Math.floor((totalSeconds % 3600) / 60);
            const s = totalSeconds % 60;

            return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
        }

        function normalizeDurationText(raw) {
            const text = normalizeWhitespace(raw);
            if (!text) return "";

            let m;

            // HH:MM:SS
            m = text.match(/^(\d{1,3}):(\d{1,2}):(\d{1,2})$/);
            if (m) {
                return formatSecondsToHHMMSS(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
            }

            // MM:SS
            m = text.match(/^(\d{1,5}):(\d{1,2})$/);
            if (m) {
                return formatSecondsToHHMMSS(Number(m[1]) * 60 + Number(m[2]));
            }

            return text;
        }

        function parseDurationSeconds(raw) {
            const normalized = normalizeDurationText(raw);
            const m = normalized.match(/^(\d{2}):(\d{2}):(\d{2})$/);
            if (!m) return null;

            return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        }

        /** 主条目页（/subject/123）返回 id；/subject/123/ep 等子页面返回 null */
        function getMainSubjectId() {
            const m = location.pathname.match(/^\/subject\/(\d+)(?:\/)?$/);
            return m ? m[1] : null;
        }

        /** 只在音乐条目页工作：导航里有「曲目」且 Infobox 有音乐条目常见字段 */
        function isLikelyMusicSubjectPage() {
            const infobox = document.querySelector("#infobox");
            const nav = document.querySelector(".subjectNav");
            if (!infobox || !nav) return false;

            const infoboxText = normalizeWhitespace(infobox.textContent || "");
            const navText = normalizeWhitespace(nav.textContent || "");

            return /曲目/.test(navText) && /播放时长|品番|商品番号|商品编号|编号|Catalog(?: Number)?|艺术家/.test(infoboxText);
        }

        /* -------------------- 样式 -------------------- */

        function ensureStyle() {
            if (document.getElementById(STYLE_ID)) return;

            const style = document.createElement("style");
            style.id = STYLE_ID;
            style.textContent = `
                .${WRAP_CLASS} {
                    float: right;
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    margin-left: 12px;
                    white-space: nowrap;
                    font-size: 12px;
                    font-weight: 500;
                }

                .bgm-dm-badge {
                    display: inline-flex;
                    align-items: center;
                    height: 20px;
                    padding: 0 8px;
                    border-radius: 999px;
                    border: 1px solid rgba(0, 0, 0, 0.08);
                    background: rgba(255, 255, 255, 0.92);
                    color: #666;
                    line-height: 20px;
                }

                .bgm-dm-badge.catalog {
                    color: #4f6b8a;
                }

                .bgm-dm-badge.duration {
                    color: #8a5a6a;
                }

                html[data-theme="dark"] .bgm-dm-badge,
                body[data-theme="dark"] .bgm-dm-badge {
                    background: rgba(70, 70, 70, 0.88);
                    border-color: rgba(255, 255, 255, 0.12);
                    color: #ddd;
                }

                html[data-theme="dark"] .bgm-dm-badge.catalog,
                body[data-theme="dark"] .bgm-dm-badge.catalog {
                    color: #9fc3ff;
                }

                html[data-theme="dark"] .bgm-dm-badge.duration,
                body[data-theme="dark"] .bgm-dm-badge.duration {
                    color: #ffbecb;
                }

                ul.line_list_music > li.cat {
                    display: block;
                    overflow: visible;
                    position: relative;
                }

                .bgm-dm-infobox-host {
                    position: relative;
                    overflow: visible;
                }

                .${SUMMARY_CLASS} {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    margin-left: 2px;
                    flex-wrap: wrap;
                }

                .bgm-dm-summary-main {
                    font-weight: 500;
                }

                .bgm-dm-summary-count {
                    display: inline-flex;
                    align-items: center;
                    height: 18px;
                    padding: 0 7px;
                    border-radius: 999px;
                    background: rgba(240, 145, 153, 0.14);
                    color: #c45468;
                    font-size: 11px;
                    line-height: 18px;
                }

                html[data-theme="dark"] .bgm-dm-summary-count,
                body[data-theme="dark"] .bgm-dm-summary-count {
                    background: rgba(240, 145, 153, 0.18);
                    color: #ffb7c0;
                }

                .bgm-dm-detail-trigger {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    min-width: 18px;
                    height: 18px;
                    padding: 0 6px;
                    border-radius: 999px;
                    cursor: pointer;
                    background: rgba(54, 156, 248, 0.12);
                    color: #3a80d2;
                    font-size: 11px;
                    line-height: 18px;
                    user-select: none;
                }

                .bgm-dm-detail-trigger:hover {
                    background: rgba(54, 156, 248, 0.18);
                }

                html[data-theme="dark"] .bgm-dm-detail-trigger,
                body[data-theme="dark"] .bgm-dm-detail-trigger {
                    background: rgba(54, 156, 248, 0.18);
                    color: #9fc3ff;
                }

                .${POPOVER_CLASS} {
                    position: absolute;
                    top: calc(100% + 6px);
                    left: 0;
                    z-index: 9999;
                    min-width: 240px;
                    max-width: 360px;
                    padding: 8px;
                    border-radius: 10px;
                    border: 1px solid rgba(0, 0, 0, 0.08);
                    background: rgba(255, 255, 255, 0.97);
                    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
                    backdrop-filter: blur(10px);
                    display: none;
                }

                html[data-theme="dark"] .${POPOVER_CLASS},
                body[data-theme="dark"] .${POPOVER_CLASS} {
                    background: rgba(46, 46, 46, 0.97);
                    border-color: rgba(255, 255, 255, 0.12);
                    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
                }

                .${POPOVER_CLASS}.visible {
                    display: block;
                }

                .bgm-dm-popover-row {
                    display: grid;
                    grid-template-columns: 64px 1fr;
                    gap: 10px;
                    align-items: center;
                    padding: 4px 2px;
                    font-size: 12px;
                    line-height: 1.45;
                }

                .bgm-dm-popover-row + .bgm-dm-popover-row {
                    border-top: 1px dashed rgba(0, 0, 0, 0.08);
                }

                html[data-theme="dark"] .bgm-dm-popover-row + .bgm-dm-popover-row,
                body[data-theme="dark"] .bgm-dm-popover-row + .bgm-dm-popover-row {
                    border-top-color: rgba(255, 255, 255, 0.08);
                }

                .bgm-dm-popover-key {
                    color: #888;
                    font-weight: 600;
                }

                .bgm-dm-popover-value {
                    color: inherit;
                    word-break: break-all;
                }

                .${EP_DURATION_CLASS} {
                    margin-right: 4px;
                    white-space: nowrap;
                    font-size: 12px;
                    line-height: 14px;
                    vertical-align: middle;
                }

                @media (max-width: 720px) {
                    .${WRAP_CLASS} {
                        float: none;
                        display: flex;
                        margin-top: 6px;
                        margin-left: 0;
                        flex-wrap: wrap;
                    }

                    .${POPOVER_CLASS} {
                        left: auto;
                        right: 0;
                        min-width: 220px;
                        max-width: min(320px, calc(100vw - 32px));
                    }
                }
            `;

            document.head.appendChild(style);
        }

        /* -------------------- 简介里的 Disc 命名 -------------------- */

        function getSummaryText() {
            const summary = document.querySelector("#subject_summary")
                || document.querySelector(".subject_summary");

            return summary ? String(summary.textContent || "") : "";
        }

        /**
         * 从简介尾部解析 Disc 命名：
         *   Disc 1 - Profectio / DISC 2：Transitus / Disc 3 – Sidera / Disc 4「Perfectio」
         * 只认行首（允许前面有 - ・ * ※ 之类的列举符号），同一碟号取第一次出现的写法。
         */
        function parseDiscNamesFromSummary() {
            const map = new Map();
            const text = getSummaryText();
            if (!text) return map;

            for (const rawLine of text.split(/\r?\n/)) {
                const line = normalizeWhitespace(rawLine)
                    .replace(/^[-–—－・·*※>]+\s*/, "")
                    .trim();

                if (!line) continue;

                const m = line.match(/^disc\s*(\d+)\s*(?:[-–—－:：~～]\s*|\s+)(.+)$/i);
                if (!m) continue;

                const discNo = Number(m[1]);
                const name = normalizeWhitespace(m[2])
                    // 简介被折叠时可能把「more...」拼到同一行
                    .replace(/\s*(?:more\.{0,3}|\[?more\]?|展开|收起)\s*$/i, "")
                    .replace(/^[-–—－:：~～]\s*/, "")
                    .trim();

                if (!discNo || !name) continue;
                if (name.length > 80) continue;   // 明显不是 Disc 命名，跳过
                if (!map.has(discNo)) map.set(discNo, name);
            }

            return map;
        }

        /* -------------------- Infobox 解析 -------------------- */

        function cloneWithoutTip(li) {
            const clone = li.cloneNode(true);

            // 多级形态下嵌在 li 内的子项列表不算主值
            clone.querySelectorAll(":scope > ul")
                .forEach(node => node.remove());

            clone.querySelectorAll(`.tip, .${SUMMARY_CLASS}, .${POPOVER_CLASS}, .${WRAP_CLASS}`)
                .forEach(node => node.remove());

            return normalizeWhitespace(clone.textContent || "");
        }

        /**
         * 找到「播放时长 / 品番」这类 Infobox 行，并收集它的多级子项。
         *
         * bgm 的多级 Infobox 有两种渲染形态，这里都兼容：
         *   A. 子项是与该行同级的 li.sub：<li class="sub_section">…</li><li class="sub">DISC 1 …</li>
         *   B. 子项嵌在该行内部的列表里：<li>…<ul><li class="sub">DISC 1 …</li></ul></li>
         * 单值行（如「品番: ANST-0001~4」）没有子项，subs 为空，主值即品番区间。
         */
        function getSectionWithSubs(label) {
            const candidates = Array.from(document.querySelectorAll("#infobox li"));

            for (const li of candidates) {
                const tip = li.querySelector(":scope > .tip");
                if (!tip) continue;

                if (normalizeTipLabel(tip.textContent || "") !== label) continue;

                const subs = [];

                // 形态 A：同级兄弟 li.sub
                let next = li.nextElementSibling;

                while (
                    next &&
                    next.parentElement === li.parentElement &&
                    next.classList &&
                    next.classList.contains("sub")
                ) {
                    subs.push(next);
                    next = next.nextElementSibling;
                }

                // 形态 B：li 内部的列表项
                if (!subs.length) {
                    li.querySelectorAll(":scope > ul > li").forEach(sub => subs.push(sub));
                }

                return {
                    section: li,
                    subs,
                    mainValue: cloneWithoutTip(li)
                };
            }

            return null;
        }

        /**
         * 把 `ANST-0001~4` 这类顺序区间品番展开成 DISC 1..N 的映射。
         *
         * 数量与碟数一致时一对一展开；品番比碟少时（例如 4 张品番配 5 个 Disc，
         * 第 5 碟是隐藏轨）按 Disc 1..N 部分填充，多出来的 Disc 不给品番；
         * 品番比碟多说明数据对不上，不推导，避免错位。
         */
        function expandSequentialCatalogRange(mainValue, discCount) {
            const text = normalizeWhitespace(mainValue);
            if (!text || !discCount || discCount < 2) return new Map();

            const m = text.match(/^(.*?)(\d+)\s*[~～〜]\s*(\d+)$/);
            if (!m) return new Map();

            const prefix = m[1] || "";
            const startStr = m[2];
            const endShortStr = m[3];

            const startNum = Number(startStr);
            if (!Number.isFinite(startNum)) return new Map();

            let endNum;
            if (endShortStr.length < startStr.length) {
                const head = startStr.slice(0, startStr.length - endShortStr.length);
                endNum = Number(head + endShortStr);
            } else {
                endNum = Number(endShortStr);
            }

            if (!Number.isFinite(endNum) || endNum < startNum) return new Map();

            const expectedCount = endNum - startNum + 1;

            // 品番数量多于 Disc 数：数据不可信，不猜
            if (expectedCount > discCount) return new Map();

            const width = startStr.length;
            const map = new Map();

            for (let i = 0; i < expectedCount; i++) {
                const discNo = i + 1;
                const catalogNo = String(startNum + i).padStart(width, "0");
                map.set(`DISC ${discNo}`, `${prefix}${catalogNo}`);
            }

            return map;
        }

        /** 收集某个 Infobox 行下 DISC 子项（duration / catalog）的碟号 -> 值映射 */
        function collectDiscMap(label, type, pairedDiscCount = 0) {
            const data = getSectionWithSubs(label);
            const map = new Map();

            if (!data) {
                return { section: null, mainValue: "", subs: [], map, hasMulti: false };
            }

            data.subs.forEach(li => {
                const tip = li.querySelector(".tip");
                if (!tip) return;

                const disc = normalizeDiscLabel(tip.textContent || "");
                let value = cloneWithoutTip(li);

                if (!/^DISC \d+$/.test(disc)) return;
                if (!value) return;

                if (type === "duration") {
                    value = normalizeDurationText(value);
                }

                map.set(disc, value);
            });

            // 品番没有显式 DISC 子项时，尝试从主值（如 ANST-0001~4）推导顺序品番
            if (type === "catalog" && map.size === 0 && pairedDiscCount >= 2) {
                const derivedMap = expandSequentialCatalogRange(data.mainValue, pairedDiscCount);

                if (derivedMap.size >= 2) {
                    return {
                        section: data.section,
                        mainValue: data.mainValue,
                        subs: data.subs,
                        map: derivedMap,
                        hasMulti: true
                    };
                }
            }

            return {
                section: data.section,
                mainValue: data.mainValue,
                subs: data.subs,
                map,
                hasMulti: map.size >= 2
            };
        }

        function collectCatalogInfo(pairedDiscCount) {
            for (const label of CATALOG_LABELS) {
                const info = collectDiscMap(label, "catalog", pairedDiscCount);
                if (info.section) return info;
            }

            return { section: null, mainValue: "", subs: [], map: new Map(), hasMulti: false };
        }

        /* -------------------- 曲目列表 Disc 标题 -------------------- */

        function getDiscHeadingNodes() {
            return Array.from(document.querySelectorAll("ul.line_list_music > li.cat"));
        }

        function countDiscHeadings(discHeads) {
            const set = new Set();

            discHeads.forEach(li => {
                const text = li.dataset[DISC_NO_ATTR] || li.textContent || "";
                const m = normalizeDiscLabel(text).match(/DISC\s*(\d+)/);
                if (m) set.add(Number(m[1]));
            });

            return set.size;
        }

        /**
         * 取 Disc 标题的「原始标题 + 碟号」。
         * 首次处理时把原始标题存进 dataset，之后标题文本会被改写，重绘一律以它为基准，
         * 避免出现「Disc 1 - X - X」这种叠加。
         */
        function getHeadingBase(li) {
            let baseLabel = li.dataset[BASE_LABEL_ATTR] || "";

            if (!baseLabel) {
                // 先把本模块 / 旧脚本可能已挂上的徽章摘掉，再取原始标题
                const clone = li.cloneNode(true);
                clone.querySelectorAll(`.${WRAP_CLASS}, ${LEGACY_NODE_SELECTOR}`)
                    .forEach(node => node.remove());

                const text = normalizeWhitespace(clone.textContent || "");
                const m = text.match(/^(disc\s*\d+)(?:\s*[-–—－:：]\s*.+)?$/i);
                if (!m) return null;

                baseLabel = m[1].replace(/^disc\s*/i, "Disc ");
            }

            const noMatch = baseLabel.match(/(\d+)/);
            if (!noMatch) return null;

            const discNo = Number(noMatch[1]);
            if (!discNo) return null;

            li.dataset[BASE_LABEL_ATTR] = baseLabel;
            li.dataset[DISC_NO_ATTR] = String(discNo);

            return { discNo, baseLabel };
        }

        function createBadge(className, text) {
            const span = document.createElement("span");
            span.className = `bgm-dm-badge ${className}`;
            span.textContent = `[${text}]`;

            return span;
        }

        function renderDiscHeading(li, base, parts) {
            const name = parts.name || "";
            const catalog = parts.catalog || "";
            const duration = parts.duration || "";

            const label = name ? `${base.baseLabel} - ${name}` : base.baseLabel;
            const sig = [base.discNo, name, catalog, duration].join("|");

            const labelOk = normalizeWhitespace(li.textContent || "").startsWith(label);
            const hasLegacyNode = !!li.querySelector(LEGACY_NODE_SELECTOR);

            if (li.dataset[SIG_ATTR] === sig && labelOk && !hasLegacyNode) return;

            // 整段重建而不是追加，保证多次运行不会叠加
            li.textContent = label;

            if (catalog || duration) {
                const wrap = document.createElement("span");
                wrap.className = WRAP_CLASS;

                if (catalog) wrap.appendChild(createBadge("catalog", catalog));
                if (duration) wrap.appendChild(createBadge("duration", duration));

                li.appendChild(wrap);
            }

            li.dataset[SIG_ATTR] = sig;
        }

        function shouldUseDurationOnHeadings(durationInfo, catalogInfo) {
            // 正常多 Disc 播放时长
            if (durationInfo.hasMulti) return true;

            // 播放时长只有部分 Disc，但品番已经确认是多 Disc：把已有的时长挂到对应 Disc 上
            if (catalogInfo.hasMulti && durationInfo.map.size >= 1) return true;

            return false;
        }

        /* -------------------- Infobox 摘要 + 详情弹层 -------------------- */

        function makePopover(entries) {
            const popover = document.createElement("div");
            popover.className = POPOVER_CLASS;

            entries.forEach(({ disc, value }) => {
                const row = document.createElement("div");
                row.className = "bgm-dm-popover-row";

                const key = document.createElement("div");
                key.className = "bgm-dm-popover-key";
                key.textContent = disc;

                const val = document.createElement("div");
                val.className = "bgm-dm-popover-value";
                val.textContent = value;

                row.appendChild(key);
                row.appendChild(val);
                popover.appendChild(row);
            });

            return popover;
        }

        function bindPopover(host, trigger, popover) {
            let hideTimer = null;
            let pinned = false;

            function show() {
                if (hideTimer) {
                    clearTimeout(hideTimer);
                    hideTimer = null;
                }
                popover.classList.add("visible");
            }

            function hideSoon() {
                if (pinned) return;

                hideTimer = setTimeout(() => {
                    popover.classList.remove("visible");
                }, 120);
            }

            host.addEventListener("mouseenter", show);
            host.addEventListener("mouseleave", hideSoon);

            trigger.addEventListener("click", e => {
                e.preventDefault();
                e.stopPropagation();
                pinned = !pinned;

                if (pinned) {
                    show();
                } else {
                    popover.classList.remove("visible");
                }
            });

            document.addEventListener("click", e => {
                if (!host.contains(e.target)) {
                    pinned = false;
                    popover.classList.remove("visible");
                }
            }, true);
        }

        function enhanceInfoboxSection(info, type) {
            if (!info || !info.section || !info.hasMulti) return;
            if (info.section.dataset[INFOBOX_ATTR] === "1") return;

            const entries = Array.from(info.map.entries()).map(([disc, value]) => ({ disc, value }));
            if (entries.length < 2) return;

            const section = info.section;
            section.dataset[INFOBOX_ATTR] = "1";
            section.classList.add("bgm-dm-infobox-host");

            // 隐藏原有多碟子项，改为摘要 + 弹层
            info.subs.forEach(li => {
                li.style.display = "none";
            });

            let summaryMain = "";

            if (type === "duration") {
                const secondsList = entries
                    .map(item => parseDurationSeconds(item.value))
                    .filter(v => v != null);

                if (secondsList.length) {
                    const computed = formatSecondsToHHMMSS(secondsList.reduce((sum, v) => sum + v, 0));

                    // 主行本来有值时（多级形态的第一行就是总时长）与我们算出的相同就不再重复显示，
                    // 不同则两者都保留（主行是条目自己写的值，摘要是按各碟算出来的）
                    summaryMain = normalizeDurationText(info.mainValue) === computed ? "" : computed;
                }
            }

            const summary = document.createElement("span");
            summary.className = SUMMARY_CLASS;

            section.appendChild(document.createTextNode(" "));

            if (summaryMain) {
                const main = document.createElement("span");
                main.className = "bgm-dm-summary-main";
                main.textContent = summaryMain;
                summary.appendChild(main);
            }

            const count = document.createElement("span");
            count.className = "bgm-dm-summary-count";
            count.textContent = `${entries.length} Disc`;
            summary.appendChild(count);

            const trigger = document.createElement("span");
            trigger.className = "bgm-dm-detail-trigger";
            trigger.textContent = "详情";
            summary.appendChild(trigger);

            const popover = makePopover(entries);

            section.appendChild(summary);
            section.appendChild(popover);

            bindPopover(section, trigger, popover);
        }

        /* -------------------- 逐曲时长 -------------------- */

        function parseEpId(href) {
            if (!href) return "";

            const m = String(href).match(/\/ep\/(\d+)/);
            return m ? m[1] : "";
        }

        function collectHomeEpItems() {
            const items = [];

            const listItems = document.querySelectorAll(
                ".subject_ep_section.clearit .line_list_music li.line_odd, " +
                ".subject_ep_section.clearit .line_list_music li.line_even"
            );

            for (const li of listItems) {
                const epLink = li.querySelector("h6 a[href^='/ep/']");
                const cite = li.querySelector("cite");

                if (!epLink || !cite) continue;

                const epId = parseEpId(epLink.getAttribute("href"));
                if (!epId) continue;

                items.push({ epId, li, cite, epLink });
            }

            return items;
        }

        function extractDurationFromText(text) {
            if (!text) return "";

            const normalized = String(text).replace(/\s+/g, "");

            // 支持 时长:02:31 / 时长：02:31 / 时长:1:02:31
            const match = normalized.match(/时长[:：]((?:\d{1,2}:)?\d{1,2}:\d{2})/);
            return match ? match[1] : "";
        }

        function extractDurationFromListItem(li) {
            const cite = li.querySelector("cite");
            if (!cite) return "";

            const smalls = cite.querySelectorAll("small.grey");

            for (const small of smalls) {
                const duration = extractDurationFromText(small.textContent);
                if (duration) return duration;
            }

            return extractDurationFromText(cite.textContent);
        }

        function parseDurationMapFromEpPage(doc) {
            const map = new Map();

            const listItems = doc.querySelectorAll(
                ".line_detail .line_list li.line_odd, " +
                ".line_detail .line_list li.line_even"
            );

            for (const li of listItems) {
                const epLink = li.querySelector("h6 a[href^='/ep/']");
                if (!epLink) continue;

                const epId = parseEpId(epLink.getAttribute("href"));
                if (!epId) continue;

                const duration = extractDurationFromListItem(li);
                if (!duration) continue;

                map.set(epId, duration);
            }

            return map;
        }

        function renderDurations(epItems, durationMap) {
            if (!durationMap || !durationMap.size) return;

            for (const item of epItems) {
                const duration = durationMap.get(item.epId);
                if (!duration) continue;

                if (item.cite.querySelector(`.${EP_DURATION_CLASS}`)) continue;

                const span = document.createElement("small");
                span.className = `grey ${EP_DURATION_CLASS}`;
                span.textContent = `时长:${duration} / `;

                item.cite.insertBefore(span, item.cite.firstChild);
            }
        }

        /** 拉取并缓存 /subject/{id}/ep 的逐曲时长（同一页面只请求一次） */
        function ensurePerTrackDurations() {
            const subjectId = getMainSubjectId();
            if (!subjectId) return;

            const cached = durationMapCache.get(subjectId);
            if (cached) {
                renderDurations(collectHomeEpItems(), cached);
                return;
            }

            if (durationFetching.has(subjectId)) return;

            // 没有曲目行就不用发请求
            if (!collectHomeEpItems().length) return;

            durationFetching.add(subjectId);

            fetch(`/subject/${subjectId}/ep`, { credentials: "same-origin" })
                .then(res => (res.ok ? res.text() : ""))
                .then(html => {
                    if (!html) return;

                    const doc = new DOMParser().parseFromString(html, "text/html");
                    durationMapCache.set(subjectId, parseDurationMapFromEpPage(doc));
                })
                .catch(err => {
                    console.warn("[staff-display] fetch ep durations failed:", err);
                })
                .finally(() => {
                    durationFetching.delete(subjectId);

                    if (!mounted) return;

                    const map = durationMapCache.get(subjectId);
                    if (!map || !map.size) return;

                    renderDurations(collectHomeEpItems(), map);
                });
        }

        /* -------------------- 接管 / 卸载 -------------------- */

        /**
         * 独立脚本可能已经先跑完并渲染了一套显示。
         * 这里把它的节点、样式、隐藏状态、dataset 标记全部清掉，由本模块重新渲染。
         */
        function takeOverLegacy() {
            document.querySelectorAll(LEGACY_NODE_SELECTOR).forEach(node => node.remove());

            const legacyStyle = document.getElementById(LEGACY_STYLE_ID);
            if (legacyStyle) legacyStyle.remove();

            document.querySelectorAll(".bgm-disc-infobox-host").forEach(el => {
                el.classList.remove("bgm-disc-infobox-host");
            });

            // 旧脚本会把多碟子项设成 display:none，还原后由本模块重新折叠
            document.querySelectorAll("#infobox li.sub").forEach(el => {
                el.style.display = "";
            });

            document.querySelectorAll("[data-bgm-disc-section-enhanced]").forEach(el => {
                delete el.dataset.bgmDiscSectionEnhanced;
            });

            document.querySelectorAll("[data-bgm-disc-meta-enhanced]").forEach(el => {
                delete el.dataset.bgmDiscMetaEnhanced;
            });

            // 旧脚本改写标题时留下的 dataset 标记一并清掉
            document.querySelectorAll("[data-bgm-disc-base-label], [data-bgm-disc-no], [data-bgm-disc-sig]")
                .forEach(el => {
                    delete el.dataset.bgmDiscBaseLabel;
                    delete el.dataset.bgmDiscNo;
                    delete el.dataset.bgmDiscSig;
                });
        }

        /* -------------------- 主流程 -------------------- */

        function enhance() {
            if (!mounted) return;
            if (!getMainSubjectId()) return;
            if (!isLikelyMusicSubjectPage()) return;

            // 曲目列表可能是后加载的：出现后把 observer 切到更精确的目标上
            ensureObserverCoversList();

            ensureStyle();

            const discHeads = getDiscHeadingNodes();
            const durationInfo = collectDiscMap(DURATION_LABEL, "duration");
            const inferredDiscCount = Math.max(durationInfo.map.size, countDiscHeadings(discHeads));
            const catalogInfo = collectCatalogInfo(inferredDiscCount);
            const discNames = parseDiscNamesFromSummary();

            enhanceInfoboxSection(durationInfo, "duration");
            enhanceInfoboxSection(catalogInfo, "catalog");

            if (discHeads.length) {
                const useDuration = shouldUseDurationOnHeadings(durationInfo, catalogInfo);
                const useCatalog = !!catalogInfo.hasMulti;

                discHeads.forEach(li => {
                    const base = getHeadingBase(li);
                    if (!base) return;

                    const discKey = `DISC ${base.discNo}`;

                    renderDiscHeading(li, base, {
                        name: discNames.get(base.discNo) || "",
                        catalog: useCatalog ? (catalogInfo.map.get(discKey) || "") : "",
                        duration: useDuration ? (durationInfo.map.get(discKey) || "") : ""
                    });
                });
            }

            ensurePerTrackDurations();
        }

        function scheduleEnhance() {
            if (!mounted || debounceTimer) return;

            debounceTimer = setTimeout(() => {
                debounceTimer = null;
                enhance();
            }, 80);
        }

        function stopObserver() {
            if (observer) {
                observer.disconnect();
                observer = null;
            }

            observedListEl = null;
        }

        function startObserver() {
            if (observer) return;

            const targets = [];
            const push = selector => {
                const el = document.querySelector(selector);
                if (el && !targets.includes(el)) targets.push(el);
            };

            const list = document.querySelector("ul.line_list_music");

            push("ul.line_list_music");
            push("#infobox");
            push("#subject_summary");
            push(".subject_summary");

            observer = new MutationObserver(() => scheduleEnhance());

            if (targets.length) {
                targets.forEach(target => observer.observe(target, {
                    childList: true,
                    subtree: true,
                    characterData: true
                }));
            } else {
                // 页面结构还没就绪时先看整页，等曲目列表出现后会切到精确目标
                observer.observe(document.body, { childList: true, subtree: true });
            }

            observedListEl = list || null;
        }

        function ensureObserverCoversList() {
            const list = document.querySelector("ul.line_list_music");
            if (!list || list === observedListEl) return;

            stopObserver();
            startObserver();
        }

        function mount() {
            if (!getMainSubjectId()) return;

            if (mounted) {
                scheduleEnhance();
                return;
            }

            mounted = true;

            takeOverLegacy();
            ensureStyle();
            startObserver();
            scheduleEnhance();
        }

        /** 关闭开关时彻底还原：移除注入节点 / 样式，Disc 标题恢复原样，子项重新展开 */
        function unmount() {
            mounted = false;

            stopObserver();

            if (debounceTimer) {
                clearTimeout(debounceTimer);
                debounceTimer = null;
            }

            document.querySelectorAll(`.${WRAP_CLASS}, .${SUMMARY_CLASS}, .${POPOVER_CLASS}`)
                .forEach(node => node.remove());

            document.querySelectorAll(`.${EP_DURATION_CLASS}`).forEach(node => node.remove());

            document.querySelectorAll("ul.line_list_music > li.cat").forEach(li => {
                const baseLabel = li.dataset[BASE_LABEL_ATTR];

                if (baseLabel) {
                    li.textContent = baseLabel;
                }

                delete li.dataset[BASE_LABEL_ATTR];
                delete li.dataset[DISC_NO_ATTR];
                delete li.dataset[SIG_ATTR];
            });

            document.querySelectorAll("[data-bgm-dm-infobox]").forEach(section => {
                delete section.dataset[INFOBOX_ATTR];
                section.classList.remove("bgm-dm-infobox-host");
            });

            document.querySelectorAll("#infobox li.sub").forEach(li => {
                li.style.display = "";
            });

            const style = document.getElementById(STYLE_ID);
            if (style) style.remove();
        }

        function setEnabled(enabled) {
            if (enabled) {
                mount();
            } else {
                unmount();
            }
        }

        return {
            mount,
            unmount,
            setEnabled,
            refresh: scheduleEnhance
        };
    })();

    // 配置回调可能在模块初始化之前就被 chiiLib 调用（此时 DISC_META 还在 TDZ 里），
    // 这里用一层间接引用兜底：拿不到模块就什么都不做，等 init() 再同步。
    let discMetaApi = null;

    // 模块已初始化，接上引用
    discMetaApi = DISC_META;

    /** 按当前开关状态接管 / 还原 Disc 信息增强 */
    function syncDiscMetaEnabled() {
        if (!discMetaApi) return;

        discMetaApi.setEnabled(!!discMetaEnabled);
    }

    async function init() {
        const subjectId = getSubjectId();
        if (!subjectId) return;

        ensureCompareToggleStyle();

        // Disc 信息增强（Disc 命名 / 品番 / 时长 / 逐曲时长）与制作人员渲染互不依赖，
        // 尽早接管，避免独立脚本残留的显示先闪一下
        syncDiscMetaEnabled();

        const [trackRows, data] = await Promise.all([
            waitForTrackRowsReady(),
            fetchPatchData(subjectId)
        ]);

        STAFF_DISPLAY_RUNTIME.trackRows = trackRows;
        snapshotBaseTrackState(trackRows);
        snapshotBaseGlobalEpinfoState();

        const globalMap = buildGlobalLinkMap();
        STAFF_DISPLAY_RUNTIME.globalMap = globalMap;

        STAFF_DISPLAY_RUNTIME.subjectId = subjectId;
        STAFF_DISPLAY_RUNTIME.data = data;

        let patchMap = {};
        let hasRepoPatch = false;

        if (data) {
            patchMap = buildPatchMapFromData(data);
            hasRepoPatch = Object.keys(patchMap).length > 0;

            if (!hasRepoPatch) {
                console.warn("[staff-display] patchMap is empty:", subjectId, data);
            }
        } else {
            console.warn("[staff-display] no repo data for subject:", subjectId);
        }

        STAFF_DISPLAY_RUNTIME.patchMap = patchMap;

        // 已知人名 / 团体名：用来区分括号里的团体和「职位-子职位」括号
        knownGroupNames = collectKnownGroupNames(patchMap, globalMap, data?.people);

        try {
            hideGroupAnnotations = localStorage.getItem(HIDE_GROUPS_KEY) === "1";
        } catch (_) { }

        renderAllTracks(trackRows, patchMap, globalMap, "after");

        // 与另一个组件共存时，持续清理它插入的 .epinfo，避免出现两套显示
        startEpinfoDedupeGuard();

        const anchor = await waitForEpinfoToggleAnchor();
        injectCompareToggle(anchor, trackRows, patchMap, globalMap, hasRepoPatch);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();