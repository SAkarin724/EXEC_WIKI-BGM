// ==UserScript==
// @name         音乐条目显示各曲目参与制作人员信息 ++ 维基端
// @namespace    org.sakarin.bgm.music.staff.patch
// @version      0.7.11
// @description  为 Bangumi 音乐条目提供 staff 修复编辑、预览与提交功能
// @author       GPT / SilenceAkarin
// @match        https://bgm.tv/*
// @match        https://chii.in/*
// @match        https://bangumi.tv/*
// @run-at       document-end
// @license      MIT
// ==/UserScript==

(function () {
    "use strict";

    const WORKER_URL = "https://worker.sakarin724.top";
    const APP_SUBMIT_KEY = "";
    const SESSION_KEY = "bgm_staff_display_session";
    // 真正走完一次授权的时刻（只在 worker 发回新 session 时写，校验/刷新一律不动它）
    const AUTH_GRANTED_AT_KEY = "bgm_staff_fix_auth_granted_at_v1";
    // bgm 授权（worker 侧的 bgm token）有效期：超过就重新授权
    const AUTH_GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const IMPORTED_DB_KEY = "bgm_staff_fix_imported_db_v1";
    const RESOLUTION_CACHE_KEY = "bgm_staff_fix_resolution_cache_v1";
    const AUTO_PATCH_RAW_EDITOR_KEY = "bgm_staff_fix_auto_patch_raw_editor_v1";
    const AUTO_PATCH_RAW_EDITOR_PERSIST_KEY = "bgm_staff_fix_auto_patch_raw_editor_persist_v1";
    // 工具端 patch_content：结构化直传，提交时优先于解析 patch 文本
    const AUTO_PATCH_CONTENT_KEY = "bgm_staff_fix_auto_patch_content_v1";
    const AUTO_PATCH_CONTENT_PERSIST_KEY = "bgm_staff_fix_auto_patch_content_persist_v1";
    const PENDING_CREATE_EXPORT_KEY = "bgm_staff_fix_pending_create_export_v1";
    // 仅用于清理旧版本残留（现在的一次性数据只存在内存里，刷新/关闭即失效）
    const CREATE_ONESHOT_PAYLOAD_KEY = "bgm_staff_fix_create_oneshot_payload_v1";
    // 未绑定条目 id 的旧记录在「页面本身没有条目 id」时（/ep 等）的最长存活时间；
    // 绑定过条目 id 的记录按条目 id 判定，不受这个时限约束。
    // 现在写入端要求必须有条目 id，所以这个窗口只剩兼容旧版本残留的作用。
    const UNBOUND_PENDING_PATCH_MAX_AGE_MS = 15 * 60 * 1000;
    // 「创建条目并补全」的提示文案（放在顶层，抓取路径与按钮共用）
    const CREATE_WAITING_HINT = "等待粘贴工具导出的 JSON…";
    const CREATE_READY_HINT = "数据已就绪，点「创建条目并补全」开始。";
    const AUTO_PATCH_LAST_RESULT_KEY = "bgm_staff_fix_auto_patch_last_result_v1";
    const AFTER_AUTH_ACTION_KEY = "bgm_staff_after_auth_action_v1";
    const AUTO_PATCH_POLICY_KEY = "bgm_staff_fix_auto_patch_policy_v1";
    const CREATE_PAGE_AUTH_RELOAD_KEY = "bgm_staff_create_auth_reload_v1";
    const REPAIR_PAGE_AUTH_RELOAD_KEY = "bgm_staff_repair_auth_reload_v1";
    const AUTO_PATCH_TASK_KEY = "bgm_staff_fix_auto_patch_task_v1";
    const AUTO_PATCH_TASK_HINT_KEY = "bgm_staff_fix_auto_patch_task_hint_v1";
    // 曲目表（trackTable）：供「章节一键填注释」在同一浏览器内跨页取用
    const TRACK_TABLE_KEY = "bgm_staff_fix_track_table_v1";
    const TRACK_TABLE_PERSIST_KEY = "bgm_staff_fix_track_table_persist_v1";
    // 「章节一键填注释」的流程标记：/ep 页写入，批量修改页消费一次
    const EP_COMMENT_FLOW_KEY = "bgm_staff_fix_ep_comment_flow_v1";

    const SONG_LIST_AUTO_SUBMIT_GROUPS = new Set([4, 5, 10]);
    const WIKI_DIRECT_SUBMIT_GROUPS = new Set([1, 2, 3, 8, 9, 11]);

    const EPINFO_TRACK_KEY = "__epinfo__";

    const typeConfig = {
        '1': { name: 'book', id: '1' },
        '2': { name: 'anime', id: '2' },
        '3': { name: 'music', id: '3' },
        '4': { name: 'game', id: '4' },
        '6': { name: 'real', id: '6' }
    };

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
    const RELATED_PERSON_ROLE_LABEL_MAP = {
        artist: "artist",
        艺术家: "artist",
        composer: "composer",
        作曲: "composer",
        lyric: "lyricist",
        作词: "lyricist",
        arrange: "arranger",
        编曲: "arranger",
        label: "label",
        厂牌: "label",
        レーベル: "label",
        instrument: "instrument",
        乐器: "instrument",
        vocal: "vocal",
        声乐: "vocal",
        recording: "recording",
        录音: "recording",
        mixing: "mixing",
        混音: "mixing",
        mastering: "mastering",
        母带制作: "mastering",
        producer: "producer",
        制作人: "producer",

        illustration: "illustrator",
        illustrator: "illustrator",
        illust: "illustrator",
        插图: "illustrator",

        原作: "original",
        脚本: "script",
        出版方: "publisher",

        人声编辑: "vocaledit",
        人声指导: "vocaldirection",
        音响监督: "sounddirector",
        客串: "featured",
        合唱: "choir",
        旁白: "narration",
        念白: "narration",
        "旁白/念白": "narration",
        "念白/旁白": "narration",
        设计: "design",

        vocaledit: "vocaledit",
        vocaldirection: "vocaldirection",
        sounddirector: "sounddirector",
        featured: "featured",
        choir: "choir",
        narration: "narration",
        design: "design"
        
    };

    function getSubjectType() {
        const navFocus = document.querySelector('#navMenuNeue a.focus');
        if (!navFocus) {
            // console.warn('[Bangumi 批量关联角色与CV] 未找到 #navMenuNeue a.focus，默认按 music 处理');
            return typeConfig['3'];
        }

        const href = navFocus.getAttribute('href') || '';

        if (/\/anime\/?$/.test(href)) {
            // console.info('[Bangumi 参与制作人物信息组件补丁] 成功获取类型：anime');
            return typeConfig['2'];
        }
        if (/\/game\/?$/.test(href)) {
            // console.info('[Bangumi 参与制作人物信息组件补丁] 成功获取类型：game');
            return typeConfig['4'];
        }
        if (/\/music\/?$/.test(href)) {
            // console.info('[Bangumi 批量关联角色与CV] 成功获取类型：music');
            return typeConfig['3'];
        }
        if (/\/real\/?$/.test(href)) {
            // console.info('[Bangumi 批量关联角色与CV] 成功获取类型：real');
            return typeConfig['6'];
        }
        if (/\/book\/?$/.test(href)) {
            // console.info('[Bangumi 批量关联角色与CV] 成功获取类型：book');
            return typeConfig['1'];
        }

        // console.warn('[Bangumi 批量关联角色与CV] 未识别条目类型 href =', href, '，默认按 music 处理');
        return typeConfig['3'];
    }

    function isEditDetailPage() {
        return /^\/subject\/\d+\/edit_detail\/?$/.test(location.pathname);
    }

    function isWikiDirectSubmitGroup(userGroup) {
        const n = Number(userGroup);
        if (!Number.isFinite(n)) return false;
        return WIKI_DIRECT_SUBMIT_GROUPS.has(n);
    }

    function getAuthUserGroup(me) {
        const raw =
            me?.user_group ??
            me?.userGroup ??
            me?.user?.user_group ??
            me?.user?.userGroup ??
            me?.profile?.user_group ??
            me?.profile?.userGroup;

        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
    }

    const currentType = getSubjectType();

    // 调试阶段优先 raw，并加时间戳避免缓存
    const DATA_URL_BUILDERS = [
        subjectId => `https://raw.githubusercontent.com/nightStarLights/bangumi-wiki-staff-display-fix/main/data/${subjectId}.json?ts=${Date.now()}`,
        subjectId => `https://gitee.com/SilenceChen/bangumi-wiki-staff-display-fix/raw/main/data/${subjectId}.json?ts=${Date.now()}`,
        subjectId => `https://cdn.jsdelivr.net/gh/nightStarLights/bangumi-wiki-staff-display-fix@main/data/${subjectId}.json?ts=${Date.now()}`,
    ];

    // 用于解析人员修复输入区
    const COMPOSITE_LABEL_ALIASES = {
        "作編曲": ["composer", "arranger"],
        "作编曲": ["composer", "arranger"],
        "作曲编曲": ["composer", "arranger"],
        "作曲编曲": ["composer", "arranger"],
        "作曲、編曲": ["composer", "arranger"],
        "作曲、编曲": ["composer", "arranger"],

        "作词作曲": ["lyricist", "composer"],
        "作詞作曲": ["lyricist", "composer"],
        "作词、作曲": ["lyricist", "composer"],
        "作詞、作曲": ["lyricist", "composer"],

        "作词作編曲": ["lyricist", "composer", "arranger"],
        "作詞作編曲": ["lyricist", "composer", "arranger"],
        "作词作曲編曲": ["lyricist", "composer", "arranger"],
        "作詞作曲編曲": ["lyricist", "composer", "arranger"],
        "作词、作曲、編曲": ["lyricist", "composer", "arranger"],
        "作詞、作曲、編曲": ["lyricist", "composer", "arranger"],

        "作词作编曲": ["lyricist", "composer", "arranger"],
        "作詞作编曲": ["lyricist", "composer", "arranger"],
        "作词作曲编曲": ["lyricist", "composer", "arranger"],
        "作詞作曲编曲": ["lyricist", "composer", "arranger"],
        "作词、作曲、编曲": ["lyricist", "composer", "arranger"],
        "作詞、作曲、编曲": ["lyricist", "composer", "arranger"]
    };

    const INPUT_LABEL_ALIASES = {
        "艺术家": "artist",
        "artist": "artist",
        "vocal": "artist",

        "作词": "lyricist",
        "lyric": "lyricist",
        "lyrics": "lyricist",
        "lyricist": "lyricist",

        "作曲": "composer",
        "composer": "composer",
        "compose": "composer",

        "编曲": "arranger",
        "arrange": "arranger",
        "arranger": "arranger",

        "厂牌": "label",
        "circle": "label",
        "label": "label",

        "声乐": "vocal",
        "vocal": "vocal",

        "vocal_support": "chorus",
        "chorus": "chorus",

        "录音": "recording",
        "recording": "recording",

        "混音": "mixing",
        "mixing": "mixing",

        "母带制作": "mastering",
        "mastering": "mastering",
        "マスタリング": "mastering",

        "制作人": "producer",
        "producer": "producer",

        "插图": "illustrator",
        "illustration": "illustrator",
        "illustrator": "illustrator",
        "illust": "illustrator",

        "原作": "original",

        "脚本": "script",

        "出版方": "publisher",

        "人声编辑": "vocaledit",
        "人声指导": "vocaldirection",
        "音响监督": "sounddirector",
        "客串": "featured",
        "合唱": "choir",
        "旁白": "narration",
        "念白": "narration",
        "旁白/念白": "narration",
        "念白/旁白": "narration",
        "ナレーション": "narration",
        "设计": "design",
        "design": "design",
    };

    // 用于解析现有信息
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

        "作词作編曲": ["lyricist", "composer", "arranger"],
        "作詞作編曲": ["lyricist", "composer", "arranger"],
        "作词作曲編曲": ["lyricist", "composer", "arranger"],
        "作詞作曲編曲": ["lyricist", "composer", "arranger"],
        "作词、作曲、編曲": ["lyricist", "composer", "arranger"],
        "作詞、作曲、編曲": ["lyricist", "composer", "arranger"],

        "作曲、编曲": ["composer", "arranger"],
        "作词、作曲": ["lyricist", "composer"],
        "作词、作曲、编曲": ["lyricist", "composer", "arranger"]
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
    };

    const ROLE_ORDER = [
        "artist",
        "producer",
        "lyricist",
        "composer",
        "arranger",
        "chorus",
        "recording",
        "mixing",
        "mastering",
        "illustrator",
        "script",
        "original",
        "publisher",
        "label",
        "instrument",
        "vocaledit",
        "vocaldirection",
        "sounddirector",
        "featured",
        "choir",
        "narration",
        "design",
    ];

    // 与 EXEC_WIKI-BGM `src/routes/postprocess.ts` 的 PREFIXABLE_ROLES 保持同步。
    // 这些职位支持 `X-子角色` 写法（例如 乐器-Guitar、设计-Web、母带制作-xxx）。
    // `X-子角色` 只用于特殊情况；没写子角色时依旧沿用原有写法（乐器、设计…）。
    const PREFIXABLE_ROLES = [
        "乐器", "设计", "插图", "作曲", "作词", "编曲", "制作人",
        "声乐", "和声", "合唱", "录音", "混音", "母带制作"
    ];

    /* ---------X-子角色 前缀职位--------- */
    function splitPrefixedRoleLabel(label) {
        const s = String(label || "").trim();
        for (const base of PREFIXABLE_ROLES) {
            if (s.startsWith(base + "-")) {
                const sub = s.slice(base.length + 1).trim();
                if (sub) return { base, sub };
            }
        }
        return null;
    }

    function getPrefixableBaseLabel(roleKey) {
        return PREFIXABLE_ROLES.find(base => (LABEL_TO_ROLES[base] || []).includes(roleKey)) || null;
    }

    // 可加 `-子角色` 的英文 roleKey（instrument / design / composer …）
    const PREFIXABLE_ROLE_KEYS = new Set(
        PREFIXABLE_ROLES.reduce((acc, base) => {
            (LABEL_TO_ROLES[base] || []).forEach(key => acc.push(key));
            return acc;
        }, [])
    );

    // 由条目反推编辑区里的职位标签：返回 { label, text }
    // - 乐器沿用原本「从 (Guitar) 文本反推子角色」的行为
    // - 其余职位优先使用 item.subRole 标记，避免把 (本名) 之类的别名误判成子角色
    function resolveSubRoleEditorLabel(roleKey, item, text) {
        const baseLabel = getEditorRoleLabel(roleKey);
        const base = getPrefixableBaseLabel(roleKey);
        if (!base) return { label: baseLabel, text };

        const marked = item && item.subRole ? String(item.subRole).trim() : "";

        if (!marked) {
            if (roleKey !== "instrument") return { label: baseLabel, text };
            const parsedInst = splitInstrumentEditorItemText(text);
            if (!parsedInst) return { label: baseLabel, text };
            return { label: `${base}-${parsedInst.inst}`, text: parsedInst.name };
        }

        const stripped = String(text || "").replace(/\)?\s*\(([^()]+)\)\s*$/, (whole, inner) => {
            if (inner.trim() !== marked) return whole;
            return whole.startsWith(")") ? ")" : "";
        });

        return { label: `${base}-${marked}`, text: stripped.trim() || text };
    }
    /* ---------X-子角色 前缀职位--------- */

    const STAFF_PATCH_RUNTIME = {
        subjectId: null,
        data: null,
        patchMap: {},
        baseTrackState: new Map(),
        globalMap: new Map(),
        importedDB: null,
        resolutionCache: null,
        subjectAliasRegistry: {},
        previewCompareMode: false,
        receiverBackfillTimer: null,
        inputSourceMode: "rawPatches",   // rawPatches | trackCredits
        inputDrafts: {
            rawPatches: "",
            trackCredits: ""
        },
        previewJsonMode: false,
        autoTaskSubmitting: false,
        baseEpinfoState: {
            rows: []
        },
        unlinkMode: false,
        relatedRefRemovals: new Set(),
    };

    /* ---------自定义职位--------- */

    function isCustomRoleKey(roleKey) {
        return typeof roleKey === "string" && /^custom-/i.test(roleKey);
    }

    function getRenderRoleLabel(roleKey) {
        if (isCustomRoleKey(roleKey)) {
            return String(roleKey).replace(/^custom-/i, "").trim() || roleKey;
        }
        return ROLE_LABELS[roleKey] || roleKey;
    }

    function getEditorRoleLabel(roleKey) {
        if (isCustomRoleKey(roleKey)) {
            return roleKey;
        }
        return ROLE_LABELS[roleKey] || roleKey;
    }

    /* ---------自定义职位--------- */


    function resolveLabelToRoles(label) {
        if (!label) return null;

        /* ---------X-子角色 前缀职位--------- */
        // 乐器-Guitar / 设计-Web … 归到对应的基础职位
        const prefixed = splitPrefixedRoleLabel(label);
        if (prefixed) {
            const baseRoles = LABEL_TO_ROLES[prefixed.base];
            if (baseRoles && baseRoles.length) return baseRoles.slice();
        }
        /* ---------X-子角色 前缀职位--------- */

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

    function gmRequest(url) {
        return fetch(url, {
            method: "GET",
            mode: "cors",
            credentials: "omit",
            cache: "no-store"
        }).then(async (res) => {
            return {
                status: res.status,
                responseText: await res.text()
            };
        });
    }

    async function sleep(ms) {
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
            // Worker 明确说主分支没有这个文件
            return null;
        }

        console.warn("[staff-patch] worker fetch failed, fallback to mirror:", workerRes);

        // 2) Worker 不通 / GitHub API 失败时，再走镜像兜底
        const mirrorData = await fetchFromMirrors(subjectId);
        if (mirrorData) return mirrorData;

        return null;
    }

    async function waitForTrackRowsReady(timeoutMs = 2000) {
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            const trackRows = collectTrackRows();
            if (trackRows.size) {
                let readyCount = 0;
                for (const [, li] of trackRows) {
                    if (li.querySelector(".epinfo")) readyCount++;
                }
                if (readyCount > 0) {
                    return trackRows;
                }
            }
            await sleep(300);
        }

        return collectTrackRows();
    }

    function getSubjectId() {
        const m = location.pathname.match(/^\/subject\/(\d+)/);
        return m ? m[1] : null;
    }

    function isRelatedPersonEditPage() {
        return /^\/subject\/\d+\/add_related\/person\/?$/.test(location.pathname);
    }

    function shouldAutoSubmitSonglistForUserGroup(userGroup) {
        return SONG_LIST_AUTO_SUBMIT_GROUPS.has(Number(userGroup));
    }

    function isCreateMusicPage() {
        return location.pathname === "/new_subject/3";
    }

    function getCurrentSubjectTitle() {
        const h1 =
            document.querySelector("#headerSubject h1 a")?.textContent ||
            document.querySelector("#headerSubject h1")?.textContent ||
            "";

        return normalizeCompareText(h1);
    }

    function parsePatchPayloadFromReceiverValue(raw) {
        const text = (raw || "").trim();
        if (!text) return null;

        try {
            const parsed = JSON.parse(text);

            // 「创建条目并补全」按钮需要的字段：回填表单 + 曲目表 + 封面
            const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
            const trackTable = typeof parsed.trackTable === "string" ? parsed.trackTable : "";
            // 站内关联专用数据（人物 + 职位），创建条目时用来写「关联人物」
            const relaTable = typeof parsed.relaTable === "string" ? parsed.relaTable : "";
            const cover =
                typeof parsed.cover === "string" && parsed.cover.startsWith("data:image/")
                    ? parsed.cover
                    : "";
            const infoBox = typeof parsed.infoBox === "string" ? parsed.infoBox : "";
            const description =
                typeof parsed.description === "string"
                    ? parsed.description
                    : typeof parsed.desc === "string"
                        ? parsed.desc
                        : "";
            const metaTags = Array.isArray(parsed.metaTags)
                ? parsed.metaTags.join(" ")
                : typeof parsed.metaTags === "string"
                    ? parsed.metaTags
                    : "";

            // 工具端结构化 content：有它就直传 repo，不必再解析 patch 文本
            const patchContent =
                parsed.patch_content &&
                typeof parsed.patch_content === "object" &&
                (parsed.patch_content.trackCredits || parsed.patch_content.epinfo)
                    ? parsed.patch_content
                    : null;

            const createFields = { title, trackTable, relaTable, cover, infoBox, description, metaTags };

            if (parsed.patchPolicy === "none") {
                return {
                    ...createFields,
                    editor: "",
                    noPatch: true
                };
            }

            const editor =
                typeof parsed.patch === "string" && parsed.patch.trim()
                    ? parsed.patch.trim()
                    : (
                        parsed.rawPatches &&
                            typeof parsed.rawPatches === "object" &&
                            typeof parsed.rawPatches.editor === "string" &&
                            parsed.rawPatches.editor.trim()
                            ? parsed.rawPatches.editor.trim()
                            : ""
                    );

            if (!editor) return null;

            return {
                ...createFields,
                editor,
                patchContent,
                noPatch: false
            };
        } catch {
            return null;
        }
    }

    // 所有接收器抓取入口都经过这里：解析的同时顺手为「创建条目并补全」记一份一次性数据
    // （非条目创建页不会写入）。patch_content 只在有当前条目 id 时才落暂存——
    // 新建条目页没有 id，写进去会被随后点开的任意条目捡走。
    function extractPatchPayloadFromReceiverValue(raw) {
        const payload = parsePatchPayloadFromReceiverValue(raw);

        if (payload) {
            saveCreateOneshotPayload(payload);
            saveAutoPatchContent(payload.patchContent);
        }

        return payload;
    }

    /**
     * 跨页暂存（raw editor / 曲目表 / patch_content / 创建态导出记录）的统一取值规则。
     *
     * 两道防线，缺一不可：
     * ① 写入端：没有条目 id 时一律不写（各 save* 函数自己挡住）——
     *    新建条目页拿到的 JSON 只留在内存的一次性数据里，点「创建条目并补全」
     *    并真正创建成功之后，才带着新条目 id 写进暂存；
     * ② 读取端：有当前条目时只认绑定到这个条目的记录，未绑定记录（旧版本残留）
     *    绝不能被随便点开的条目捡走。
     */
    function isStagedRecordAcceptable(parsed, subjectId) {
        if (!parsed) return false;

        if (Date.now() - Number(parsed.savedAt || 0) > 7 * 24 * 60 * 60 * 1000) return false;

        const boundId = parsed.subjectId ? String(parsed.subjectId) : "";

        // 绑定过条目 id 的记录只认那一个条目
        if (subjectId) return boundId === String(subjectId);

        // 当前页面没有条目 id（/ep 等）：未绑定记录按短时间窗放行
        if (!boundId) {
            return Date.now() - Number(parsed.savedAt || 0) <= UNBOUND_PENDING_PATCH_MAX_AGE_MS;
        }

        return true;
    }

    // 只有创建成功（点「创建条目并补全」并拿到新条目 id）时才会写入，
    // 平时这个函数是空操作：未绑定条目 id 的创建态记录一律不落地。
    function savePendingCreateExport(payload, subjectId = getSubjectId()) {
        if (!payload || !payload.editor) return;

        const id = subjectId ? String(subjectId) : "";
        if (!id) return;

        localStorage.setItem(PENDING_CREATE_EXPORT_KEY, JSON.stringify({
            savedAt: Date.now(),
            subjectId: id,
            title: normalizeCompareText(payload.title || ""),
            trackTable: payload.trackTable || "",
            editor: payload.editor
        }));
    }

    function getPendingCreateExportForCurrentPage(subjectId = getSubjectId()) {
        try {
            const raw = localStorage.getItem(PENDING_CREATE_EXPORT_KEY);
            if (!raw) return null;

            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.editor) return null;

            if (!isStagedRecordAcceptable(parsed, subjectId)) return null;

            return parsed;
        } catch {
            return null;
        }
    }

    function clearPendingCreateExport() {
        localStorage.removeItem(PENDING_CREATE_EXPORT_KEY);
    }

    /* ------------------------------------------------------------------
     * 「创建条目并补全」的一次性数据
     * 只活在内存里：刷新页面 / 关闭标签页即失效，绝不跨页面残留。
     * （与 PENDING_CREATE_EXPORT 是两回事，那份要留给新条目落地后的自动 patch。）
     * ------------------------------------------------------------------ */
    let createOneshotPayload = null;
    let lastCreateOneshotSignature = "";

    function saveCreateOneshotPayload(payload) {
        if (!payload || !isCreateMusicPage()) return;

        const record = {
            title: String(payload.title || "").trim(),
            trackTable: String(payload.trackTable || ""),
            relaTable: String(payload.relaTable || ""),
            cover: String(payload.cover || ""),
            infoBox: String(payload.infoBox || ""),
            description: String(payload.description || ""),
            metaTags: String(payload.metaTags || ""),
            editor: String(payload.editor || ""),
            noPatch: Boolean(payload.noPatch),
            // 工具端的结构化 patch 也一起带着：创建成功后要随暂存一起落到新条目 id 上
            patchContent: payload.patchContent && typeof payload.patchContent === "object"
                ? payload.patchContent
                : null
        };

        if (!record.title && !record.trackTable && !record.cover) return;

        // 同一份数据会被反复抓取（input/change/paste/回填轮询），
        // 用签名挡掉重复赋值，避免反复搬运几 MB 的封面 base64。
        const signature = [
            record.title,
            record.trackTable,
            record.relaTable.length,
            record.cover.length,
            record.infoBox.length,
            record.description.length,
            record.metaTags.length,
            record.editor.length
        ].join("\u0001");

        if (signature === lastCreateOneshotSignature) return;

        // 在「创建新条目」页面上拿到一份新数据 ⇒ 上一轮创建态 patch 即使没被消费也一律作废，
        // 否则它会被当成这次创建的数据，串到别的条目上。
        clearStalePendingCreatePatch();

        lastCreateOneshotSignature = signature;
        createOneshotPayload = record;

        // 注意：这里**不**写任何跨页暂存（raw editor / patch_content / 导出记录）。
        // 数据到手的瞬间就写暂存，会让用户随后点开的任意条目页在自动 patch 时把它捡走
        // ——那正是「新建页取到数据、切到哪个条目就往哪个条目写」的根因。
        // 暂存只在点「创建条目并补全」且条目真的创建成功后才写（commitCreatePatchForNewSubject）。

        // 页面上已挂按钮时，把「等待粘贴」提示换成就绪提示；
        // 只认这两个固定文案，不会覆盖进度或报错信息。
        // （类名与 CREATE_STATUS_CLASS 保持一致）
        const statusEl = document.querySelector(".bgm-staff-create-status");
        if (statusEl && (statusEl.textContent === CREATE_WAITING_HINT || statusEl.textContent === CREATE_READY_HINT)) {
            statusEl.classList.remove("is-error");
            statusEl.textContent = CREATE_READY_HINT;
        }

        // 顺手把封面缩略图渲染出来，并自动回填创建表单
        renderCreateCoverPreview(record);
        scheduleCreateFormAutoFill(record);
    }

    function getCreateOneshotPayload() {
        return createOneshotPayload;
    }

    function clearCreateOneshotPayload() {
        createOneshotPayload = null;
        lastCreateOneshotSignature = "";

        // 旧版本曾把它写进 localStorage：顺手清掉历史残留
        try {
            localStorage.removeItem(CREATE_ONESHOT_PAYLOAD_KEY);
        } catch { }
    }

    function createEmptyAutoPatchTask(subjectId) {
        return {
            subjectId: String(subjectId),
            createdAt: Date.now(),
            updatedAt: Date.now(),

            needsCreateBootstrap: false,
            needsRelatedPersonSync: false,
            needsEditDetailSync: false,
            songlistPending: false,

            relatedEntries: [],
            songlistMeta: null,
            lastSource: "",
            lastAttemptAt: 0,
            lastSuccessAt: 0
        };
    }

    function getAutoPatchTask() {
        try {
            const raw = localStorage.getItem(AUTO_PATCH_TASK_KEY);
            if (!raw) return null;

            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.subjectId) return null;

            if (Date.now() - Number(parsed.updatedAt || parsed.createdAt || 0) > 7 * 24 * 60 * 60 * 1000) {
                localStorage.removeItem(AUTO_PATCH_TASK_KEY);
                return null;
            }

            return parsed;
        } catch {
            return null;
        }
    }

    function getAutoPatchTaskForSubject(subjectId = getSubjectId()) {
        const task = getAutoPatchTask();
        if (!task || !subjectId) return null;
        return String(task.subjectId) === String(subjectId) ? task : null;
    }

    function saveAutoPatchTask(task) {
        if (!task?.subjectId) return;
        localStorage.setItem(AUTO_PATCH_TASK_KEY, JSON.stringify({
            ...task,
            updatedAt: Date.now()
        }));
    }

    function clearAutoPatchTask(subjectId = "") {
        const task = getAutoPatchTask();
        if (!task) return;

        if (subjectId && String(task.subjectId) !== String(subjectId)) {
            return;
        }

        localStorage.removeItem(AUTO_PATCH_TASK_KEY);
    }

    function hasAnyAutoPatchTask(task) {
        return !!(
            task?.needsCreateBootstrap ||
            task?.needsRelatedPersonSync ||
            task?.needsEditDetailSync ||
            task?.songlistPending
        );
    }

    function normalizeRelatedEntriesForTask(entries) {
        return (entries || []).map(entry => ({
            roleKey: entry.roleKey || "",
            personId: String(entry.personId || ""),
            personName: String(entry.personName || ""),
            trackKeys: Array.isArray(entry.trackKeys) ? entry.trackKeys.slice() : null
        })).filter(entry => entry.roleKey && entry.personId && entry.personName);
    }

    function mergeAutoPatchTask(patch = {}) {
        const subjectId = String(patch.subjectId || getSubjectId() || "");
        if (!subjectId) return null;

        const current = getAutoPatchTaskForSubject(subjectId) || createEmptyAutoPatchTask(subjectId);
        const next = { ...current };

        if (patch.needsCreateBootstrap) next.needsCreateBootstrap = true;
        if (patch.needsRelatedPersonSync) next.needsRelatedPersonSync = true;
        if (patch.needsEditDetailSync) next.needsEditDetailSync = true;
        if (patch.songlistPending) next.songlistPending = true;

        if (Array.isArray(patch.relatedEntries) && patch.relatedEntries.length) {
            next.relatedEntries = normalizeRelatedEntriesForTask(patch.relatedEntries);
        }

        if (patch.songlistMeta) {
            next.songlistMeta = { ...patch.songlistMeta };
        }

        if (patch.lastSource) {
            next.lastSource = String(patch.lastSource);
        }

        saveAutoPatchTask(next);
        return next;
    }

    function clearAutoPatchTaskFlags(kind, subjectId = getSubjectId()) {
        const task = getAutoPatchTaskForSubject(subjectId);
        if (!task) return;

        const next = { ...task };

        if (kind === "related") {
            next.needsRelatedPersonSync = false;
            next.relatedEntries = [];
        }

        if (kind === "patch") {
            next.needsCreateBootstrap = false;
            next.needsEditDetailSync = false;
            next.songlistPending = false;
            next.songlistMeta = null;
        }

        if (kind === "songlist") {
            next.songlistPending = false;
            next.songlistMeta = null;
        }

        // 只清 edit-detail：非维基人提交不了它，但不能连累 create-bootstrap
        if (kind === "edit-detail") {
            next.needsEditDetailSync = false;
        }

        if (!hasAnyAutoPatchTask(next)) {
            clearAutoPatchTask(subjectId);
            clearAutoPatchRawEditor();
            return;
        }

        saveAutoPatchTask(next);
    }

    function consumeTaskAfterSuccessfulSubmit(task, mode) {
        if (!task) return;

        const next = { ...task, lastSuccessAt: Date.now() };

        if (mode === "related") {
            next.needsRelatedPersonSync = false;
            next.relatedEntries = [];

            next.needsCreateBootstrap = false;
            next.needsEditDetailSync = false;
            next.songlistPending = false;
            next.songlistMeta = null;
        } else if (mode === "patch") {
            next.needsCreateBootstrap = false;
            next.needsEditDetailSync = false;
            next.songlistPending = false;
            next.songlistMeta = null;
        } else if (mode === "songlist") {
            next.songlistPending = false;
            next.songlistMeta = null;
        }

        if (!hasAnyAutoPatchTask(next)) {
            clearAutoPatchTask(task.subjectId);
            clearAutoPatchRawEditor();
            return;
        }

        saveAutoPatchTask(next);
    }

    function isSubjectMainPage() {
        return /^\/subject\/\d+\/?$/.test(location.pathname);
    }

    function extractRawEditorFromReceiverValue(raw) {
        const text = (raw || "").trim();
        if (!text) return "";

        try {
            const parsed = JSON.parse(text);

            if (typeof parsed.patch === "string" && parsed.patch.trim()) {
                return parsed.patch.trim();
            }

            if (
                parsed.rawPatches &&
                typeof parsed.rawPatches === "object" &&
                typeof parsed.rawPatches.editor === "string" &&
                parsed.rawPatches.editor.trim()
            ) {
                return parsed.rawPatches.editor.trim();
            }
        } catch (_) { }

        return "";
    }

    // 写入端的统一闸门：拿到条目 id 才允许进跨页暂存。
    // 新建条目页没有条目 id，数据只留在内存的一次性 payload 里，
    // 点「创建条目并补全」创建成功后由 commitCreatePatchForNewSubject 带 id 再写。
    function saveAutoPatchRawEditor(text, subjectId = getSubjectId()) {
        const value = (text || "").trim();
        if (!value || !subjectId) return;

        const payload = JSON.stringify({
            subjectId: String(subjectId),
            savedAt: Date.now(),
            text: value
        });

        sessionStorage.setItem(AUTO_PATCH_RAW_EDITOR_KEY, payload);
        localStorage.setItem(AUTO_PATCH_RAW_EDITOR_PERSIST_KEY, payload);
    }

    // 曲目表（trackTable）：与 raw editor 同一套「按条目 id + 7 天时效」的规矩，
    // 「章节一键填注释」在 /ep 与批量修改页之间靠它取用。
    function saveAutoPatchTrackTable(trackTable, subjectId = getSubjectId()) {
        const value = String(trackTable || "").trim();
        if (!value || !subjectId) return;

        const payload = JSON.stringify({
            subjectId: String(subjectId),
            savedAt: Date.now(),
            trackTable: value
        });

        sessionStorage.setItem(TRACK_TABLE_KEY, payload);
        localStorage.setItem(TRACK_TABLE_PERSIST_KEY, payload);
    }

    function getAutoPatchTrackTable(subjectId = getSubjectId()) {
        const read = (raw) => {
            if (!raw) return "";

            try {
                const parsed = JSON.parse(raw);
                if (!parsed || typeof parsed.trackTable !== "string" || !parsed.trackTable.trim()) {
                    return "";
                }

                if (!isStagedRecordAcceptable(parsed, subjectId)) return "";

                return parsed.trackTable.trim();
            } catch {
                return "";
            }
        };

        const fromSession = read(sessionStorage.getItem(TRACK_TABLE_KEY));
        if (fromSession) return fromSession;

        const fromPersist = read(localStorage.getItem(TRACK_TABLE_PERSIST_KEY));
        if (fromPersist) return fromPersist;

        // 创建流程的待写入记录里也留着 trackTable（创建成功后直接绑定到新条目 id）
        const pending = getPendingCreateExportForCurrentPage();
        if (pending && String(pending.trackTable || "").trim()) {
            return String(pending.trackTable).trim();
        }

        return "";
    }

    function clearAutoPatchTrackTable() {
        sessionStorage.removeItem(TRACK_TABLE_KEY);
        localStorage.removeItem(TRACK_TABLE_PERSIST_KEY);
    }

    function saveAutoPatchPolicy(policy, subjectId = getSubjectId()) {
        if (!subjectId) return;

        localStorage.setItem(AUTO_PATCH_POLICY_KEY, JSON.stringify({
            subjectId: String(subjectId),
            savedAt: Date.now(),
            policy: String(policy || "")
        }));
    }

    function getAutoPatchPolicy(subjectId = getSubjectId()) {
        try {
            const raw = localStorage.getItem(AUTO_PATCH_POLICY_KEY);
            if (!raw) return "";

            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed.policy !== "string") return "";

            if (!isStagedRecordAcceptable(parsed, subjectId)) return "";

            return parsed.policy;
        } catch {
            return "";
        }
    }

    function clearAutoPatchPolicy() {
        localStorage.removeItem(AUTO_PATCH_POLICY_KEY);
    }

    function getAutoPatchRawEditor(subjectId = getSubjectId()) {
        const read = (raw) => {
            if (!raw) return "";

            try {
                const parsed = JSON.parse(raw);
                if (!parsed || typeof parsed.text !== "string" || !parsed.text.trim()) {
                    return "";
                }

                if (!isStagedRecordAcceptable(parsed, subjectId)) return "";

                return parsed.text.trim();
            } catch {
                return "";
            }
        };

        const sessionText = read(sessionStorage.getItem(AUTO_PATCH_RAW_EDITOR_KEY));
        if (sessionText) return sessionText;

        const persistText = read(localStorage.getItem(AUTO_PATCH_RAW_EDITOR_PERSIST_KEY));
        if (persistText) return persistText;

        const pendingCreate = getPendingCreateExportForCurrentPage();
        if (pendingCreate && pendingCreate.editor) {
            return pendingCreate.editor.trim();
        }

        return "";
    }

    function clearAutoPatchRawEditor() {
        sessionStorage.removeItem(AUTO_PATCH_RAW_EDITOR_KEY);
        localStorage.removeItem(AUTO_PATCH_RAW_EDITOR_PERSIST_KEY);
        clearAutoPatchContent();
        clearPendingCreateExport();
    }

    /* ------------------------------------------------------------------
     * 工具端 patch_content：结构化直传
     * 与 raw editor 分开存，提交时优先用它 —— 工具端已经给出结构化 content，
     * 站内不必再解析一遍 patch 文本（解析路径保留，供「人员修复」等旧流程）。
     * ------------------------------------------------------------------ */
    function saveAutoPatchContent(content, subjectId = getSubjectId()) {
        if (!content || typeof content !== "object") return;
        if (!subjectId) return;

        const payload = JSON.stringify({
            subjectId: String(subjectId),
            savedAt: Date.now(),
            content
        });

        try {
            sessionStorage.setItem(AUTO_PATCH_CONTENT_KEY, payload);
            localStorage.setItem(AUTO_PATCH_CONTENT_PERSIST_KEY, payload);
        } catch (err) {
            console.warn("[staff-patch] save patch content failed:", err);
        }
    }

    function getAutoPatchContent(subjectId = getSubjectId()) {
        const read = (raw) => {
            if (!raw) return null;

            try {
                const parsed = JSON.parse(raw);
                if (!parsed || !parsed.content || typeof parsed.content !== "object") {
                    return null;
                }

                if (!isStagedRecordAcceptable(parsed, subjectId)) return null;

                return parsed.content;
            } catch {
                return null;
            }
        };

        return (
            read(sessionStorage.getItem(AUTO_PATCH_CONTENT_KEY)) ||
            read(localStorage.getItem(AUTO_PATCH_CONTENT_PERSIST_KEY))
        );
    }

    function clearAutoPatchContent() {
        sessionStorage.removeItem(AUTO_PATCH_CONTENT_KEY);
        localStorage.removeItem(AUTO_PATCH_CONTENT_PERSIST_KEY);
    }

    function saveAutoPatchLastResult(payload) {
        try {
            sessionStorage.setItem(AUTO_PATCH_LAST_RESULT_KEY, JSON.stringify({
                savedAt: Date.now(),
                ...payload
            }));
        } catch { }
    }

    function saveAfterAuthAction(action) {
        try {
            sessionStorage.setItem(AFTER_AUTH_ACTION_KEY, JSON.stringify(action));
        } catch { }
    }

    function consumeAfterAuthAction() {
        try {
            const raw = sessionStorage.getItem(AFTER_AUTH_ACTION_KEY);
            if (!raw) return null;
            sessionStorage.removeItem(AFTER_AUTH_ACTION_KEY);
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    function consumeAutoPatchLastResult() {
        try {
            const raw = sessionStorage.getItem(AUTO_PATCH_LAST_RESULT_KEY);
            if (!raw) return null;
            sessionStorage.removeItem(AUTO_PATCH_LAST_RESULT_KEY);
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    function captureRawEditorFromRawText(raw, subjectId = getSubjectId()) {
        const payload = extractPatchPayloadFromReceiverValue(raw);
        if (!payload) return "";

        if (payload.noPatch) {
            saveAutoPatchPolicy("none", subjectId);
            clearAutoPatchRawEditor();
            clearPendingCreateExport();
            clearAutoPatchTrackTable();
            return "";
        }

        if (!payload.editor) return "";

        // 没有条目 id（新建条目页）时这些写入会自动跳过，数据只留在内存的一次性 payload 里
        saveAutoPatchPolicy("selective", subjectId);
        saveAutoPatchRawEditor(payload.editor, subjectId);
        saveAutoPatchTrackTable(payload.trackTable, subjectId);

        console.log("[staff-patch] captured raw editor length =", payload.editor.length);
        return payload.editor;
    }

    function captureRawEditorFromKnownReceivers() {
        const selectors = [
            "#execwb-receiver",
            "#bgm-btn-import",
            "#manumatic-raw"
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (!el) continue;

            const value =
                "value" in el
                    ? String(el.value || "")
                    : String(el.textContent || "");

            const payload = extractPatchPayloadFromReceiverValue(value);
            if (!payload) continue;

            if (payload.noPatch) {
                saveAutoPatchPolicy("none", getSubjectId());
                clearAutoPatchRawEditor();
                clearPendingCreateExport();
                clearAutoPatchTrackTable();
                return "";
            }

            if (payload.editor) {
                // 没有条目 id（新建条目页）时这些写入会自动跳过
                saveAutoPatchPolicy("selective", getSubjectId());
                saveAutoPatchRawEditor(payload.editor, getSubjectId());
                saveAutoPatchTrackTable(payload.trackTable, getSubjectId());

                return payload.editor;
            }
        }

        return "";
    }

    function armReceiverBackfillCapture() {
        if (STAFF_PATCH_RUNTIME.receiverBackfillTimer) return;

        let tries = 0;
        const maxTries = 120; // 约 60 秒
        let lastSeenValue = "";

        const tick = () => {
            tries++;

            const selectors = [
                "#execwb-receiver",
                "#bgm-btn-import",
                "#manumatic-raw"
            ];

            let currentValue = "";
            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (!el) continue;

                currentValue =
                    "value" in el
                        ? String(el.value || "")
                        : String(el.textContent || "");

                if (currentValue) break;
            }

            if (currentValue && currentValue !== lastSeenValue) {
                lastSeenValue = currentValue;
                const editor = captureRawEditorFromKnownReceivers();
                if (editor) {
                    console.log("[staff-patch] receiver backfill captured editor");
                    clearInterval(STAFF_PATCH_RUNTIME.receiverBackfillTimer);
                    STAFF_PATCH_RUNTIME.receiverBackfillTimer = null;
                    return;
                }
            }

            if (tries >= maxTries) {
                clearInterval(STAFF_PATCH_RUNTIME.receiverBackfillTimer);
                STAFF_PATCH_RUNTIME.receiverBackfillTimer = null;
            }
        };

        tick();
        STAFF_PATCH_RUNTIME.receiverBackfillTimer = setInterval(tick, 500);

        window.addEventListener("pageshow", tick);
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
                tick();
            }
        });
    }

    function getSavedSessionRecord() {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return null;

        try {
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.value) return null;

            if (Date.now() - Number(parsed.savedAt || 0) > 7 * 24 * 60 * 60 * 1000) {
                localStorage.removeItem(SESSION_KEY);
                return null;
            }

            return {
                value: parsed.value,
                savedAt: Number(parsed.savedAt || 0),
                validatedAt: Number(parsed.validatedAt || 0),
                authUsername: String(parsed.authUsername || "").trim()
            };
        } catch {
            return null;
        }
    }

    function getSavedSession() {
        return getSavedSessionRecord()?.value || "";
    }

    function saveSession(session, extra = {}) {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
            value: session,
            savedAt: Date.now(),
            validatedAt: Number(extra.validatedAt || 0),
            authUsername: String(extra.authUsername || "").trim()
        }));
    }

    function clearSession() {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(AUTH_GRANTED_AT_KEY);
    }

    // 走完一次真实授权（worker 发回新 session）时调用；不要在校验/刷新时调用，
    // 否则授权时间会一直往后滑，永远不会判定为过期。
    function markAuthGranted(at = Date.now()) {
        try {
            localStorage.setItem(AUTH_GRANTED_AT_KEY, String(at));
        } catch { }
    }

    function getAuthGrantedAt() {
        try {
            const n = Number(localStorage.getItem(AUTH_GRANTED_AT_KEY) || 0);
            if (Number.isFinite(n) && n > 0) return n;
        } catch { }

        // 旧版本没有单独记录授权时间：用本地 session 的写入时间近似
        return getSavedSessionRecord()?.savedAt || 0;
    }

    // 本地记录的 bgm 授权是否已过期（没有 session、或授权超过 7 天）
    function isLocalAuthorizationExpired(now = Date.now()) {
        if (!getSavedSession()) return true;

        const grantedAt = getAuthGrantedAt();
        if (!grantedAt) return true;

        return now - grantedAt >= AUTH_GRANT_TTL_MS;
    }

    function getCurrentBangumiUsername() {
        const direct = String(window.CHOBITS_USERNAME || "").trim();
        if (direct) return direct;

        const selectors = [
            '#dock a[href*="/user/"]',
            '#header h1 a.l[href*="/user/"]',
            '#wrapperNeue #header h1 a.l[href*="/user/"]'
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (!el) continue;

            const href = el.getAttribute("href") || "";
            const m = href.match(/\/user\/([^/?#]+)/);
            if (m) return decodeURIComponent(m[1]);

            const text = String(el.textContent || "").trim();
            if (text) return text;
        }

        return "";
    }

    function normalizeAliasKey(name) {
        return stripOuterBookQuotes(name || "")
            .trim()
            .normalize("NFKC")
            .replace(/\s+/g, " ");
    }

    function normalizeAliasKeyLoose(name) {
        return normalizeAliasKey(name).toLocaleLowerCase();
    }

    function emptyImportedDB() {
        return {
            settingsRaw: "",
            peopleById: {},
            // 严格匹配
            aliasIndex: {},
            // 宽松匹配，只做候选
            aliasIndexLoose: {},
            importedAt: ""
        };
    }

    function loadImportedDB() {
        if (STAFF_PATCH_RUNTIME.importedDB) {
            return STAFF_PATCH_RUNTIME.importedDB;
        }

        try {
            const raw = localStorage.getItem(IMPORTED_DB_KEY);
            if (!raw) {
                STAFF_PATCH_RUNTIME.importedDB = emptyImportedDB();
                return STAFF_PATCH_RUNTIME.importedDB;
            }

            const parsed = JSON.parse(raw);
            STAFF_PATCH_RUNTIME.importedDB = {
                settingsRaw: parsed.settingsRaw || "",
                peopleById: parsed.peopleById || {},
                aliasIndex: parsed.aliasIndex || {},
                aliasIndexLoose: parsed.aliasIndexLoose || {},
                importedAt: parsed.importedAt || ""
            };
            return STAFF_PATCH_RUNTIME.importedDB;
        } catch (err) {
            console.warn("[staff-patch] loadImportedDB failed:", err);
            STAFF_PATCH_RUNTIME.importedDB = emptyImportedDB();
            return STAFF_PATCH_RUNTIME.importedDB;
        }
    }

    function saveImportedDB(db) {
        STAFF_PATCH_RUNTIME.importedDB = db;
        localStorage.setItem(IMPORTED_DB_KEY, JSON.stringify(db));
    }

    function loadResolutionCache() {
        if (STAFF_PATCH_RUNTIME.resolutionCache) {
            return STAFF_PATCH_RUNTIME.resolutionCache;
        }

        try {
            const raw = localStorage.getItem(RESOLUTION_CACHE_KEY);
            STAFF_PATCH_RUNTIME.resolutionCache = raw ? JSON.parse(raw) : {};
            return STAFF_PATCH_RUNTIME.resolutionCache;
        } catch (err) {
            console.warn("[staff-patch] loadResolutionCache failed:", err);
            STAFF_PATCH_RUNTIME.resolutionCache = {};
            return STAFF_PATCH_RUNTIME.resolutionCache;
        }
    }

    function saveResolutionCache(cache) {
        STAFF_PATCH_RUNTIME.resolutionCache = cache;
        localStorage.setItem(RESOLUTION_CACHE_KEY, JSON.stringify(cache));
    }

    function getResolutionKey(subjectId, roleKey, aliasText) {
        return `${subjectId}::${roleKey}::${normalizeAliasKey(aliasText)}`;
    }

    function getResolvedPersonId(subjectId, roleKey, aliasText) {
        const cache = loadResolutionCache();
        return cache[getResolutionKey(subjectId, roleKey, aliasText)] || null;
    }

    function setResolvedPersonId(subjectId, roleKey, aliasText, personId) {
        const cache = loadResolutionCache();
        cache[getResolutionKey(subjectId, roleKey, aliasText)] = personId;
        saveResolutionCache(cache);
    }

    function clearResolvedPersonId(subjectId, roleKey, aliasText) {
        const cache = loadResolutionCache();
        delete cache[getResolutionKey(subjectId, roleKey, aliasText)];
        saveResolutionCache(cache);
    }

    function getPersonById(personId) {
        const db = loadImportedDB();
        return db.peopleById?.[personId] || null;
    }

    function getAliasCandidates(aliasText) {
        const db = loadImportedDB();
        const key = normalizeAliasKey(aliasText);
        const ids = db.aliasIndex?.[key] || [];
        return ids.map(id => db.peopleById[id]).filter(Boolean);
    }

    function getAliasCandidatesLoose(aliasText) {
        const db = loadImportedDB();
        const key = normalizeAliasKeyLoose(aliasText);
        const ids = db.aliasIndexLoose?.[key] || [];
        return ids.map(id => db.peopleById[id]).filter(Boolean);
    }

    function getImportedDBStats() {
        const db = loadImportedDB();
        return {
            people: Object.keys(db.peopleById || {}).length,
            aliases: Object.keys(db.aliasIndex || {}).length,
            importedAt: db.importedAt || ""
        };
    }

    function addAliasToIndex(aliasIndex, name, personId) {
        const key = normalizeAliasKey(name);
        if (!key) return;
        if (!aliasIndex[key]) aliasIndex[key] = [];
        if (!aliasIndex[key].includes(personId)) {
            aliasIndex[key].push(personId);
        }
    }

    function addAliasToLooseIndex(aliasIndexLoose, name, personId) {
        const key = normalizeAliasKeyLoose(name);
        if (!key) return;
        if (!aliasIndexLoose[key]) aliasIndexLoose[key] = [];
        if (!aliasIndexLoose[key].includes(personId)) {
            aliasIndexLoose[key].push(personId);
        }
    }

    function parseWikiToolBackup(rawText) {
        const lines = rawText
            .split(/\r?\n/)
            .map(line => line.replace(/\uFEFF/g, ""))
            .filter(line => line.trim() !== "");

        if (!lines.length) {
            throw new Error("备份内容为空");
        }

        const settingsRaw = lines[0];
        const peopleById = {};
        const aliasIndex = {};
        const aliasIndexLoose = {};

        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split("\t");
            if (cols.length < 3) continue;

            const id = (cols[0] || "").trim();
            const avatar = (cols[1] || "").trim();
            const canonical = (cols[2] || "").trim();
            const aliases = cols.slice(3).map(s => s.trim()).filter(Boolean);

            if (!id || !canonical) continue;

            peopleById[id] = {
                id,
                avatar,
                canonical,
                aliases
            };

            addAliasToIndex(aliasIndex, canonical, id);
            addAliasToLooseIndex(aliasIndexLoose, canonical, id);

            for (const alias of aliases) {
                addAliasToIndex(aliasIndex, alias, id);
                addAliasToLooseIndex(aliasIndexLoose, alias, id);
            }
        }

        return {
            settingsRaw,
            peopleById,
            aliasIndex,
            aliasIndexLoose,
            importedAt: new Date().toISOString()
        };
    }

    function resolveImportedPersonByRef(ref) {
        if (!ref || !/^p:\d+$/.test(ref)) return null;
        const id = ref.replace(/^p:/, "");
        const db = loadImportedDB();
        return db.peopleById[id] || null;
    }

    function resolveCreditEntityCore(seg, roleKey, trackKey, subjectId) {
        if (!seg || seg.kind !== "entity") return null;

        // 1. 明确 ref 时优先按 ref
        const byRef = resolveImportedPersonByRef(seg.ref || null);
        if (byRef) {
            return {
                id: byRef.id,
                ref: `p:${byRef.id}`,
                aliasText: seg.text || byRef.canonical,
                canonical: byRef.canonical,
                isAlias: (seg.text || byRef.canonical) !== byRef.canonical,
                ambiguous: false,
                candidates: [byRef]
            };
        }

        // 2. 本地手动解析缓存
        const cachedId = getResolvedPersonId(subjectId, roleKey, seg.text || "");
        if (cachedId) {
            const person = getPersonById(cachedId);
            if (person) {
                return {
                    id: person.id,
                    ref: `p:${person.id}`,
                    aliasText: seg.text || person.canonical,
                    canonical: person.canonical,
                    isAlias: (seg.text || person.canonical) !== person.canonical,
                    ambiguous: false,
                    candidates: [person]
                };
            }
        }

        // 3. 当前页面已知的别名 → 实际人物
        const subjectAlias = getSubjectAliasResolution(roleKey, seg.text || "");
        if (subjectAlias && subjectAlias.text) {
            const ref = subjectAlias.ref || null;
            const id = ref && /^p:\d+$/.test(ref) ? ref.replace(/^p:/, "") : null;

            return {
                id,
                ref,
                aliasText: seg.text || "",
                canonical: subjectAlias.text,
                isAlias: (seg.text || "") !== subjectAlias.text,
                ambiguous: false,
                candidates: id ? [getPersonById(id)].filter(Boolean) : []
            };
        }

        // 4. 再按导入数据库查别名
        // 4. 再按导入数据库查别名
        const lookupCandidates = extractAliasLookupCandidates(seg.text || "");

        // 4.1 严格匹配：按候选顺序依次尝试，命中唯一结果就直接返回
        for (const aliasCandidate of lookupCandidates) {
            const exactCandidates = getAliasCandidates(aliasCandidate);

            if (exactCandidates.length === 1) {
                const person = exactCandidates[0];
                return {
                    id: person.id,
                    ref: `p:${person.id}`,
                    aliasText: aliasCandidate,
                    canonical: person.canonical,
                    isAlias: aliasCandidate !== person.canonical,
                    ambiguous: false,
                    candidates: exactCandidates
                };
            }

            if (exactCandidates.length > 1) {
                return {
                    id: null,
                    ref: seg.ref || null,
                    aliasText: aliasCandidate,
                    canonical: aliasCandidate,
                    isAlias: false,
                    ambiguous: true,
                    candidates: exactCandidates
                };
            }
        }

        // 4.2 宽松匹配：仍按候选顺序尝试
        for (const aliasCandidate of lookupCandidates) {
            const looseCandidates = getAliasCandidatesLoose(aliasCandidate);

            if (looseCandidates.length) {
                return {
                    id: null,
                    ref: seg.ref || null,
                    aliasText: aliasCandidate,
                    canonical: aliasCandidate,
                    isAlias: false,
                    ambiguous: true,
                    candidates: looseCandidates
                };
            }
        }

        return {
            id: null,
            ref: seg.ref || null,
            aliasText: seg.text || "",
            canonical: seg.text || "",
            isAlias: false,
            ambiguous: false,
            candidates: []
        };
    }

    // 用户主动「去除关联」的实体：保留名字解析结果，但不再带回 ref
    function resolveCreditEntity(seg, roleKey, trackKey, subjectId) {
        const resolved = resolveCreditEntityCore(seg, roleKey, trackKey, subjectId);
        if (!resolved) return resolved;

        if (seg?.unlinked) {
            return { ...resolved, id: null, ref: null };
        }

        return resolved;
    }

    async function consumeSessionFromHash() {
        const hash = location.hash || "";

        const directMatch = hash.match(/bgm_session=([^&]+)/);
        if (directMatch) {
            const session = decodeURIComponent(directMatch[1]);
            if (session) {
                saveSession(session, {
                    validatedAt: Date.now(),
                    authUsername: getCurrentBangumiUsername()
                });
                markAuthGranted();
                history.replaceState(null, "", location.pathname + location.search);
                return session;
            }
            return null;
        }

        const authMatch = hash.match(/bgm_auth=([^&]+)/);
        if (!authMatch) return null;

        const token = decodeURIComponent(authMatch[1]);
        if (!token) {
            return null;
        }

        try {
            const session = await consumeBridgeToken(token);
            if (session) {
                saveSession(session, {
                    validatedAt: Date.now(),
                    authUsername: getCurrentBangumiUsername()
                });
                markAuthGranted();
                history.replaceState(null, "", location.pathname + location.search);
                return session;
            }
            return null;
        } catch (err) {
            console.warn("[staff-patch] consume bridge token failed:", err);
            // 失败时不要清 hash，保留 token，允许用户刷新后重试
            return null;
        }
    }

    function maybeReloadCreateMusicPageAfterAuth(consumedSession) {
        if (!isCreateMusicPage()) return false;
        if (!consumedSession) {
            sessionStorage.removeItem(CREATE_PAGE_AUTH_RELOAD_KEY);
            return false;
        }

        if (sessionStorage.getItem(CREATE_PAGE_AUTH_RELOAD_KEY) === "1") {
            sessionStorage.removeItem(CREATE_PAGE_AUTH_RELOAD_KEY);
            return false;
        }

        sessionStorage.setItem(CREATE_PAGE_AUTH_RELOAD_KEY, "1");
        location.reload();
        return true;
    }

    function markRepairPageAuthReloadPending() {
        try {
            sessionStorage.setItem(REPAIR_PAGE_AUTH_RELOAD_KEY, "1");
        } catch { }
    }

    function maybeReloadRepairPageAfterAuth(consumedSession) {
        if (!isSubjectMainPage()) return false;
        if (!consumedSession) {
            sessionStorage.removeItem(REPAIR_PAGE_AUTH_RELOAD_KEY);
            return false;
        }

        if (sessionStorage.getItem(REPAIR_PAGE_AUTH_RELOAD_KEY) !== "1") {
            return false;
        }

        sessionStorage.removeItem(REPAIR_PAGE_AUTH_RELOAD_KEY);
        location.reload();
        return true;
    }

    function startAuth() {
        const returnTo = location.origin + location.pathname + location.search;
        location.href = `${WORKER_URL}/auth/start?return_to=${encodeURIComponent(returnTo)}`;
    }

    async function ensureAuthorizedOnCreateMusicPage() {
        if (!isCreateMusicPage()) return true;

        // 授权已过期（本地 session 没有 / 或授权超过 7 天）：直接重走授权，
        // 不再只看 /auth/me —— worker 的 session 有时比 bgm 授权活得更久，
        // 那边回 ok 但真正写 repo 时 bgm token 已经失效，patch 就传不上去。
        if (isLocalAuthorizationExpired()) {
            console.log("[staff-patch] create page: authorization expired, start auth");
            startAuth();
            return false;
        }

        const me = await authMe().catch(() => ({ ok: false }));
        if (me && me.ok) {
            return true;
        }

        // /auth/me 说没授权：本地 session 已不可用，清掉重来
        clearSession();
        startAuth();
        return false;
    }

    async function consumeBridgeToken(token) {
        const res = await fetch(`${WORKER_URL}/auth/consume-token`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ token })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok || !data.session) {
            throw new Error(data.error || `授权令牌兑换失败: ${res.status}`);
        }

        return data.session;
    }

    async function authMeRaw(session) {
        if (!session) return { ok: false, error: "missing session" };

        const res = await fetch(`${WORKER_URL}/auth/me`, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${session}`
            }
        });

        if (res.status === 401) {
            return { ok: false, error: "unauthorized" };
        }

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            return {
                ok: false,
                error: data.error || `auth/me failed: ${res.status}`
            };
        }

        return {
            ...data,
            user_group:
                data?.user_group ??
                data?.userGroup ??
                data?.user?.user_group ??
                data?.user?.userGroup ??
                null
        };
    }

    async function authLogoutRaw(session) {
        if (!session) return { ok: true };

        await fetch(`${WORKER_URL}/auth/logout`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${session}`
            }
        });

        return { ok: true };
    }

    async function ensureSessionMatchesCurrentBangumiUser() {
        const record = getSavedSessionRecord();
        if (!record || !record.value) return "";

        const currentUsername = getCurrentBangumiUsername();
        const now = Date.now();
        const maxAge = 7 * 24 * 60 * 60 * 1000;

        // 当前页面已经明确换了 Bangumi 账号
        if (
            currentUsername &&
            record.authUsername &&
            String(currentUsername).trim() !== String(record.authUsername).trim()
        ) {
            try {
                await authLogoutRaw(record.value);
            } catch { }
            clearSession();
            return "";
        }

        // 7 天内已验证过，就直接信任本地 session
        if (record.validatedAt && now - record.validatedAt < maxAge) {
            return record.value;
        }

        // 超过 7 天才重新校验一次
        const me = await authMeRaw(record.value).catch(() => ({
            ok: false,
            error: "auth-me-failed"
        }));

        // 只有明确 unauthorized 才清
        if (!me || !me.ok) {
            if (String(me?.error || "") === "unauthorized") {
                clearSession();
                return "";
            }

            // 网络抖动 / Worker 临时失败时，不要立刻清 session
            return record.value;
        }

        // 校验成功，刷新 validatedAt 和 authUsername
        saveSession(record.value, {
            validatedAt: now,
            authUsername: String(me.username || currentUsername || "").trim()
        });

        // 如果当前页面用户名明确存在，且和授权用户不同，才清
        if (
            currentUsername &&
            me.username &&
            String(me.username).trim() !== String(currentUsername).trim()
        ) {
            try {
                await authLogoutRaw(record.value);
            } catch { }
            clearSession();
            return "";
        }

        return record.value;
    }

    async function authMe() {
        const session = await ensureSessionMatchesCurrentBangumiUser();
        if (!session) return { ok: false, error: "missing session" };
        return authMeRaw(session);
    }

    async function authLogout() {
        const session = getSavedSession();
        if (session) {
            try {
                await authLogoutRaw(session);
            } catch { }
        }
        clearSession();
        return { ok: true };
    }

    async function fetchPendingPrStatus(subjectId) {
        const session = await ensureSessionMatchesCurrentBangumiUser();

        const headers = {};
        if (session) {
            headers["Authorization"] = `Bearer ${session}`;
        }

        const res = await fetch(`${WORKER_URL}/pr-status?subjectId=${encodeURIComponent(subjectId)}`, {
            method: "GET",
            headers
        });

        if (!res.ok) {
            throw new Error(`PR 状态查询失败: ${res.status}`);
        }

        return await res.json();
    }

    async function fetchPendingPrContent(subjectId) {
        const session = await ensureSessionMatchesCurrentBangumiUser();
        if (!session) throw new Error("未授权");

        const res = await fetch(`${WORKER_URL}/pr-content?subjectId=${encodeURIComponent(subjectId)}`, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${session}`
            }
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            throw new Error(data.error || `PR 内容读取失败: ${res.status}`);
        }

        return data;
    }

    // SVG Display Start
    async function fetchPendingPrList(limit = 100) {
        const session = await ensureSessionMatchesCurrentBangumiUser();
        const headers = {};

        if (session) {
            headers["Authorization"] = `Bearer ${session}`;
        }

        const res = await fetch(`${WORKER_URL}/pending-prs?limit=${encodeURIComponent(limit)}`, {
            method: "GET",
            headers
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            throw new Error(data.error || `待审核 PR 列表读取失败: ${res.status}`);
        }

        return data;
    }

    function isHomePage() {
        return location.pathname === "/" || location.pathname === "";
    }

    function escapeHtml(text) {
        return String(text ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function formatPendingPrTime(ts) {
        if (!ts) return "-";

        try {
            const d = new Date(Number(ts) * 1000);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            const hh = String(d.getHours()).padStart(2, "0");
            const mi = String(d.getMinutes()).padStart(2, "0");
            return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
        } catch {
            return "-";
        }
    }

    function ensureHomePendingPrStyle() {
        if (document.getElementById("bgm-staff-home-pr-style")) return;

        const style = document.createElement("style");
        style.id = "bgm-staff-home-pr-style";
        style.textContent = `
#bgm-staff-home-pr-entry {
  display: inline-block;
  margin-left: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  vertical-align: 0px;
  line-height: 0;
  appearance: none;
  -webkit-appearance: none;
  box-shadow: none;
  font: inherit;
}

#bgm-staff-home-pr-entry::-moz-focus-inner {
  border: 0;
  padding: 0;
}

#bgm-staff-home-pr-entry:hover {
  opacity: 0.92;
}

#bgm-staff-home-pr-entry[hidden] {
  display: none !important;
}

#bgm-staff-home-pr-entry svg {
  display: block;
  width: auto;
  height: 20px;
}

.bgm-staff-home-pr-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(2px);
}

.bgm-staff-home-pr-modal {
  width: min(760px, 92vw);
  max-height: min(80vh, 720px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  background: #fff;
  color: #333;
  border: 1px solid #ddd;
  box-shadow: 0 10px 30px rgba(0,0,0,0.25);
}

html[data-theme="dark"] .bgm-staff-home-pr-modal {
  background: #222;
  color: #eee;
  border-color: #444;
}

.bgm-staff-home-pr-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
  font-size: 14px;
  font-weight: bold;
  color: #F09199;
}

html[data-theme="dark"] .bgm-staff-home-pr-modal-header {
  border-bottom-color: #444;
}

.bgm-staff-home-pr-close {
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 18px;
  cursor: pointer;
}

.bgm-staff-home-pr-list {
  overflow: auto;
  padding: 8px 12px 12px;
}

.bgm-staff-home-pr-item {
  padding: 10px 8px;
  border-bottom: 1px dashed #e5e5e5;
}

html[data-theme="dark"] .bgm-staff-home-pr-item {
  border-bottom-color: #444;
}

.bgm-staff-home-pr-item-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 4px;
  font-size: 13px;
}

.bgm-staff-home-pr-item-title .l {
  font-weight: bold;
}

.bgm-staff-home-pr-item-meta {
  font-size: 12px;
  color: #666;
  line-height: 1.6;
}

html[data-theme="dark"] .bgm-staff-home-pr-item-meta {
  color: #bbb;
}

.bgm-staff-home-pr-empty {
  padding: 24px 12px 28px;
  text-align: center;
  font-size: 13px;
  color: #888;
}
    `;
        document.head.appendChild(style);
    }

    function closeHomePendingPrModal() {
        const el = document.querySelector(".bgm-staff-home-pr-overlay");
        if (el) el.remove();
    }

    function openHomePendingPrModal(data) {
        closeHomePendingPrModal();
        ensureHomePendingPrStyle();

        const overlay = document.createElement("div");
        overlay.className = "bgm-staff-home-pr-overlay";

        const modal = document.createElement("div");
        modal.className = "bgm-staff-home-pr-modal";

        const total = Number(data?.total || 0);
        const items = Array.isArray(data?.items) ? data.items : [];

        modal.innerHTML = `
<div class="bgm-staff-home-pr-modal-header">
  <span>当前待审核 PR：${total}</span>
  <button type="button" class="bgm-staff-home-pr-close">✖</button>
</div>
<div class="bgm-staff-home-pr-list">
  ${items.length
                ? items.map(item => `
        <div class="bgm-staff-home-pr-item">
          <div class="bgm-staff-home-pr-item-title">
            <span>
              <a class="l" target="_blank" href="${escapeHtml(item.prUrl || "#")}">PR #${escapeHtml(item.prNumber)}</a>
              ·
              <a class="l" target="_blank" href="/subject/${escapeHtml(item.subjectId)}">subject ${escapeHtml(item.subjectId)}</a>
            </span>
            <span>${escapeHtml(formatPendingPrTime(item.updatedAt))}</span>
          </div>
          <div class="bgm-staff-home-pr-item-meta">
            ${item.submittedBy ? `提交者：${item.submittedByUserUrl ? `<a class="l" target="_blank" href="${escapeHtml(item.submittedByUserUrl)}">${escapeHtml(item.submittedBy)}</a>` : escapeHtml(item.submittedBy)}` : "提交者：-"}
            ${item.title ? `<br>标题：${escapeHtml(item.title)}` : ""}
          </div>
        </div>
      `).join("")
                : `<div class="bgm-staff-home-pr-empty">当前没有待审核 PR。</div>`
            }
</div>
`.trim();

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                closeHomePendingPrModal();
            }
        });

        modal.querySelector(".bgm-staff-home-pr-close")?.addEventListener("click", () => {
            closeHomePendingPrModal();
        });
    }

    function findHomePendingPrAnchor() {
        const username = String(window.CHOBITS_USERNAME || "").trim();
        const selectors = [];

        if (username) {
            selectors.push(
                `#header h1 a.l[href="/user/${CSS.escape(username)}"]`,
                `#header h1 a.l[href="https://bgm.tv/user/${CSS.escape(username)}"]`,
                `#header h1 a.l[href="https://bangumi.tv/user/${CSS.escape(username)}"]`,
                `#header h1 a.l[href="https://chii.in/user/${CSS.escape(username)}"]`,

                `#wrapperNeue #header h1 a.l[href="/user/${CSS.escape(username)}"]`,
                `#wrapperNeue #header h1 a.l[href="https://bgm.tv/user/${CSS.escape(username)}"]`,
                `#wrapperNeue #header h1 a.l[href="https://bangumi.tv/user/${CSS.escape(username)}"]`,
                `#wrapperNeue #header h1 a.l[href="https://chii.in/user/${CSS.escape(username)}"]`
            );
        }

        selectors.push(
            `#header h1 a.l[href*="/user/"]`,
            `#wrapperNeue #header h1 a.l[href*="/user/"]`,
            `#dock a[href*="/user/"]`
        );

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el) return el;
        }

        return null;
    }

    function renderHomePendingPrBadge(data) {
        const entry = document.getElementById("bgm-staff-home-pr-entry");
        if (!entry) return;

        const total = Math.max(0, Number(data?.total || 0));
        const badgeSvg = String(data?.badge?.svg || "").trim();

        if (total <= 0 || !badgeSvg) {
            entry.hidden = true;
            entry.innerHTML = "";
            return;
        }

        entry.hidden = false;
        entry.innerHTML = badgeSvg;
        entry.title = `当前 PR：${total}`;
    }

    async function installHomePendingPrWidget() {
        if (!isHomePage()) return;

        ensureHomePendingPrStyle();

        const anchor = findHomePendingPrAnchor();
        if (!anchor) {
            console.warn("[staff-patch] home pending PR anchor not found");
            return;
        }

        let entry = document.getElementById("bgm-staff-home-pr-entry");
        if (!entry) {
            entry = document.createElement("button");
            entry.type = "button";
            entry.id = "bgm-staff-home-pr-entry";
            anchor.insertAdjacentElement("afterend", entry);
        }

        const initialData = await fetchPendingPrList(100);
        renderHomePendingPrBadge(initialData);

        entry.onclick = async () => {
            try {
                await consumeSessionFromHash();

                const session = await ensureSessionMatchesCurrentBangumiUser();
                if (!session) {
                    saveAfterAuthAction({ type: "open-home-pr-list" });
                    startAuth();
                    return;
                }

                const me = await authMe().catch(() => ({ ok: false }));
                if (!me || !me.ok) {
                    saveAfterAuthAction({ type: "open-home-pr-list" });
                    startAuth();
                    return;
                }

                const latestData = await fetchPendingPrList(100);
                renderHomePendingPrBadge(latestData);

                if (!latestData.canOpen) {
                    saveAfterAuthAction({ type: "open-home-pr-list" });
                    startAuth();
                    return;
                }

                openHomePendingPrModal(latestData);
            } catch (err) {
                showTopNotice(
                    `待审核 PR 列表读取失败：${err instanceof Error ? err.message : String(err)}`,
                    { type: "error", autoHideMs: 3500 }
                );
            }
        };
    }
    // SVG Display END

    function buildSubmitSuccessHtml(result) {
        if (result?.supersededExistingPr) {
            if (result?.closedExistingPr && result?.previousPrUrl) {
                return `已接管维护并写入 main：旧 PR <a class="l" target="_blank" href="${result.previousPrUrl}">#${result.previousPrNumber || "查看"}</a> 已关闭，正在刷新页面...`;
            }

            if (result?.previousPrUrl) {
                return `已接管维护并写入 main：旧 PR <a class="l" target="_blank" href="${result.previousPrUrl}">#${result.previousPrNumber || "查看"}</a> 关闭失败，请稍后检查，正在刷新页面...`;
            }

            return "已接管维护并写入 main，正在刷新页面...";
        }

        if (result?.reviewedFromSubmit && result?.prUrl) {
            return `已更新并通过当前 PR：<a class="l" target="_blank" href="${result.prUrl}">#${result.prNumber || "查看"}</a>，正在刷新页面...`;
        }

        if (result?.updatedExistingPr && result?.prUrl) {
            return `已更新当前 PR：<a class="l" target="_blank" href="${result.prUrl}">#${result.prNumber || "查看"}</a>，正在刷新页面...`;
        }

        if (result?.mode === "pr" && result?.prUrl) {
            return `已提交 PR：<a class="l" target="_blank" href="${result.prUrl}">#${result.prNumber || "查看"}</a>，正在刷新页面...`;
        }

        return "已直接写入 main，正在刷新页面...";
    }

    async function openBestRepairModal(me, subjectId) {
        if (!subjectId) {
            openRepairModal(me);
            return;
        }

        try {
            const prStatus = await fetchPendingPrStatus(subjectId);

            if (prStatus && prStatus.ok && prStatus.hasOpenPr) {
                // 维基人：进入 PR 审核模式
                if (prStatus.viewerCanReview) {
                    try {
                        await openPrReviewModal(me, subjectId);
                        return;
                    } catch (err) {
                        console.warn("[staff-patch] openPrReviewModal denied/fallback:", err);
                    }
                }

                // 原提交者：进入“现有 PR 编辑模式”
                if (prStatus.viewerIsSubmitter || prStatus.viewerCanEditExistingPr) {
                    try {
                        await openExistingPrEditModal(me, subjectId);
                        return;
                    } catch (err) {
                        console.warn("[staff-patch] openExistingPrEditModal denied/fallback:", err);
                    }
                }
            }
        } catch (err) {
            console.warn("[staff-patch] openBestRepairModal fallback to normal modal:", err);
        }

        openRepairModal(me);
    }

    function handleAutoSubmitResultNotice(result, subjectId) {
        if (!result) return;

        if (result.supersededExistingPr) {
            if (result.closedExistingPr && result.previousPrUrl) {
                showTopNotice(
                    `此页面的信息已自动接管并写入 main，旧 PR：<a class="l" target="_blank" href="${result.previousPrUrl}">#${result.previousPrNumber || "查看"}</a> 已关闭。`,
                    { type: "success", html: true }
                );
                return;
            }

            if (result.previousPrUrl) {
                showTopNotice(
                    `此页面的信息已自动接管并写入 main，但旧 PR：<a class="l" target="_blank" href="${result.previousPrUrl}">#${result.previousPrNumber || "查看"}</a> 关闭失败，请稍后检查。`,
                    { type: "error", html: true }
                );
                return;
            }

            showTopNotice("此页面的信息已自动接管并写入 main。", { type: "success" });
            return;
        }

        if (result.reviewedFromSubmit && result.prUrl) {
            showTopNotice(
                `此页面的信息已自动更新并通过当前 PR：<a class="l" target="_blank" href="${result.prUrl}">#${result.prNumber || "查看"}</a>`,
                { type: "success", html: true }
            );
            return;
        }

        if (result.updatedExistingPr && result.prUrl) {
            showTopNotice(
                `此页面的信息已自动更新当前 PR：<a class="l" target="_blank" href="${result.prUrl}">#${result.prNumber || "查看"}</a>`,
                { type: "info", html: true }
            );
            return;
        }

        if (result.mode === "pr" && result.prUrl) {
            showTopNotice(
                `此页面的信息已自动提交为待审核 PR：<a class="l" target="_blank" href="${result.prUrl}">#${result.prNumber || "查看"}</a>`,
                { type: "info", html: true }
            );
            return;
        }

        showTopNotice("此页面的信息已自动同步到 main。", { type: "success" });
    }

    async function submitPrReview(subjectId, prNumber, content) {
        const session = await ensureSessionMatchesCurrentBangumiUser();
        if (!session) throw new Error("未授权");

        const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session}`
        };

        if (APP_SUBMIT_KEY) {
            headers["X-Submit-Key"] = APP_SUBMIT_KEY;
        }

        const res = await fetch(`${WORKER_URL}/pr-review-submit`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                subjectId: Number(subjectId),
                prNumber: Number(prNumber),
                content
            })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            throw new Error(data.error || `PR 审核提交失败: ${res.status}`);
        }

        return data;
    }

    async function submitPrReviewFast(subjectId, prNumber, content) {
        const session = await ensureSessionMatchesCurrentBangumiUser();
        if (!session) {
            return { ok: false, reason: "missing-session" };
        }

        const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session}`
        };

        if (APP_SUBMIT_KEY) {
            headers["X-Submit-Key"] = APP_SUBMIT_KEY;
        }

        try {
            const res = await fetch(`${WORKER_URL}/pr-review-submit-fast`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    subjectId: Number(subjectId),
                    prNumber: Number(prNumber),
                    content
                }),
                mode: "cors",
                credentials: "omit",
                cache: "no-store"
            });

            const data = await res.json().catch(() => ({}));

            if (res.ok && data.ok) {
                return { ok: true, data };
            }

            return {
                ok: false,
                status: res.status,
                reason: "submit-failed",
                data
            };
        } catch (err) {
            return {
                ok: false,
                reason: "fetch-failed",
                detail: err instanceof Error ? err.message : String(err)
            };
        }
    }

    async function submitPrReject(subjectId, prNumber, reason = "") {
        const session = await ensureSessionMatchesCurrentBangumiUser();
        if (!session) throw new Error("未授权");

        const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session}`
        };

        if (APP_SUBMIT_KEY) {
            headers["X-Submit-Key"] = APP_SUBMIT_KEY;
        }

        const res = await fetch(`${WORKER_URL}/pr-review-reject`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                subjectId: Number(subjectId),
                prNumber: Number(prNumber),
                reason: String(reason || "")
            })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
            throw new Error(data.error || `PR 拒绝失败: ${res.status}`);
        }

        return data;
    }

    function buildContentFromInputLoose(subjectId, inputText) {
        const parsed = parseEditorInput(inputText);

        // 空输入 = 清空当前修复信息
        if (parsed.mode === "empty") {
            return {
                parsed,
                fullPatchMap: {},
                content: {
                    trackCredits: {},
                    rawPatches: {
                        editor: ""
                    }
                }
            };
        }

        let fullPatchMap;

        if (parsed.mode === "trackCredits" || parsed.mode === "rawPatches") {
            fullPatchMap = buildPatchMapFromData(parsed.data);
        } else {
            const upgraded = patchMapToTrackCredits(parsed.patchMap, subjectId);
            fullPatchMap = buildPatchMapFromData(upgraded);
        }

        fullPatchMap = reconcilePatchMapWithBaseDisplay(fullPatchMap);

        const relatedRefRemovalApplied = applyRelatedRefRemovalsToPatchMap(fullPatchMap);

        const content = patchMapToTrackCredits(fullPatchMap, subjectId);

        const originalRawPatches =
            parsed.data && parsed.data.rawPatches && typeof parsed.data.rawPatches === "object"
                ? { ...parsed.data.rawPatches }
                : {};

        if (inputText.trim()) {
            originalRawPatches.editor = inputText.trim();
        } else {
            originalRawPatches.editor = "";
        }

        content.rawPatches = originalRawPatches;

        return {
            parsed,
            fullPatchMap,
            content,
            relatedRefRemovalApplied
        };
    }

    function buildSubmitContentFromInput(subjectId, inputText) {
        const built = buildContentFromInputLoose(subjectId, inputText);

        const diffPatchMap = diffPatchMapAgainstBaseDisplay(built.fullPatchMap);

        // 只「去除关联」、文本没变时同样允许提交
        if (!Object.keys(diffPatchMap).length && !built.relatedRefRemovalApplied) {
            throw new Error("输入内容与当前显示一致，没有需要提交的差异");
        }

        return {
            ...built,
            diffPatchMap
        };
    }

    function ensureStyle() {
        if (document.getElementById("staff-patch-style")) return;

        const style = document.createElement("style");
        style.id = "staff-patch-style";

        style.textContent = `
    #bgm-staff-fix-link {
      cursor: pointer;
      color: #F09199 !important;
    }

    #bgm-staff-fix-link:hover {
      color: #e07f88 !important;
    }

    /* 底子直接吃 bgm 自带的按钮规则（button.inputBtn：主色底、白字、50px 圆角、
       14px 字号、6px 18px 内边距），这里只补字体继承、间距与高度对齐。 */
    /* <button> 默认不继承页面字体（UA 给的是 Arial），字号虽然一样但行盒不同，
       会显得比旁边的 <input> 小一号；继承页面字体后两者才一致 */
    #bgm-staff-create-complete-btn {
      font-family: inherit;
      line-height: normal;
      margin-left: 16px;
    }

    /* 封面预览框：挂在「咏唱」输入框下面，宽度与咏唱框一致 */
    .bgm-staff-create-cover {
      box-sizing: border-box;
      width: 100%;
      max-width: 100%;
      margin-top: 16px;
      padding: 12px;
      border: 1px solid var(--bgm-border, rgba(127, 127, 127, 0.35));
      border-radius: 6px;
      text-align: center;
    }

    .bgm-staff-create-cover-title {
      margin-bottom: 10px;
      font-size: 12px;
      line-height: 1.6;
      color: var(--primary-color, #F09199);
    }

    .bgm-staff-create-cover img {
      display: block;
      width: 100%;
      height: auto;
      border-radius: 4px;
      background: rgba(127, 127, 127, 0.15);
    }

    .bgm-staff-create-cover-note {
      margin-top: 10px;
      font-size: 12px;
      line-height: 1.6;
      color: var(--text-gray, #aaa);
    }

    #bgm-staff-create-complete-btn:hover {
      filter: brightness(0.94);
    }

    #bgm-staff-create-complete-btn:active {
      filter: brightness(0.88);
    }

    #bgm-staff-create-complete-btn:disabled {
      filter: none;
      opacity: 0.6;
      cursor: progress;
    }

    #bgm-staff-create-complete-btn:focus-visible {
      outline: 2px solid var(--primary-color, #F09199);
      outline-offset: 2px;
    }

    /* 提示独立成行，放在按钮下面 */
    .bgm-staff-create-status {
      display: block;
      max-width: 40rem;
      margin-top: 6px;
      font-size: 12px;
      line-height: 1.6;
      color: var(--primary-color, #F09199);
    }

    .bgm-staff-create-status.is-error {
      color: #d9534f;
    }

    .bgm-staff-fix-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(2px);
    }

    .bgm-staff-fix-modal {
      width: min(1200px, 92vw);
      height: min(720px, 88vh);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-radius: 12px;
      background: #fff;
      color: #333;
      border: 1px solid #ddd;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    }

    html[data-theme="dark"] .bgm-staff-fix-modal {
      background: #222;
      color: #eee;
      border: 1px solid #444;
      box-shadow: 0 10px 30px rgba(0,0,0,0.45);
    }

    .bgm-staff-fix-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 20px;
      font-size: 14px;
      font-weight: bold;
      border-bottom: 1px solid #ddd;
      background: #f8f8f8;
      color: #F09199;
    }

    .bgm-staff-fix-header a {
      color: #666 !important;
      text-decoration: none;
      font-size: 18px;
    }

    .bgm-staff-fix-header a:hover {
      color: #F09199 !important;
    }

    html[data-theme="dark"] .bgm-staff-fix-header {
      background: #2a2a2a;
      border-bottom: 1px solid #444;
      color: #F09199;
    }

    html[data-theme="dark"] .bgm-staff-fix-header a {
      color: #bbb !important;
    }

    html[data-theme="dark"] .bgm-staff-fix-header a:hover {
      color: #F09199 !important;
    }

    .bgm-staff-fix-body {
      flex: 1;
      display: grid;
      grid-template-columns: 1fr 1fr;
      min-height: 0;
    }

    .bgm-staff-fix-pane {
      min-width: 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
      background: transparent;
    }

    .bgm-staff-fix-pane + .bgm-staff-fix-pane {
      border-left: 1px solid #eee;
    }

    html[data-theme="dark"] .bgm-staff-fix-pane + .bgm-staff-fix-pane {
      border-left: 1px solid #444;
    }

    .bgm-staff-fix-pane-title {
      padding: 8px 12px;
      font-size: 13px;
      color: #666;
      border-bottom: 1px solid #eee;
      background: #f4f4f4;
    }

    html[data-theme="dark"] .bgm-staff-fix-pane-title {
      color: #bbb;
      background: #2a2a2a;
      border-bottom: 1px solid #444;
    }

    .bgm-staff-fix-textarea {
      flex: 1;
      width: 100%;
      resize: none;
      border: 0;
      outline: none;
      padding: 12px;
      box-sizing: border-box;
      font: 12px/1.6 Consolas, Monaco, monospace;
      background: #fff;
      color: #333;
    }

    .bgm-staff-fix-textarea::placeholder {
      color: #999;
    }

    html[data-theme="dark"] .bgm-staff-fix-textarea {
      background: #333;
      color: #eee;
    }

    html[data-theme="dark"] .bgm-staff-fix-textarea::placeholder {
      color: #888;
    }

    .bgm-staff-fix-preview {
      flex: 1;
      overflow: auto;
      padding: 12px;
      box-sizing: border-box;
      font-size: 12px;
      line-height: 1.7;
      background: #fff;
      color: #333;
    }

    html[data-theme="dark"] .bgm-staff-fix-preview {
      background: #333;
      color: #eee;
    }

    .bgm-staff-fix-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 20px;
      border-top: 1px solid #ddd;
      background: #f8f8f8;
    }

    html[data-theme="dark"] .bgm-staff-fix-footer {
      background: #2a2a2a;
      border-top: 1px solid #444;
    }

    .bgm-staff-fix-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .bgm-staff-fix-actions button {
      background: #F09199;
      color: #fff;
      border: none;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-weight: bold;
      font-size: 12px;
      line-height: 1.2;
    }

    .bgm-staff-fix-actions button:hover {
      background: #e07f88;
    }

    html[data-theme="dark"] .bgm-staff-fix-actions button {
      background: #F09199;
      color: #fff;
      border: none;
    }

    html[data-theme="dark"] .bgm-staff-fix-actions button:hover {
      background: #e07f88;
    }

    .bgm-staff-fix-preview-track {
      margin-bottom: 14px;
      padding-bottom: 10px;
      border-bottom: 1px dashed #ddd;
    }

    html[data-theme="dark"] .bgm-staff-fix-preview-track {
      border-bottom: 1px dashed #555;
    }

    .bgm-staff-fix-preview-title {
      font-weight: bold;
      margin-bottom: 6px;
      color: #F09199;
    }

    html[data-theme="dark"] .bgm-staff-fix-preview-title {
      color: #F09199;
    }

    .bgm-staff-fix-preview-row {
      margin: 2px 0;
      white-space: normal;
      word-break: break-word;
      color: #555;
    }

        .bgm-staff-fix-pane-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .bgm-staff-fix-compare-toggle {
      border: 1px solid #ccc;
      background: #fff;
      color: #666;
      border-radius: 999px;
      padding: 2px 8px;
      cursor: pointer;
      font-size: 11px;
      line-height: 1.4;
      white-space: nowrap;
    }

    .bgm-staff-fix-compare-toggle:hover {
      border-color: #F09199;
      color: #F09199;
    }

    .bgm-staff-fix-compare-toggle.is-on {
      background: #F09199;
      border-color: #F09199;
      color: #fff;
    }

    html[data-theme="dark"] .bgm-staff-fix-compare-toggle {
      background: #333;
      color: #bbb;
      border-color: #555;
    }

    html[data-theme="dark"] .bgm-staff-fix-compare-toggle:hover {
      border-color: #F09199;
      color: #F09199;
    }

    html[data-theme="dark"] .bgm-staff-fix-compare-toggle.is-on {
      background: #F09199;
      border-color: #F09199;
      color: #fff;
    }

    .bgm-staff-fix-ref-toggle {
      cursor: pointer;
      border-bottom: 1px dashed #F09199;
    }

    .bgm-staff-fix-ref-toggle:hover {
      background: rgba(240, 145, 153, 0.18);
    }

    .bgm-staff-fix-ref-unlinked {
      color: #999;
      text-decoration: line-through;
      border-bottom: 1px dashed #bbb;
      cursor: pointer;
    }

    .bgm-staff-fix-ref-unlinked:hover {
      color: #F09199;
      border-bottom-color: #F09199;
    }

    html[data-theme="dark"] .bgm-staff-fix-ref-unlinked {
      color: #777;
      border-bottom-color: #555;
    }

    html[data-theme="dark"] .bgm-staff-fix-ref-unlinked:hover {
      color: #F09199;
      border-bottom-color: #F09199;
    }

    .bgm-staff-fix-preview-section {
      margin-top: 6px;
      padding: 6px 8px;
      border-radius: 6px;
      background: #fafafa;
    }

    html[data-theme="dark"] .bgm-staff-fix-preview-section {
      background: #2a2a2a;
    }

    .bgm-staff-fix-preview-section-title {
      font-size: 11px;
      font-weight: bold;
      color: #F09199;
      margin-bottom: 4px;
    }

    html[data-theme="dark"] .bgm-staff-fix-preview-row {
      color: #ddd;
    }

    .bgm-staff-fix-status {
      font-size: 12px;
      color: #F09199;
      min-width: 0;
      word-break: break-word;
    }

    html[data-theme="dark"] .bgm-staff-fix-status {
      color: #F09199;
    }

    .bgm-staff-fix-status a {
      color: #F09199 !important;
    }

    @media (max-width: 900px) {
      .bgm-staff-fix-modal {
        width: 96vw;
        height: 92vh;
      }

      .bgm-staff-fix-body {
        grid-template-columns: 1fr;
      }

      .bgm-staff-fix-pane + .bgm-staff-fix-pane {
        border-left: 0;
        border-top: 1px solid #eee;
      }

      html[data-theme="dark"] .bgm-staff-fix-pane + .bgm-staff-fix-pane {
        border-top: 1px solid #444;
      }
    }
  `;

        document.head.appendChild(style);
    }

    const INPUT_SPLITTERS = new Set(["、", "，", ",", "/", "／", "\\", "|", "｜", ";", "；"]);

    function stripOuterBookQuotes(text) {
        const s = (text || "").trim();
        const m = s.match(/^《\s*(.*?)\s*》$/);
        return m ? m[1] : s;
    }

    function splitOutsideParens(text) {
        const result = [];
        let buf = "";
        let parenDepth = 0;
        let quoteDepth = 0;
        let bracketDepth = 0;  // 新增

        for (const ch of text) {
            if (ch === "(" || ch === "（") parenDepth++;
            if (ch === ")" || ch === "）") parenDepth = Math.max(0, parenDepth - 1);
            if (ch === "《") quoteDepth++;
            if (ch === "》") quoteDepth = Math.max(0, quoteDepth - 1);
            if (ch === "[") bracketDepth++;
            if (ch === "]") bracketDepth = Math.max(0, bracketDepth - 1);

            if (parenDepth === 0 && quoteDepth === 0 && bracketDepth === 0 && INPUT_SPLITTERS.has(ch)) {
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
        if (!s.endsWith(")")) return null;

        let depth = 0;
        for (let i = s.length - 1; i >= 0; i--) {
            const ch = s[i];
            if (ch === ")") {
                depth++;
            } else if (ch === "(") {
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
                // 形如 1.2 / 1.2-4
                disc = Number(m[1]);
                start = Number(m[2]);
                end = m[3] ? Number(m[3]) : start;
            } else {
                // 形如 1 / 2-4
                // 默认按 Disc 1 处理
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

    function extractAliasLookupCandidates(name) {
        const raw = normalizeAliasKey(name);
        if (!raw) return [];

        const out = [];
        const seen = new Set();

        const push = (value) => {
            const key = normalizeAliasKey(value);
            if (!key || seen.has(key)) return;
            seen.add(key);
            out.push(key);
        };

        // 1. 原文整体
        push(raw);

        // 2. 半角括号：外层名 (内层别名)
        const half = raw.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
        if (half) {
            const outer = normalizeAliasKey(half[1]);
            const inner = normalizeAliasKey(half[2]);

            push(inner);
            push(outer);

            // 如果 inner 出现在 outer 里，也把 outer 去掉 inner 后的残余记进去
            if (outer && inner) {
                const idx = outer.indexOf(inner);
                if (idx >= 0) {
                    const remain = normalizeAliasKey(
                        outer.slice(0, idx) + outer.slice(idx + inner.length)
                    );
                    push(remain);
                }
            }
        }

        return out;
    }

    function isExplicitLiteralWrappedText(text) {
        const s = String(text || "").trim();
        return /^《\s*.*?\s*》$/.test(s);
    }

    function buildExplicitLiteralOuterWithLinkedInner(outerRaw, innerRaw, innerRef = null) {
        const outerText = stripOuterBookQuotes(String(outerRaw || "").trim());
        const parsedInner = parseNameWithOptionalRef(String(innerRaw || "").trim());

        let finalRef = innerRef || parsedInner.ref || null;
        let finalInnerText = stripOuterBookQuotes(parsedInner.text || "");

        if (!finalRef) {
            const exactPerson = findExactImportedPersonByText(finalInnerText);
            if (exactPerson) {
                finalRef = `p:${exactPerson.id}`;
                finalInnerText = finalInnerText || exactPerson.canonical || "";
            }
        }

        // 内层名字本身就出现在外层显示名里（例如 《Masahiro "Godspeed" Aoki》 (Godspeed)）：
        // 外层仍是纯文本，但把出现的那一段嵌成人物节点，保留“部分同名嵌入链接”的特性
        const idx = finalInnerText ? outerText.indexOf(finalInnerText) : -1;
        if (idx >= 0) {
            const prefix = outerText.slice(0, idx);
            const suffix = outerText.slice(idx + finalInnerText.length);

            const segs = [];
            if (prefix) segs.push(makeTextSeg(prefix));
            segs.push(makeEntitySeg(finalInnerText, finalRef));
            if (suffix) segs.push(makeTextSeg(suffix));

            return makeItem(segs);
        }

        return makeItem([
            makeTextSeg(outerText),
            makeTextSeg(" ("),
            makeEntitySeg(finalInnerText, finalRef),
            makeTextSeg(")")
        ]);
    }

    function findExactImportedPersonByText(text) {
        const raw = stripOuterBookQuotes(String(text || "").trim());
        if (!raw) return null;

        const exact = getAliasCandidates(raw);
        if (exact.length === 1) return exact[0];

        return null;
    }

    function maybeBuildCanonicalEmbeddedDisplay(text) {
        const raw = stripOuterBookQuotes(String(text || "").trim());
        if (!raw) return null;

        // 带括号补充的信息，统一交给 tryParseEmbeddedParenItem 处理
        if (/[()（）]/.test(raw)) return null;

        const person = findExactImportedPersonByText(raw);
        if (!person) return null;

        const canonical = stripOuterBookQuotes(String(person.canonical || "").trim());
        if (!canonical || canonical === raw) return null;

        // 这一类嵌入式显示只对非拉丁串开放，避免 Xi / XIO / IXIA 误伤
        if (/[A-Za-z0-9]/.test(raw) || /[A-Za-z0-9]/.test(canonical)) {
            return null;
        }

        const idx = raw.indexOf(canonical);
        if (idx < 0) return null;

        // canonical 只能出现一次，且必须是前缀或后缀的一部分
        if (raw.indexOf(canonical, idx + canonical.length) !== -1) return null;

        const prefix = raw.slice(0, idx);
        const suffix = raw.slice(idx + canonical.length);

        if (!prefix && !suffix) return null;

        return makeItem([
            ...(prefix ? [makeTextSeg(prefix)] : []),
            makeEntitySeg(canonical, `p:${person.id}`),
            ...(suffix ? [makeTextSeg(suffix)] : [])
        ]);
    }

    function tryParseEmbeddedParenItem(text) {
        const raw = (text || "").trim();
        if (!raw) return null;

        // 只支持半角括号
        const m = raw.match(/^(.*?)\s*\(([^(){}]+)(?:\{(p:\d+|n:[^}]+)\})?\)\s*$/);
        if (!m) return null;

        const outerRaw = m[1].trim();
        const innerText = m[2].trim();
        const innerRef = m[3] || null;

        if (!outerRaw || !innerText) return null;

        // 1) 显式纯文本语法优先：
        // 《Asatsumei、Asayami、Mei Naganowa》(ReeK)
        if (isExplicitLiteralWrappedText(outerRaw)) {
            return buildExplicitLiteralOuterWithLinkedInner(outerRaw, innerText, innerRef);
        }

        const outerText = stripOuterBookQuotes(outerRaw);
        if (!outerText) return null;

        // 2) 如果括号内文字本身就出现在外层显示名里，仍按“显示组件风格”拆成混合片段
        // 例如：劇団庭師 -> 劇団 + 庭師
        const idx = outerText.indexOf(innerText);
        if (idx >= 0) {
            const prefix = outerText.slice(0, idx);
            const suffix = outerText.slice(idx + innerText.length);

            const segs = [];
            if (prefix) segs.push(makeTextSeg(prefix));
            segs.push(makeEntitySeg(innerText, innerRef || null));
            if (suffix) segs.push(makeTextSeg(suffix));

            return makeItem(segs);
        }

        // 3) 显式 innerRef：直接按 alias_person
        if (innerRef) {
            return makeItem([
                makeEntitySeg(outerText, null, true),
                makeTextSeg(" ("),
                makeEntitySeg(innerText, innerRef),
                makeTextSeg(")")
            ]);
        }

        // 4) 不再因为数据库能唯一命中 inner，就自动升成 alias_person。
        //    这会导致像 Animalost (Kusua) 这类“括号只是补充显示”的写法，
        //    在将来 inner 有了人物页后被自动翻转主关联位。

        // 5) 默认按“中性括号结构”处理：
        //    outer 和 inner 都保留为独立节点，后续由 writer / 关联页逻辑决定谁持有 ref
        return makeItem([
            makeEntitySeg(outerText, null),
            makeTextSeg(" ("),
            makeEntitySeg(innerText, null),
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

    function normalizeSingleInputRoleLabel(label) {
        const raw = (label || "").trim();
        if (!raw) return null;

        const normalized = raw.normalize("NFKC");
        const lower = normalized.toLocaleLowerCase();

        /* ---------X-子角色 前缀职位--------- */
        // 乐器-Guitar / 设计-Web … 归到对应的基础职位
        const prefixed = splitPrefixedRoleLabel(normalized);
        if (prefixed) {
            const baseRoles = LABEL_TO_ROLES[prefixed.base];
            if (baseRoles && baseRoles.length === 1) return baseRoles[0];
        }
        /* ---------X-子角色 前缀职位--------- */

        /* ---------自定义职位--------- */
        const customMatch = normalized.match(/^custom\s*[-]\s*(.+)$/i);
        if (customMatch) {
            const customLabel = customMatch[1].trim();
            return customLabel ? `custom-${customLabel}` : null;
        }
        /* ---------自定义职位--------- */

        if (INPUT_LABEL_ALIASES[normalized]) return INPUT_LABEL_ALIASES[normalized];
        if (INPUT_LABEL_ALIASES[lower]) return INPUT_LABEL_ALIASES[lower];

        return null;
    }

    function parseInputRoleLabels(left) {
        const raw = (left || "").trim();
        if (!raw) return [];

        const normalized = raw.normalize("NFKC").trim();

        /* ---------自定义职位--------- */
        const directCustom = normalizeSingleInputRoleLabel(normalized);
        if (directCustom && /^custom-/i.test(directCustom)) {
            return [directCustom];
        }
        /* ---------自定义职位--------- */

        if (COMPOSITE_LABEL_ALIASES[normalized]) {
            return [...new Set(COMPOSITE_LABEL_ALIASES[normalized])];
        }

        // 2) 去掉常见中文连接符后再命中一次
        // 例如：
        // 作词、作曲、编曲 -> 作词作曲编曲
        // 作词・作曲 -> 作词作曲
        const compact = normalized.replace(/[、・&＆+＋/／|｜,，;；\s]+/g, "");
        if (COMPOSITE_LABEL_ALIASES[compact]) {
            return [...new Set(COMPOSITE_LABEL_ALIASES[compact])];
        }

        // 3) 支持多标签拆分
        const parts = normalized
            .split(/[、，,\/／|｜;；&＆+＋]+/)
            .map(s => s.trim())
            .filter(Boolean);

        if (parts.length > 1) {
            const roles = parts
                .map(part => normalizeSingleInputRoleLabel(part))
                .filter(Boolean);

            return [...new Set(roles)];
        }

        // 4) 普通单标签
        const single = normalizeSingleInputRoleLabel(normalized);
        return single ? [single] : [];
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

            const cvAliasEmbedded = tryParseCvAliasParenItem(unit);
            if (cvAliasEmbedded) {
                return cvAliasEmbedded.segments.slice();
            }

            const localCvMatch = unit.match(
                /^(.*?\((?:cv)(?:[:：.])\s*)([^(){}]+)(?:\{(p:\d+|n:[^}]+)\})?(\))$/i
            );
            if (localCvMatch) {
                return [
                    makeTextSeg(localCvMatch[1]),
                    makeEntitySeg(localCvMatch[2].trim(), localCvMatch[3] || null),
                    makeTextSeg(localCvMatch[4])
                ];
            }

            const embedded = tryParseEmbeddedParenItem(unit);
            if (embedded) {
                return embedded.segments.slice();
            }

            // 显式纯文本：《名字》固定为文本，不参与人物解析
            if (isExplicitLiteralWrappedText(unit)) {
                return [makeTextSeg(stripOuterBookQuotes(unit))];
            }

            const parsed = parseNameWithOptionalRef(unit);
            if (!parsed.text) return null;

            return [makeEntitySeg(stripOuterBookQuotes(parsed.text), parsed.ref)];
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

    function parseCvPrefixText(text) {
        const s = String(text || "");
        const m = s.match(/^(.*)\((cv)([:：.])\s*$/i);
        if (!m) return null;

        return {
            character: m[1] || "",
            rawPrefix: `${m[1]}(${m[2]}${m[3]}`
        };
    }

    function tryParseCvAliasParenItem(text) {
        const raw = normalizeQuotedAliasParenText(text);
        if (!raw) return null;

        // 形如：
        // 角色(CV.别名 (本名))
        // 角色(CV:别名 (本名))
        // 角色(CV：别名 (本名))
        const m = raw.match(
            /^(.*?\((?:cv)(?:[:：.])\s*)([^(){}]+?)\s*\(([^(){}]+?)(?:\{(p:\d+|n:[^}]+)\})?(\)+)\s*$/i
        );
        if (!m) return null;

        const prefix = m[1] || "";
        const aliasText = (m[2] || "").trim();
        const personTextRaw = (m[3] || "").trim();
        const explicitRef = m[4] || null;
        const closeText = m[5] || "))";

        if (!prefix || !aliasText || !personTextRaw) return null;

        let finalPersonRef = explicitRef;
        const finalPersonText = personTextRaw;

        // 没显式 ref 时，尽量把括号里的真实名先解析到 ref
        if (!finalPersonRef) {
            const exactPerson = findExactImportedPersonByText(personTextRaw);
            if (exactPerson) {
                finalPersonRef = `p:${exactPerson.id}`;
            }
        }

        return makeItem([
            makeTextSeg(prefix),
            makeEntitySeg(aliasText, null),
            makeTextSeg(" ("),
            makeEntitySeg(finalPersonText, finalPersonRef),
            makeTextSeg(closeText)
        ]);
    }

    function normalizeQuotedAliasParenText(text) {
        // 现在《...》是人物修复里的显式“纯文本”语法，不再提前压平
        return String(text || "").trim();
    }

    /**
    * 尝试解析《团体名》 [条目1、条目2、...] 格式
    * 返回 item 或 null
     */
    function tryParseBracketGroup(text) {
        const raw = String(text || "").trim();
        if (!raw) return null;

        // 1. 提取《》团体名（如有）
        const bracketMatch = raw.match(/^《([^》]+)》\s*(.*)/);
        let groupName = null;
        let rest = raw;

        if (bracketMatch) {
            groupName = bracketMatch[1].trim();
            rest = bracketMatch[2].trim();
        }

        // 2. 查找 [ ... ] 区块
        const firstBracket = rest.indexOf('[');
        const lastBracket = rest.lastIndexOf(']');
        if (firstBracket === -1 || lastBracket === -1 || firstBracket >= lastBracket) {
            return null;
        }

        // 检查 ] 后是否只有空白（包括零宽字符）
        const after = rest.slice(lastBracket + 1);
        // 移除所有空白字符（包括零宽空格、换行等）
        const afterClean = after.replace(/[\s\u200B-\u200D\uFEFF]/g, '');
        if (afterClean.length > 0) {
            return null;
        }

        // 提取 [ 前的内容（作为可能的团体名）
        const before = rest.slice(0, firstBracket).trim();

        // 3. 如果未通过书名号指定团体名，且 before 非空，则使用 before 作为团体名
        if (!groupName && before) {
            groupName = before;
        }

        // 提取内部内容
        const inner = rest.slice(firstBracket + 1, lastBracket).trim();
        if (!inner) return null;

        // 4. 分割 inner
        let items = splitOutsideParens(inner).map(s => s.trim()).filter(Boolean);

        // 如果分割结果为空，尝试手动分割（兼容不可见字符）
        if (items.length === 0) {
            items = inner.split(/[、，,]/).map(s => s.trim()).filter(Boolean);
        }

        if (items.length === 0) return null;

        // 5. 解析团体名（作为 entity）
        let groupSegments = [];
        if (groupName) {
            const groupItem = parsePatchDisplayItem(groupName);
            if (groupItem && groupItem.segments && groupItem.segments.length) {
                groupSegments = groupItem.segments;
            } else {
                groupSegments = [{ kind: "text", text: groupName }];
            }
        }

        // 6. 解析每个条目
        const parsedItems = items.map(itemText => {
            const item = parsePatchDisplayItem(itemText);
            if (item && item.segments && item.segments.length) {
                return item;
            }
            return { segments: [{ kind: "text", text: itemText }] };
        });

        // 7. 组装最终 segments
        const segs = [];
        if (groupSegments.length) {
            segs.push(...groupSegments);
        }
        segs.push({ kind: "text", text: " [" });
        for (let i = 0; i < parsedItems.length; i++) {
            segs.push(...parsedItems[i].segments);
            if (i < parsedItems.length - 1) {
                segs.push({ kind: "text", text: "、" });
            }
        }
        segs.push({ kind: "text", text: "]" });

        return { segments: segs };
    }

    /**
     * 尝试解析 团体名 (成员1 + 成员2) 或 团体名 [成员1 + 成员2] 格式
     * 其中 + 可以是 ARTIST_JOINERS 中的任意连接词
     * 也支持列表格式：团体名 (成员1、成员2) 或 团体名 (成员1, 成员2) 等，输出统一为顿号
     * 返回 item 或 null
     */
    function tryParseGroupWithMembers(text) {
        const raw = String(text || "").trim();
        if (!raw) return null;

        // 辅助：查找最外层的括号
        function findOuterBracket(str, openChar, closeChar) {
            let start = str.indexOf(openChar);
            if (start === -1) return null;
            let depth = 0;
            for (let i = start; i < str.length; i++) {
                if (str[i] === openChar) depth++;
                else if (str[i] === closeChar) {
                    depth--;
                    if (depth === 0) {
                        return {
                            group: str.slice(0, start).trim(),
                            inner: str.slice(start + 1, i).trim(),
                            bracketType: openChar
                        };
                    }
                }
            }
            return null;
        }

        // 尝试匹配圆括号和方括号
        let bracketInfo = findOuterBracket(raw, '(', ')') || findOuterBracket(raw, '[', ']');
        if (!bracketInfo) return null;

        const { group, inner, bracketType } = bracketInfo;

        // 构建连接词正则（忽略大小写）
        const joinersPattern = ARTIST_JOINERS
            .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|');
        const joinersRegex = new RegExp(`\\s*(?:${joinersPattern})\\s*`, 'i');

        // 尝试按连接词拆分
        let parts = [];
        let useListSeparator = false;
        let foundJoiner = false;
        let lastIndex = 0;
        let currentMatch;
        const re = new RegExp(joinersPattern, 'gi');
        while ((currentMatch = re.exec(inner)) !== null) {
            foundJoiner = true;
            const textBefore = inner.slice(lastIndex, currentMatch.index).trim();
            if (textBefore) parts.push({ type: 'text', value: textBefore });
            parts.push({ type: 'sep', value: currentMatch[0] });
            lastIndex = re.lastIndex;
        }
        if (foundJoiner) {
            const textAfter = inner.slice(lastIndex).trim();
            if (textAfter) parts.push({ type: 'text', value: textAfter });
        } else {
            // 没有连接词，尝试按顿号逗号拆分（使用 splitOutsideParens 忽略括号内）
            const splitted = splitOutsideParens(inner);
            if (splitted.length > 1) {
                useListSeparator = true;
                parts = splitted.map(s => ({ type: 'text', value: s.trim() }));
            } else {
                // 只有一个成员，不是我们处理的结构
                return null;
            }
        }

        const textSegments = parts.filter(p => p.type === 'text');
        if (textSegments.length === 0) return null;

        // 解析团体名
        let groupSegments = [];
        if (group) {
            const groupItem = parsePatchDisplayItem(group);
            if (groupItem && groupItem.segments && groupItem.segments.length) {
                groupSegments = groupItem.segments;
            } else {
                groupSegments = [{ kind: "text", text: group }];
            }
        }

        // 解析每个成员（文本段）
        const memberItems = textSegments.map(seg => {
            const item = parsePatchDisplayItem(seg.value);
            if (item && item.segments && item.segments.length) {
                return item;
            }
            return { segments: [{ kind: "text", text: seg.value }] };
        });

        // 组装最终 segments
        const segs = [];
        if (groupSegments.length) {
            segs.push(...groupSegments);
        }
        // 添加开括号
        segs.push({ kind: "text", text: bracketType === '(' ? " (" : " [" });

        if (useListSeparator) {
            // 列表模式：用顿号连接所有成员
            for (let i = 0; i < memberItems.length; i++) {
                segs.push(...memberItems[i].segments);
                if (i < memberItems.length - 1) {
                    segs.push({ kind: "text", text: "、" });
                }
            }
        } else {
            // 连接词模式：交替添加成员和分隔符
            let memberIndex = 0;
            for (const part of parts) {
                if (part.type === 'text') {
                    const item = memberItems[memberIndex++];
                    if (item) {
                        segs.push(...item.segments);
                    }
                } else if (part.type === 'sep') {
                    const sepText = part.value.trim();
                    if (sepText) {
                        segs.push({ kind: "text", text: ` ${sepText} ` });
                    }
                }
            }
        }

        // 添加闭括号
        segs.push({ kind: "text", text: bracketType === '(' ? ")" : "]" });

        return { segments: segs };
    }

    function parsePatchDisplayItem(text) {
        const normalizedText = normalizeQuotedAliasParenText(text);

        // 《》和 [] 格式优先匹配
        const bracketGroup = tryParseBracketGroup(text);
        if (bracketGroup) return bracketGroup;

        // 团体 (成员1 + 成员2) 或 [成员1 + 成员2] 格式
        const groupWithMembers = tryParseGroupWithMembers(text);
        if (groupWithMembers) return groupWithMembers;

        const joinedArtist = tryParseJoinedArtistItem(normalizedText);
        if (joinedArtist) {
            return joinedArtist;
        }

        const cvAliasEmbedded = tryParseCvAliasParenItem(normalizedText);
        if (cvAliasEmbedded) {
            return cvAliasEmbedded;
        }

        const cvMatch = normalizedText.match(
            /^(.*?\((?:cv)(?:[:：.])\s*)([^(){}]+)(?:\{(p:\d+|n:[^}]+)\})?(\))$/i
        );
        if (cvMatch) {
            return makeItem([
                makeTextSeg(cvMatch[1]),
                makeEntitySeg(cvMatch[2].trim(), cvMatch[3] || null),
                makeTextSeg(cvMatch[4])
            ]);
        }

        const embedded = tryParseEmbeddedParenItem(normalizedText);
        if (embedded) {
            return embedded;
        }

        // 显式纯文本：整段《...》包裹时固定为文本，不做人物解析/关联
        if (isExplicitLiteralWrappedText(normalizedText)) {
            return makeItem([
                makeTextSeg(stripOuterBookQuotes(normalizedText))
            ]);
        }

        const aliasEmbedded = maybeBuildCanonicalEmbeddedDisplay(normalizedText);
        if (aliasEmbedded) {
            return aliasEmbedded;
        }

        const parsed = parseNameWithOptionalRef(normalizedText);
        return makeItem([
            makeEntitySeg(stripOuterBookQuotes(parsed.text), parsed.ref)
        ]);
    }

    // `X-子角色` 的子角色按乐器的 `(Guitar)` 写法标注在末尾，
    // 并打上 subRole 标记，方便回写编辑区时还原 `X-子角色：…`。
    function parsePatchSubRoleItem(name, subRole) {
        const embedded = tryParseEmbeddedParenItem(name);
        if (embedded) {
            embedded.segments.push(makeTextSeg(` (${subRole})`));
            embedded.subRole = subRole;
            return embedded;
        }

        // 显式纯文本：《乐器名字》固定为文本
        if (isExplicitLiteralWrappedText(name)) {
            const item = makeItem([
                makeTextSeg(stripOuterBookQuotes(name)),
                makeTextSeg(` (${subRole})`)
            ]);
            item.subRole = subRole;
            return item;
        }

        const parsed = parseNameWithOptionalRef(name);
        const item = makeItem([
            makeEntitySeg(stripOuterBookQuotes(parsed.text), parsed.ref),
            makeTextSeg(` (${subRole})`)
        ]);
        item.subRole = subRole;
        return item;
    }

    function parsePatchInstrumentItem(name, inst) {
        return parsePatchSubRoleItem(name, inst);
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

        // 旧 schema: { parts: [...] }
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

        // 新 schema: { type: "person", person: {...} }
        if (value.type === "person" && value.person) {
            const ref = value.person.ref || null;
            const text = resolvePersonText(ref, value.person.text || null, people);
            return makeItem([makeEntitySeg(text, ref)]);
        }

        // 新 schema: { type: "alias_person", alias: {...}, person: {...} }
        if (value.type === "alias_person") {
            const segs = [];
            if (value.alias) {
                const aliasRef = value.alias.ref || null;
                const aliasText = resolvePersonText(aliasRef, value.alias.text || null, people);
                segs.push(makeEntitySeg(aliasText, aliasRef, true));
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

        // 新 schema: { type: "cv_credit", character: "...", cv: {...} }
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
                makeEntitySeg(aliasText, aliasRef, true),
                makeTextSeg(" ("),
                makeEntitySeg(personText, personRef),
                makeTextSeg(`) (${value.inst || ""})`)
            ]);
        }

        // 新 schema / 旧 schema 乐器
        if (value.type === "instrument_credit" || value.inst) {
            const ref = value.person?.ref || value.ref || null;
            const text = resolvePersonText(ref, value.person?.text || value.text || null, people);
            return makeItem([
                makeEntitySeg(text, ref),
                makeTextSeg(` (${value.inst || ""})`)
            ]);
        }

        // 新 schema: { type: "text", text: "..." }
        if (value.type === "text") {
            return makeItem([makeEntitySeg(value.text || "", null)]);
        }

        // 兜底：{ ref, text }
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
            if (roleKey === "instrument") {
                const flattened = [];
                for (const [instName, arr] of Object.entries(rawValue)) {
                    if (Array.isArray(arr)) {
                        for (const item of arr) {
                            if (isRenderableCreditObject(item)) {
                                flattened.push(normalizeLegacyValueToItem({ ...item, inst: item.inst || instName }, roleKey, people));
                            } else if (typeof item === "string") {
                                flattened.push(
                                    normalizeLegacyValueToItem(
                                        {
                                            type: "instrument_credit",
                                            person: { ref: /^p:/.test(item) ? item : null, text: /^p:/.test(item) ? null : item },
                                            inst: instName
                                        },
                                        roleKey,
                                        people
                                    )
                                );
                            }
                        }
                    } else if (isRenderableCreditObject(arr)) {
                        flattened.push(normalizeLegacyValueToItem({ ...arr, inst: arr.inst || instName }, roleKey, people));
                    } else if (typeof arr === "string") {
                        flattened.push(
                            normalizeLegacyValueToItem(
                                {
                                    type: "instrument_credit",
                                    person: { ref: /^p:/.test(arr) ? arr : null, text: /^p:/.test(arr) ? null : arr },
                                    inst: instName
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

    function buildPatchMapFromData(data, preferEditor = true) {
        if (!data) return {};

        /* ---------优先 rawPatches.editor--------- */
        // 人员修复输入区的原始文本才能表达 `X-子角色`（乐器-Guitar、设计-Web …），
        // 结构化 trackCredits / epinfo 只作回退。
        // 例外：工具端 patch_content 属结构化直传（preferEditor=false），
        // 它的结构本身即完整信息，走下面的结构化分支，不再解析 editor 文本。
        if (preferEditor && data.rawPatches) {
            const parsedRaw = parseRawPatches(data.rawPatches);
            if (Object.keys(parsedRaw).length) return parsedRaw;
        }
        /* ---------优先 rawPatches.editor--------- */

        const patchMap = {};

        if (data.trackCredits || data.epinfo) {
            for (const [trackKey, roleMap] of Object.entries(data.trackCredits || {})) {
                const nextRoleMap = {};

                for (const [roleKey, items] of Object.entries(roleMap || {})) {
                    if (!Array.isArray(items) || !items.length) continue;
                    nextRoleMap[roleKey] = items.map(normalizeLegacyValueToItem);
                }

                if (Object.keys(nextRoleMap).length) {
                    patchMap[trackKey] = nextRoleMap;
                }
            }

            const epinfoRoleMap = {};
            for (const [roleKey, items] of Object.entries(data.epinfo || {})) {
                if (!Array.isArray(items) || !items.length) continue;
                epinfoRoleMap[roleKey] = items.map(normalizeLegacyValueToItem);
            }

            if (Object.keys(epinfoRoleMap).length) {
                patchMap[EPINFO_TRACK_KEY] = epinfoRoleMap;
            }

            return patchMap;
        }

        if (data.rawPatches) {
            return parseRawPatches(data.rawPatches);
        }

        return {};
    }

    function parseEditorInput(text) {
        const trimmed = text.trim();
        if (!trimmed) {
            return { mode: "empty", patchMap: {}, data: null };
        }

        // 优先尝试 JSON
        try {
            const parsed = JSON.parse(trimmed);

            if (parsed && typeof parsed === "object") {
                /* ---------优先 rawPatches.editor--------- */
                if (parsed.rawPatches) {
                    const parsedRaw = parseRawPatches(parsed.rawPatches);
                    if (Object.keys(parsedRaw).length) {
                        return {
                            mode: "rawPatches",
                            data: parsed,
                            patchMap: parsedRaw
                        };
                    }
                }
                /* ---------优先 rawPatches.editor--------- */

                if (parsed.trackCredits) {
                    return {
                        mode: "trackCredits",
                        data: parsed,
                        patchMap: normalizeTrackCreditsToPatchMap(parsed.trackCredits, parsed.people || {})
                    };
                }
            }
        } catch (_) { }

        // 回退到旧 raw text
        return {
            mode: "rawText",
            data: {
                subjectId: Number(getSubjectId()),
                rawPatches: { editor: trimmed }
            },
            patchMap: parseRawPatches({ editor: trimmed })
        };
    }

    function rebuildEditorTextFromTrackCredits(data) {
        if (!data?.trackCredits) return "";

        const patchMap = normalizeTrackCreditsToPatchMap(
            data.trackCredits || {},
            data.people || {}
        );

        return serializePatchMapToEditorText(patchMap);
    }

    const EDITOR_ROLE_OUTPUT_ORDER = [
        "artist",
        "lyricist",
        "composer",
        "arranger",
        "label",
        "chorus",
        "recording",
        "mixing",
        "mastering",
        "instrument"
    ];

    function itemSegmentsToPlainText(item) {
        return (item?.segments || []).map(seg => seg?.text || "").join("").trim();
    }

    function splitInstrumentEditorItemText(text) {
        const s = String(text || "").trim();
        const m = s.match(/^(.*)\s+\(([^()]+)\)$/);
        if (!m) return null;

        const name = m[1].trim();
        const inst = m[2].trim();
        if (!name || !inst) return null;

        return { name, inst };
    }

    function addEditorBucketEntry(bucket, roleLabel, name, trackKey) {
        if (!roleLabel || !name || !trackKey) return;
        if (!bucket.has(roleLabel)) bucket.set(roleLabel, new Map());

        const nameMap = bucket.get(roleLabel);
        if (!nameMap.has(name)) nameMap.set(name, new Set());
        nameMap.get(name).add(trackKey);
    }

    function formatEditorTrackList(trackKeys) {
        const parsed = Array.from(new Set(trackKeys))
            .map(key => {
                const m = String(key).match(/^(\d+)\.(\d+)$/);
                if (!m) return null;
                return { disc: Number(m[1]), track: Number(m[2]) };
            })
            .filter(Boolean)
            .sort((a, b) => a.disc - b.disc || a.track - b.track);

        if (!parsed.length) return "";

        const parts = [];
        let i = 0;

        while (i < parsed.length) {
            const start = parsed[i];
            let end = start;
            let j = i + 1;

            while (
                j < parsed.length &&
                parsed[j].disc === end.disc &&
                parsed[j].track === end.track + 1
            ) {
                end = parsed[j];
                j++;
            }

            if (start.track === end.track) {
                parts.push(`${start.disc}.${start.track}`);
            } else {
                parts.push(`${start.disc}.${start.track}-${end.track}`);
            }

            i = j;
        }

        return parts.join(",");
    }

    function serializePatchMapToEditorText(patchMap) {
        const epinfoRoleMap = patchMap?.[EPINFO_TRACK_KEY] || {};
        const trackOnlyPatchMap = { ...(patchMap || {}) };
        delete trackOnlyPatchMap[EPINFO_TRACK_KEY];

        function itemSegmentsToText(item) {
            return (item?.segments || []).map(seg => seg?.text || "").join("").trim();
        }

        function splitInstrumentEditorItemText(text) {
            const s = String(text || "").trim();
            const m = s.match(/^(.*)\s+\(([^()]+)\)$/);
            if (!m) return null;

            const name = m[1].trim();
            const inst = m[2].trim();
            if (!name || !inst) return null;

            return { name, inst };
        }

        function addEditorBucketEntry(bucket, roleLabel, name, trackKey = null) {
            if (!roleLabel || !name) return;
            if (!bucket.has(roleLabel)) bucket.set(roleLabel, new Map());

            const nameMap = bucket.get(roleLabel);
            if (!nameMap.has(name)) nameMap.set(name, new Set());

            if (trackKey) {
                nameMap.get(name).add(trackKey);
            }
        }

        function formatEditorTrackList(trackKeys) {
            const parsed = Array.from(new Set(trackKeys))
                .map(key => {
                    const m = String(key).match(/^(\d+)\.(\d+)$/);
                    if (!m) return null;
                    return { disc: Number(m[1]), track: Number(m[2]) };
                })
                .filter(Boolean)
                .sort((a, b) => a.disc - b.disc || a.track - b.track);

            if (!parsed.length) return "";

            const parts = [];
            let i = 0;

            while (i < parsed.length) {
                const start = parsed[i];
                let end = start;
                let j = i + 1;

                while (
                    j < parsed.length &&
                    parsed[j].disc === end.disc &&
                    parsed[j].track === end.track + 1
                ) {
                    end = parsed[j];
                    j++;
                }

                if (start.track === end.track) {
                    parts.push(`${start.disc}.${start.track}`);
                } else {
                    parts.push(`${start.disc}.${start.track}-${end.track}`);
                }

                i = j;
            }

            return parts.join(",");
        }

        const epinfoBucket = new Map();
        const trackBucket = new Map();

        // 先收 epinfo（不带 trackKey）
        for (const roleKey of EDITOR_ROLE_OUTPUT_ORDER) {
            const items = epinfoRoleMap?.[roleKey];
            if (!Array.isArray(items) || !items.length) continue;

            for (const item of items) {
                const text = itemSegmentsToText(item);
                if (!text) continue;

                const resolved = resolveSubRoleEditorLabel(roleKey, item, text);
                addEditorBucketEntry(epinfoBucket, resolved.label, resolved.text, null);
            }
        }

        for (const [roleKey, items] of Object.entries(epinfoRoleMap || {})) {
            if (EDITOR_ROLE_OUTPUT_ORDER.includes(roleKey)) continue;
            if (!Array.isArray(items) || !items.length) continue;

            for (const item of items) {
                const text = itemSegmentsToText(item);
                if (!text) continue;

                const resolved = resolveSubRoleEditorLabel(roleKey, item, text);
                addEditorBucketEntry(epinfoBucket, resolved.label, resolved.text, null);
            }
        }

        // 再收 trackCredits（带 trackKey）
        for (const [trackKey, roleMap] of Object.entries(trackOnlyPatchMap || {})) {
            for (const roleKey of EDITOR_ROLE_OUTPUT_ORDER) {
                const items = roleMap?.[roleKey];
                if (!Array.isArray(items) || !items.length) continue;

                for (const item of items) {
                    const text = itemSegmentsToText(item);
                    if (!text) continue;

                    const resolved = resolveSubRoleEditorLabel(roleKey, item, text);
                    addEditorBucketEntry(trackBucket, resolved.label, resolved.text, trackKey);
                }
            }

            for (const [roleKey, items] of Object.entries(roleMap || {})) {
                if (EDITOR_ROLE_OUTPUT_ORDER.includes(roleKey)) continue;
                if (!Array.isArray(items) || !items.length) continue;

                for (const item of items) {
                    const text = itemSegmentsToText(item);
                    if (!text) continue;

                    const resolved = resolveSubRoleEditorLabel(roleKey, item, text);
                    addEditorBucketEntry(trackBucket, resolved.label, resolved.text, trackKey);
                }
            }
        }

        const epinfoLines = [];
        const trackLines = [];

        function pushBucketLines(bucket, targetLines, withTrack) {
            const emitted = new Set();

            const emit = role => {
                if (emitted.has(role)) return;
                const nameMap = bucket.get(role);
                if (!nameMap || !nameMap.size) return;
                emitted.add(role);

                const chunks = Array.from(nameMap.entries()).map(([name, trackSet]) => {
                    if (!withTrack) return name;
                    return `${name}(${formatEditorTrackList(Array.from(trackSet))})`;
                });

                targetLines.push(`${role}：${chunks.join("、")}`);
            };

            // 1) 固定顺序里的基础职位
            for (const roleKey of EDITOR_ROLE_OUTPUT_ORDER) {
                emit(getEditorRoleLabel(roleKey));
            }

            /* ---------X-子角色 前缀职位--------- */
            // 2) `X-子角色` 前缀职位（乐器-Guitar、设计-Web …），按标签排序
            Array.from(bucket.keys())
                .filter(role => !!splitPrefixedRoleLabel(role))
                .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
                .forEach(emit);
            /* ---------X-子角色 前缀职位--------- */

            // 3) 其余已登记的基础职位（插图 / 设计 / 制作人 / 客串 …）
            const knownLabels = new Set(Object.values(ROLE_LABELS));
            Array.from(bucket.keys())
                .filter(role => knownLabels.has(role))
                .forEach(emit);

            // 4) custom-* 等剩余职位
            Array.from(bucket.keys()).forEach(role => {
                if (knownLabels.has(role)) return;
                if (splitPrefixedRoleLabel(role)) return;
                emit(role);
            });
        }

        pushBucketLines(epinfoBucket, epinfoLines, false);
        pushBucketLines(trackBucket, trackLines, true);

        if (epinfoLines.length && trackLines.length) {
            return `${epinfoLines.join("\n")}\n\n${trackLines.join("\n")}`;
        }

        return epinfoLines.concat(trackLines).join("\n");
    }

    function extractEditableInputVariants(data) {
        if (!data) {
            return {
                hasRawEditor: false,
                hasTrackCredits: false,
                rawEditorText: "",
                rebuiltTrackCreditsText: ""
            };
        }

        const rawEditorText =
            typeof data?.rawPatches?.editor === "string" && data.rawPatches.editor.trim()
                ? data.rawPatches.editor.trim()
                : "";

        const rebuiltTrackCreditsText =
            data?.trackCredits
                ? rebuildEditorTextFromTrackCredits(data)
                : "";

        return {
            hasRawEditor: !!rawEditorText,
            hasTrackCredits: !!data?.trackCredits,
            rawEditorText,
            rebuiltTrackCreditsText
        };
    }

    function extractEditableInputText(data) {
        const variants = extractEditableInputVariants(data);

        if (variants.hasRawEditor) {
            return variants.rawEditorText;
        }

        if (variants.hasTrackCredits) {
            return variants.rebuiltTrackCreditsText;
        }

        return "";
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

            /* ---------X-子角色 前缀职位--------- */
            // 乐器-Guitar / 设计-Web / 母带制作-xxx …
            const prefixed = splitPrefixedRoleLabel(left);
            const subRole = prefixed ? prefixed.sub : null;

            const parsedRoles = parseInputRoleLabels(left);
            if (!parsedRoles.length || !right) continue;
            /* ---------X-子角色 前缀职位--------- */

            const entries = splitOutsideParens(right);

            for (const entry of entries) {
                const extracted = extractTrailingTrackExpr(entry);

                // 有曲目标记：进 trackCredits
                if (extracted) {
                    const { name, trackExpr } = extracted;
                    const trackKeys = expandTrackExpr(trackExpr);

                    for (const trackKey of trackKeys) {
                        if (!patchMap[trackKey]) patchMap[trackKey] = {};

                        for (const roleKey of parsedRoles) {
                            if (!patchMap[trackKey][roleKey]) patchMap[trackKey][roleKey] = [];

                            patchMap[trackKey][roleKey].push(
                                subRole
                                    ? parsePatchSubRoleItem(name, subRole)
                                    : parsePatchDisplayItem(name)
                            );
                        }
                    }

                    continue;
                }

                // 无曲目标记：进 epinfo
                const plainName = entry.trim();
                if (!plainName) continue;

                if (!patchMap[EPINFO_TRACK_KEY]) patchMap[EPINFO_TRACK_KEY] = {};

                for (const roleKey of parsedRoles) {
                    // 裸「乐器」先不收（乐器信息由页面自己带）；
                    // 带子角色的写法（乐器-xxx）需要保留
                    if (roleKey === "instrument" && !subRole) continue;

                    if (!patchMap[EPINFO_TRACK_KEY][roleKey]) {
                        patchMap[EPINFO_TRACK_KEY][roleKey] = [];
                    }

                    patchMap[EPINFO_TRACK_KEY][roleKey].push(
                        subRole
                            ? parsePatchSubRoleItem(plainName, subRole)
                            : parsePatchDisplayItem(plainName)
                    );
                }
            }
        }

        return patchMap;
    }

    function itemToTrackCreditEntry(item, roleKey, trackKey, subjectId) {
        const segs = item?.segments || [];

        // instrument_credit / alias_instrument_credit
        if (roleKey === "instrument") {
            // [entity, text(" (Bass)")]
            if (
                segs.length === 2 &&
                segs[0]?.kind === "entity" &&
                segs[1]?.kind === "text"
            ) {
                const instMatch = segs[1].text.match(/^\s*\((.+)\)\s*$/);
                if (instMatch) {
                    const resolved = resolveCreditEntity(segs[0], roleKey, trackKey, subjectId);

                    if (resolved && resolved.id && resolved.isAlias) {
                        return {
                            type: "alias_instrument_credit",
                            alias: {
                                ref: segs[0].ref || null,
                                text: resolved.aliasText
                            },
                            person: {
                                ref: resolved.ref,
                                text: resolved.canonical
                            },
                            inst: instMatch[1]
                        };
                    }

                    return {
                        type: "instrument_credit",
                        person: {
                            ref: resolved?.ref || segs[0].ref || null,
                            text: resolved?.canonical || segs[0].text || ""
                        },
                        inst: instMatch[1]
                    };
                }
            }

            // [entity(alias), text(" ("), entity(person), text(") (Keyboards)")]
            if (
                segs.length === 4 &&
                segs[0]?.kind === "entity" &&
                segs[1]?.kind === "text" &&
                segs[1].text === " (" &&
                segs[2]?.kind === "entity" &&
                segs[3]?.kind === "text"
            ) {
                const instMatch = segs[3].text.match(/^\)\s*\((.+)\)\s*$/);
                if (instMatch) {
                    const aliasResolved = resolveCreditEntity(segs[0], roleKey, trackKey, subjectId);
                    const personResolved = resolveCreditEntity(segs[2], roleKey, trackKey, subjectId);

                    return {
                        type: "alias_instrument_credit",
                        alias: {
                            ref: null,
                            text: segs[0].text || aliasResolved?.aliasText || ""
                        },
                        person: {
                            ref: personResolved?.ref || segs[2].ref || null,
                            text: personResolved?.canonical || segs[2].text || ""
                        },
                        inst: instMatch[1]
                    };
                }
            }
        }

        // cv_credit
        // if (
        //     segs.length === 3 &&
        //     segs[0]?.kind === "text" &&
        //     segs[1]?.kind === "entity" &&
        //     segs[2]?.kind === "text"
        // ) {
        //     const parsedCv = parseCvPrefixText(segs[0].text || "");
        //     if (parsedCv && segs[2].text === ")") {
        //         const resolved = resolveCreditEntity(segs[1], roleKey, trackKey, subjectId);
        //         return {
        //             type: "cv_credit",
        //             character: parsedCv.character,
        //             cv: {
        //                 ref: resolved?.ref || segs[1].ref || null,
        //                 text: resolved?.canonical || segs[1].text || ""
        //             }
        //         };
        //     }
        // }

        // alias_person
        if (
            segs.length === 4 &&
            segs[0]?.kind === "entity" &&
            segs[0]?.noLink === true &&
            segs[1]?.kind === "text" &&
            segs[1].text === " (" &&
            segs[2]?.kind === "entity" &&
            segs[3]?.kind === "text" &&
            segs[3].text === ")"
        ) {
            const outerResolved = resolveCreditEntity(segs[0], roleKey, trackKey, subjectId);
            const innerResolved = resolveCreditEntity(segs[2], roleKey, trackKey, subjectId);

            const outerRef = outerResolved?.ref || segs[0].ref || null;
            const innerRef = innerResolved?.ref || segs[2].ref || null;

            const outerText =
                segs[0].text ||
                outerResolved?.aliasText ||
                outerResolved?.canonical ||
                "";

            const innerText =
                segs[2].text ||
                innerResolved?.aliasText ||
                innerResolved?.canonical ||
                "";

            // 当前关联已经切到括号外：
            // 不再强行写成 alias_person，改回旧 parts，保持显示顺序不变
            if (outerRef && !innerRef) {
                return {
                    parts: [
                        { ref: outerRef, text: outerText },
                        " (",
                        { ref: null, text: innerText },
                        ")"
                    ]
                };
            }

            // 默认仍按传统 alias_person：括号外 alias，括号内 person
            return {
                type: "alias_person",
                alias: {
                    ref: null,
                    text: outerText
                },
                person: {
                    ref: innerRef,
                    text: innerResolved?.canonical || innerText
                }
            };
        }

        // person / alias_person from plain entity
        if (segs.length === 1 && segs[0]?.kind === "entity") {
            const resolved = resolveCreditEntity(segs[0], roleKey, trackKey, subjectId);

            // 单个 entity 永远按普通 person 处理
            // 只有用户显式输入了 "A (B)" 时，才在上面的 alias_person 分支里处理
            return {
                type: "person",
                person: {
                    ref: resolved?.ref || segs[0].ref || null,
                    text:
                        segs[0].text ||
                        resolved?.aliasText ||
                        resolved?.canonical ||
                        ""
                }
            };
        }

        // mixed text/entity：继续写回旧 parts 结构
        // 规则：
        // 1. 普通 entity：保留为 { ref, text }
        // 2. 局部括号别名结构：优先把 ref 留给括号内；括号外只作显示回退
        // 3. text 优先保留当前输入/当前显示，不强制改成 canonical
        if (segs.length > 1 && segs.some(seg => seg.kind === "entity")) {
            const parts = [];
            let i = 0;

            while (i < segs.length) {
                const seg = segs[i];

                if (seg?.kind === "text") {
                    if (seg.text) parts.push(seg.text);
                    i++;
                    continue;
                }

                // 局部 alias 结构：
                // entity(alias/display) + " (" + entity(person) + ")"
                // 或 entity(alias/display) + " (" + entity(person) + ") (Inst)"
                if (
                    seg?.kind === "entity" &&
                    segs[i + 1]?.kind === "text" &&
                    segs[i + 1].text === " (" &&
                    segs[i + 2]?.kind === "entity" &&
                    segs[i + 3]?.kind === "text" &&
                    (
                        segs[i + 3].text === ")" ||
                        /^\)\s*\(.+\)\s*$/.test(segs[i + 3].text || "") ||
                        /^\)\)+\s*$/.test(segs[i + 3].text || "")
                    )
                ) {
                    const outerSeg = segs[i];
                    const innerSeg = segs[i + 2];
                    const closeText = segs[i + 3].text || "";

                    const outerResolved = resolveCreditEntity(outerSeg, roleKey, trackKey, subjectId);
                    const innerResolved = resolveCreditEntity(innerSeg, roleKey, trackKey, subjectId);

                    const outerText =
                        outerSeg.text ||
                        outerResolved?.aliasText ||
                        outerResolved?.canonical ||
                        "";

                    const innerText =
                        innerSeg.text ||
                        innerResolved?.aliasText ||
                        innerResolved?.canonical ||
                        "";

                    const explicitOuterRef = outerSeg.ref || null;
                    const explicitInnerRef = innerSeg.ref || null;

                    const resolvedOuterRef = outerResolved?.ref || null;
                    const resolvedInnerRef = innerResolved?.ref || null;

                    let finalOuterRef = null;
                    let finalInnerRef = null;

                    // 1) 显式写在 seg 上的 ref 优先
                    if (explicitInnerRef) {
                        finalInnerRef = explicitInnerRef;
                    } else if (explicitOuterRef) {
                        finalOuterRef = explicitOuterRef;
                    }
                    // 2) 如果 outer 是“当前页面已知别名”解析出来的，
                    //    则优先把 ref 放到括号内：
                    //    - inner 还没解析到
                    //    - 或 inner / outer 实际解析到的是同一个人物
                    else if (
                        outerResolved?.isAlias &&
                        resolvedOuterRef &&
                        (!resolvedInnerRef || resolvedInnerRef === resolvedOuterRef)
                    ) {
                        finalInnerRef = resolvedOuterRef;
                    }
                    // 3) 只有一边能解析到时，保留那一边
                    else if (resolvedOuterRef && !resolvedInnerRef) {
                        finalOuterRef = resolvedOuterRef;
                    } else if (!resolvedOuterRef && resolvedInnerRef) {
                        finalInnerRef = resolvedInnerRef;
                    }
                    // 4) 两边都能解析到时：
                    //    普通中性结构仍默认外层，避免数据库更新后自动翻转
                    else if (resolvedOuterRef && resolvedInnerRef) {
                        finalOuterRef = resolvedOuterRef;
                    }

                    parts.push({
                        ref: finalOuterRef,
                        text: outerText
                    });
                    parts.push(" (");
                    parts.push({
                        ref: finalInnerRef,
                        text: innerText
                    });
                    parts.push(closeText);

                    i += 4;
                    continue;
                }

                const resolved = resolveCreditEntity(seg, roleKey, trackKey, subjectId);

                const rawText = seg.text || "";
                const resolvedRef = resolved?.ref || seg.ref || null;
                const resolvedText =
                    rawText ||
                    resolved?.aliasText ||
                    resolved?.canonical ||
                    "";

                parts.push({
                    ref: resolvedRef,
                    text: resolvedText
                });

                i++;
            }

            return { parts };
        }

        // 单纯文本名字，也按 person 结构写回，避免退化成 type:text
        if (segs.length === 1 && segs[0]?.kind === "text") {
            const plain = (segs[0].text || "").trim();
            if (plain) {
                return {
                    type: "person",
                    person: {
                        ref: null,
                        text: plain
                    }
                };
            }
        }

        return {
            type: "text",
            text: segs.map(seg => seg.text || "").join("")
        };
    }

    function patchMapToTrackCredits(patchMap, subjectId) {
        const content = {
            subjectId: Number(subjectId)
        };

        const trackCredits = {};
        let epinfo = {};

        for (const [trackKey, roleMap] of Object.entries(patchMap || {})) {
            if (!roleMap || typeof roleMap !== "object") continue;

            const outRoleMap = {};

            for (const [roleKey, items] of Object.entries(roleMap || {})) {
                if (!Array.isArray(items) || !items.length) continue;

                const entries = items
                    .map(item => itemToTrackCreditEntry(item, roleKey, trackKey, subjectId))
                    .filter(Boolean);

                if (entries.length) {
                    outRoleMap[roleKey] = entries;
                }
            }

            if (!Object.keys(outRoleMap).length) continue;

            if (trackKey === EPINFO_TRACK_KEY) {
                epinfo = outRoleMap;
            } else {
                trackCredits[trackKey] = outRoleMap;
            }
        }

        const hasTrackCredits = Object.keys(trackCredits).length > 0;

        if (hasTrackCredits) {
            content.trackCredits = trackCredits;

            if (Object.keys(epinfo).length > 0) {
                content.epinfo = epinfo;
            }
        } else {
            content.trackCredits = {};
        }

        return content;
    }

    function getGlobalEpinfoElement() {
        return document.querySelector("ul.line_list_music > .epinfo");
    }

    function collectTrackRows() {
        const list = document.querySelector("ul.line_list_music");
        const map = new Map();
        if (!list) return map;

        let currentDisc = 1;

        for (const li of list.querySelectorAll(":scope > li")) {
            if (li.classList.contains("cat")) {
                const m = li.textContent.match(/Disc\s+(\d+)/i);
                if (m) currentDisc = Number(m[1]);
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

    function snapshotBaseEpinfoState() {
        const epinfo = getGlobalEpinfoElement();
        STAFF_PATCH_RUNTIME.baseEpinfoState = {
            rows: epinfo ? cloneParsedRows(parseEpinfoRows(epinfo)) : []
        };
    }

    function getOrBuildBaseEpinfoState() {
        const current = STAFF_PATCH_RUNTIME.baseEpinfoState;
        if (current && Array.isArray(current.rows)) {
            return current;
        }

        const epinfo = getGlobalEpinfoElement();
        return {
            rows: epinfo ? cloneParsedRows(parseEpinfoRows(epinfo)) : []
        };
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
        STAFF_PATCH_RUNTIME.baseTrackState.clear();

        for (const [trackKey, li] of trackRows) {
            const epinfo = li.querySelector(".epinfo");
            const h6 = li.querySelector("h6");
            if (!h6) continue;

            STAFF_PATCH_RUNTIME.baseTrackState.set(trackKey, {
                title: h6.textContent.trim().replace(/^\d+\s+/, ""),
                rows: epinfo ? cloneParsedRows(parseEpinfoRows(epinfo)) : []
            });
        }
    }

    function getOrBuildBaseTrackState(trackKey) {
        let base = STAFF_PATCH_RUNTIME.baseTrackState.get(trackKey);
        if (base) {
            return base;
        }

        const liveTrackRows = collectTrackRows();
        const li = liveTrackRows.get(trackKey);
        if (!li) return null;

        const epinfo = li.querySelector(".epinfo");
        const h6 = li.querySelector("h6");
        if (!h6) return null;

        base = {
            title: h6.textContent.trim().replace(/^\d+\s+/, ""),
            rows: epinfo ? cloneParsedRows(parseEpinfoRows(epinfo)) : []
        };

        STAFF_PATCH_RUNTIME.baseTrackState.set(trackKey, base);
        return base;
    }

    /**
     * 「修改工具」里按 `.tip` 文本找一行：
     *   `修改：` 行 -> 信息 / 封面 / 编辑（指向 edit_detail）
     *   `关联：` 行 -> 角色 / 制作人员 / 条目 / 人员修复
     */
    function findModifyToolRow(tipText) {
        const modifyTool = document.querySelector(".modifyTool .tip_i");
        if (!modifyTool) return null;

        const ps = Array.from(modifyTool.querySelectorAll("p"));
        return ps.find(p => {
            const tip = p.querySelector(".tip");
            return tip && tip.textContent.includes(tipText);
        }) || null;
    }

    function injectRepairEntry() {
        const relatedP = findModifyToolRow("关联");
        if (!relatedP) return;
        if (relatedP.querySelector("#bgm-staff-fix-link")) return;

        relatedP.appendChild(document.createTextNode(" / "));

        const a = document.createElement("a");
        a.href = "javascript:void(0);";
        a.className = "l";
        a.id = "bgm-staff-fix-link";
        a.textContent = "人员修复";
        a.addEventListener("click", onRepairEntryClick);

        relatedP.appendChild(a);
    }

    /**
     * 条目页的「编辑」入口：指向 /subject/{id}/edit_detail，挂在「修改：」那一行
     * （`信息 / 封面` 之后）。bgm 自带的编辑入口只到 /edit（基本信息），
     * 曲目列表 / Infobox 的详细编辑在 edit_detail，保存时由 installEditDetailAutoSubmitHook 接管。
     */
    function injectEditDetailEntry() {
        const relatedP = findModifyToolRow("修改");
        if (!relatedP) return;
        if (relatedP.querySelector("#bgm-staff-edit-detail-link")) return;

        const subjectId = getSubjectId();
        if (!subjectId) return;

        relatedP.appendChild(document.createTextNode(" / "));

        const a = document.createElement("a");
        a.href = `/subject/${subjectId}/edit_detail`;
        a.className = "l";
        a.id = "bgm-staff-edit-detail-link";
        a.textContent = "编辑";
        a.title = "编辑条目的详细资料（曲目列表 / Infobox）";

        relatedP.appendChild(a);
    }

    function installReceiverPatchCapture() {
        const selectors = [
            "#execwb-receiver",
            "#bgm-btn-import",
            "#manumatic-raw"
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (!el || el.dataset.staffPatchReceiverHooked === "1") continue;

            el.dataset.staffPatchReceiverHooked = "1";

            const capture = () => {
                const value =
                    "value" in el
                        ? String(el.value || "")
                        : String(el.textContent || "");

                const payload = extractPatchPayloadFromReceiverValue(value);
                if (!payload) return;

                if (payload.noPatch) {
                    saveAutoPatchPolicy("none", getSubjectId());
                    clearAutoPatchRawEditor();
                    clearPendingCreateExport();
                    clearAutoPatchTask(getSubjectId());
                    return;
                }

                if (payload.editor) {
                    // 没有条目 id（新建条目页）时这些写入会自动跳过：
                    // 数据只留在内存，点「创建条目并补全」创建成功后才落暂存
                    saveAutoPatchPolicy("selective", getSubjectId());
                    saveAutoPatchRawEditor(payload.editor, getSubjectId());
                    saveAutoPatchTrackTable(payload.trackTable, getSubjectId());
                }
            };

            el.addEventListener("input", capture);
            el.addEventListener("change", capture);
            el.addEventListener("paste", (e) => {
                try {
                    const pasted =
                        e.clipboardData?.getData("text/plain") ||
                        window.clipboardData?.getData("Text") ||
                        "";

                    if (pasted) {
                        const editor = captureRawEditorFromRawText(pasted, getSubjectId());
                        if (editor) {
                            console.log("[staff-patch] receiver captured editor from clipboard");
                        }
                    }
                } catch (err) {
                    console.warn("[staff-patch] clipboard capture failed:", err);
                }

                setTimeout(capture, 0);
                setTimeout(capture, 80);
                setTimeout(capture, 300);
            });

            capture();
            setTimeout(capture, 300);
            setTimeout(capture, 1000);
        }
    }

    /* ------------------------------------------------------------------
     * 章节「一键填注释」
     *
     * /ep 页按钮 → 勾上全部章节 + 批量修改（完整 id 列表挂在 action 的 hash 上，
     * >100 也不受站内全选限制）→ 批量修改页：等章节列表装载全 → 按「光盘|曲目」
     * 键把 trackTable 合并进 #summary（第 4 列：创作者备注 / 外文标题）→ 行数
     * 校验 → 分块 POST 保存 → 回 /ep。
     *
     * 「章节批量编辑增强 Plus」装着时，它的分块装载会被等待复用；没装则这里
     * 自己按 20 个一组拉取，装载与保存都不依赖它。保存走直接 POST、不触发站内
     * 提交，所以也不会和它的提交劫持打架。
     * ------------------------------------------------------------------ */
    const EP_BATCH_CHUNK_SIZE = 20;
    const EP_COMMENT_FLOW_MAX_AGE_MS = 10 * 60 * 1000;

    function isSubjectEpPage() {
        return /^\/subject\/\d+\/ep\/?$/.test(location.pathname);
    }

    function isEpBatchEditPage() {
        return /^\/subject\/\d+\/ep\/edit_batch\/?$/.test(location.pathname);
    }

    function getEpBatchTextarea() {
        const el = document.querySelector("#summary") || document.querySelector('[name="ep_list"]');
        return el && "value" in el ? el : null;
    }

    function parseEpBatchHashIds() {
        const m = location.hash.match(/#episodes=((\d+,)*\d+)/);
        return m ? m[1].split(",").filter(Boolean) : [];
    }

    function splitEpListLines(text) {
        return String(text || "")
            .split(/\r?\n/)
            .filter((line) => line.trim());
    }

    function decodeHtmlEntities(text) {
        const el = document.createElement("textarea");
        el.innerHTML = String(text || "");
        return el.value;
    }

    /** 行内的「光盘编号|曲目编号」键（单碟时工具端可能写 0，站内一律按 1 计） */
    function trackTableKeyOf(line) {
        const parts = String(line || "").split("|");
        if (parts.length < 2) return "";

        const disc = String(parts[0] || "").trim() || "1";
        const track = String(parts[1] || "").trim();
        if (!track) return "";

        return `${disc === "0" ? "1" : disc}|${track}`;
    }

    /** 曲目表里「第 4 列（注释 / 外文标题）非空」的键：一键填注释主要针对这些曲目 */
    function trackTableCommentedKeys(trackTable) {
        const keys = new Set();
        for (const line of splitEpListLines(trackTable)) {
            const parts = String(line).split("|");
            if (!String(parts[3] ?? "").trim()) continue;

            const key = trackTableKeyOf(line);
            if (key) keys.add(key);
        }
        return keys;
    }

    /**
     * 按「光盘|曲目」键合并：**工具提供了内容的列才覆盖，空列保留原值**。
     * 这样不会因为「导入时没解析到注释 / 工具没有时长」而把 bgm 上已有的内容抹掉；
     * 键对不上的行整行原样保留。
     */
    function mergeTrackTableIntoEpList(lines, trackTable) {
        const target = new Map();
        for (const line of splitEpListLines(trackTable)) {
            const key = trackTableKeyOf(line);
            if (key) target.set(key, line.trim());
        }

        return lines.map((line) => {
            const key = trackTableKeyOf(line);
            const tool = key ? target.get(key) : "";

            if (!tool) return line;

            const mine = String(line).split("|");
            const theirs = String(tool).split("|");
            const width = Math.max(mine.length, theirs.length);
            const merged = [];

            for (let i = 0; i < width; i++) {
                const toolCell = String(theirs[i] ?? "").trim();
                merged.push(toolCell || mine[i] || "");
            }

            return merged.join("|");
        });
    }

    /**
     * /ep 页：把每一行的 ep id 与它的「光盘|曲目」号对上（用于靶向填充）。
     * 依赖页面结构：`li.cat` 是 Disc 分组标题、行内 `h6`（或 `.epTitle`）以曲目号开头。
     * 只要有任意一行认不出编号就整体返回 null —— 调用方会退回「全选」兜底，不会猜。
     */
    function collectEpRowKeys() {
        const nodes = document.querySelectorAll('li.cat, input[name="ep_mod[]"]');
        const rows = [];
        const seen = new Set();
        let disc = 0;
        let discHeaders = 0;

        for (const node of nodes) {
            if (node.tagName === "LI" && node.classList.contains("cat")) {
                const m = String(node.textContent || "").match(/Disc\s*(\d+)/i);
                if (m) {
                    disc = Number(m[1]);
                    discHeaders++;
                }
                continue;
            }

            const id = String(node.value || "").trim();
            if (!id || seen.has(id)) continue;

            const li = node.closest("li");
            const titleEl = li ? li.querySelector("h6") || li.querySelector(".epTitle") : null;
            const titleText = titleEl ? titleEl.textContent : li ? li.textContent : "";
            const tm = String(titleText || "").match(/^\s*(\d+)\s*[.．、]?/);

            if (!tm) return null;

            seen.add(id);
            rows.push({ id, key: `${disc || 1}|${Number(tm[1])}` });
        }

        if (!rows.length) return null;

        // 没有 Disc 分组（单碟）时统一按第 1 碟算
        if (discHeaders === 0) {
            rows.forEach((row) => {
                row.key = `1|${row.key.split("|")[1]}`;
            });
        }

        return rows;
    }

    function readEpCommentFlow() {
        try {
            const raw = sessionStorage.getItem(EP_COMMENT_FLOW_KEY);
            if (!raw) return null;

            const parsed = JSON.parse(raw);
            if (!parsed || Date.now() - Number(parsed.savedAt || 0) > EP_COMMENT_FLOW_MAX_AGE_MS) {
                return null;
            }

            const subjectId = getSubjectId();
            if (parsed.subjectId && String(parsed.subjectId) !== String(subjectId || "")) {
                return null;
            }

            return parsed;
        } catch {
            return null;
        }
    }

    /** 批量修改页：按 20 个一组 POST 拉取现有章节数据（等价于 Plus 的装载） */
    async function fetchEpBatchListChunk(ids, formhash, url = location.pathname) {
        const body =
            "chkall=on" +
            `&submit=${encodeURIComponent("批量修改")}` +
            `&formhash=${encodeURIComponent(formhash)}` +
            ids.map((ep) => `&ep_mod%5B%5D=${encodeURIComponent(ep)}`).join("");

        const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            credentials: "same-origin",
            body
        });

        if (!res.ok) throw new Error(`装载失败 HTTP ${res.status}`);

        const html = await res.text();
        const m = html.match(/<textarea name="ep_list"[^>]*>([\w\W]*?)<\/textarea/);
        return decodeHtmlEntities(m ? m[1] : "").trim();
    }

    async function loadEpBatchListAll(ids, formhash, url = location.pathname) {
        const chunks = [];
        for (let i = 0; i < ids.length; i += EP_BATCH_CHUNK_SIZE) {
            chunks.push(await fetchEpBatchListChunk(ids.slice(i, i + EP_BATCH_CHUNK_SIZE), formhash, url));
        }
        return chunks.join("\n");
    }

    /** 等页面上的章节列表变成全量（Plus 在装载 / ≤20 时页面本身就是全量） */
    async function waitForEpBatchLoaded(textarea, expected) {
        const deadline = Date.now() + 30000;

        while (Date.now() < deadline) {
            if (splitEpListLines(textarea.value).length >= expected) return true;
            await new Promise((resolve) => setTimeout(resolve, 400));
        }

        return false;
    }

    /**
     * 只提交指定章节（每 20 个一组）：
     * entries = [{ id, line }]，调用方只把「确实有变化」的章节放进来 ——
     * 其余章节既不在 ep_ids 也不在 ep_list 里，服务器根本不会碰它们。
     */
    async function saveEpBatchPartial(entries, formhash, revVersion, editSummary, url = location.pathname) {
        for (let i = 0; i < entries.length; i += EP_BATCH_CHUNK_SIZE) {
            const group = entries.slice(i, i + EP_BATCH_CHUNK_SIZE);
            const body =
                `formhash=${encodeURIComponent(formhash)}` +
                `&rev_version=${encodeURIComponent(revVersion || "0")}` +
                `&editSummary=${encodeURIComponent(editSummary || "")}` +
                `&ep_ids=${encodeURIComponent(group.map((entry) => entry.id).join(","))}` +
                `&ep_list=${encodeURIComponent(group.map((entry) => entry.line).join("\n"))}` +
                `&submit_eps=${encodeURIComponent("改好了")}`;

            const res = await fetch(url, {
                method: "POST",
                headers: { "content-type": "application/x-www-form-urlencoded" },
                credentials: "same-origin",
                body
            });

            if (!res.ok) throw new Error(`保存失败 HTTP ${res.status}`);

            await new Promise((resolve) => setTimeout(resolve, 300));
        }
    }

    /**
     * 「创建条目并补全」用：不跳页面，直接给某个条目的章节列表补注释。
     * 走的是同一条数据通路：读 /ep 的 formhash 与章节 id → 拉批量修改页的现有行 →
     * 合并（只写工具提供的内容）→ 只提交确实有变化的章节。
     */
    async function fillEpCommentsForSubject(subjectId, trackTable) {
        const table = String(trackTable || "").trim();
        if (!table) return "注释跳过（没有曲目表）";

        const batchUrl = `/subject/${subjectId}/ep/edit_batch`;

        try {
            const epRes = await fetch(`/subject/${subjectId}/ep`, {
                credentials: "same-origin",
                cache: "no-store"
            });
            if (!epRes.ok) return `注释跳过（章节页 HTTP ${epRes.status}）`;

            const doc = new DOMParser().parseFromString(await epRes.text(), "text/html");
            const formhash = String(doc.querySelector('[name="formhash"]')?.value || "");
            const ids = Array.from(doc.querySelectorAll('input[name="ep_mod[]"]'))
                .map((el) => el.value)
                .filter(Boolean);

            if (!ids.length) return "注释跳过（还没有章节）";
            if (!formhash) return "注释跳过（拿不到 formhash）";

            // 第一组的响应顺便用来取 rev_version（保存时要带上）
            const firstHtml = await fetch(batchUrl, {
                method: "POST",
                headers: { "content-type": "application/x-www-form-urlencoded" },
                credentials: "same-origin",
                body:
                    "chkall=on" +
                    `&submit=${encodeURIComponent("批量修改")}` +
                    `&formhash=${encodeURIComponent(formhash)}` +
                    ids
                        .slice(0, EP_BATCH_CHUNK_SIZE)
                        .map((ep) => `&ep_mod%5B%5D=${encodeURIComponent(ep)}`)
                        .join("")
            }).then((res) => (res.ok ? res.text() : ""));

            const batchDoc = new DOMParser().parseFromString(firstHtml, "text/html");
            const revVersion = String(batchDoc.querySelector('[name="rev_version"]')?.value || "0");
            const firstText = String(batchDoc.querySelector('textarea[name="ep_list"]')?.value || "").trim();

            const lines = [firstText];
            for (let i = EP_BATCH_CHUNK_SIZE; i < ids.length; i += EP_BATCH_CHUNK_SIZE) {
                lines.push(await fetchEpBatchListChunk(ids.slice(i, i + EP_BATCH_CHUNK_SIZE), formhash, batchUrl));
            }

            const current = splitEpListLines(lines.join("\n"));
            if (current.length !== ids.length) return "注释跳过（章节列表不完整）";

            const merged = mergeTrackTableIntoEpList(current, table);
            const changed = [];
            merged.forEach((line, i) => {
                if (line.trim() !== current[i].trim()) changed.push(i);
            });

            if (!changed.length) return "注释已是最新";

            await saveEpBatchPartial(
                changed.map((i) => ({ id: ids[i], line: merged[i] })),
                formhash,
                revVersion,
                "创建条目并补全：填注释",
                batchUrl
            );

            return `已填注释 ${changed.length} 首`;
        } catch (err) {
            console.warn("[staff-patch] create-complete comment fill failed:", err);
            return `注释失败（${err?.message || String(err)}）`;
        }
    }

    function startEpCommentFlow(buttons, save) {
        const form = document.querySelector('form[name="edit_ep_batch"]');
        if (!form) return;

        const boxes = Array.from(document.querySelectorAll('input[name="ep_mod[]"]'));
        const ids = boxes.map((box) => box.value).filter(Boolean);

        if (!ids.length) {
            showMsgSafe("这个条目还没有章节，先把曲目加上再来。");
            return;
        }

        const subjectId = getSubjectId();
        const trackTable = getAutoPatchTrackTable(subjectId);
        if (!trackTable) {
            showMsgSafe("没有拿到这个条目的曲目表：先在条目页粘贴一次工具导出的 JSON。");
            return;
        }

        // 靶向：只挑「曲目表里有注释」的那些章节（整张专辑不是每首都有注释时，
        // 没必要把全表都提交一遍）。认不出行号就退回全选兜底，绝不猜。
        const commented = trackTableCommentedKeys(trackTable);
        const rows = collectEpRowKeys();
        let targetIds = ids;
        let targeted = false;

        if (rows && rows.length === ids.length && commented.size > 0) {
            const picked = rows.filter((row) => commented.has(row.key)).map((row) => row.id);

            if (picked.length > 0 && picked.length < ids.length) {
                targetIds = picked;
                targeted = true;
            }
        }

        sessionStorage.setItem(
            EP_COMMENT_FLOW_KEY,
            JSON.stringify({
                subjectId: String(subjectId || ""),
                savedAt: Date.now(),
                save: Boolean(save),
                epCount: targetIds.length,
                targeted
            })
        );

        showMsgSafe(
            targeted
                ? `曲目表里 ${commented.size} 首带注释，只处理其中的 ${targetIds.length} 个章节。`
                : `没有可靶向的部分，按全部 ${targetIds.length} 个章节处理。`
        );

        // 与站内「批量修改」一致的提交：勾上目标章节，id 列表挂在 action 的 hash 上
        // （靶向提交时不动 chkall，免得被当成「全选所有章节」）
        boxes.forEach((box) => {
            box.checked = targetIds.includes(box.value);
        });

        if (!targeted) {
            const chkall = form.querySelector('[name="chkall"]');
            if (chkall) chkall.checked = true;
        }

        form.setAttribute("action", `/subject/${subjectId}/ep/edit_batch#episodes=${targetIds.join(",")}`);

        buttons.forEach((btn) => {
            btn.value = "正在进入批量修改…";
            btn.disabled = true;
        });

        const submit = form.querySelector('input[type="submit"], button[type="submit"], button');
        if (submit) submit.click();
    }

    /** /ep 页：把入口按钮挂在「批量修改」旁边 */
    function installEpCommentFlowEntry() {
        if (!isSubjectEpPage()) return;

        const form = document.querySelector('form[name="edit_ep_batch"]');
        if (!form || form.dataset.staffEpCommentEntry === "1") return;

        const submit = form.querySelector('input[type="submit"], button[type="submit"], button');
        if (!submit) return;

        form.dataset.staffEpCommentEntry = "1";

        const makeButton = (id, label, title, save) => {
            const btn = document.createElement("input");
            btn.type = "button";
            btn.id = id;
            btn.className = submit.className || "inputBtn";
            btn.value = label;
            btn.title = title;
            btn.style.marginLeft = "0.5rem";
            btn.addEventListener("click", () => startEpCommentFlow([btn], save));
            return btn;
        };

        // 逐个插到「批量修改」后面：先插的在后，所以按 填注释 → 填注释并保存 的顺序插
        submit.insertAdjacentElement(
            "afterend",
            makeButton(
                "execwb-ep-comment-save",
                "填注释并保存",
                "全选章节 → 批量修改 → 按曲目表填上注释 → 自动分块保存（超过 100 个章节也支持）",
                true
            )
        );
        submit.insertAdjacentElement(
            "afterend",
            makeButton(
                "execwb-ep-comment-preview",
                "填注释",
                "全选章节 → 批量修改 → 按曲目表填上注释，停在保存前由你检查（超过 100 个章节也支持）",
                false
            )
        );
    }

    /** 批量修改页：自动装载 → 合并 → 校验 →（可选）分块保存 */
    async function maybeRunEpCommentFlow() {
        const flow = readEpCommentFlow();
        if (!flow) return;

        // 只消费一次：之后手动刷新不再自动跑
        sessionStorage.removeItem(EP_COMMENT_FLOW_KEY);

        const episodes = parseEpBatchHashIds();
        const textarea = getEpBatchTextarea();
        if (!episodes.length || !textarea) return;

        const form = document.querySelector('form[name="edit_ep_batch"]') || textarea.closest("form");
        const formhashInput = document.querySelector('[name="formhash"]');
        const revVersionInput = document.querySelector('[name="rev_version"]');
        const editSummaryInput = document.querySelector("#editSummary");

        if (!form || !formhashInput) {
            showMsgSafe("找不到批量修改表单，跳过自动填注释。");
            return;
        }

        const formhash = formhashInput.value;
        const trackTable = getAutoPatchTrackTable(getSubjectId());
        if (!trackTable) {
            showMsgSafe("没有拿到曲目表，跳过自动填注释（先把工具导出的 JSON 粘一次）。");
            return;
        }

        try {
            showMsgSafe(`正在等待 ${episodes.length} 个章节的列表装载…`);

            const loaded = await waitForEpBatchLoaded(textarea, episodes.length);
            if (!loaded) {
                // 没等到（没装 Plus 且章节数 >20）：自己按 20 个一组拉取
                showMsgSafe("站点列表没有装载全，正在自己拉取…");
                const all = await loadEpBatchListAll(episodes, formhash);
                if (splitEpListLines(all).length < episodes.length) {
                    showMsgSafe("章节列表装载不完整，已停下，没有保存。");
                    return;
                }
                textarea.value = all;
            }

            const lines = splitEpListLines(textarea.value);
            if (lines.length !== episodes.length) {
                showMsgSafe(
                    `章节数对不上（页面 ${lines.length} 行 / 选中 ${episodes.length} 个），已停下，没有保存。`
                );
                return;
            }

            const merged = mergeTrackTableIntoEpList(lines, trackTable);
            textarea.value = merged.join("\n");

            // 只有「确实有变化」的行才值得提交：其余章节一律不碰
            const changed = [];
            merged.forEach((line, i) => {
                if (line.trim() !== lines[i].trim()) changed.push(i);
            });

            if (!changed.length) {
                showMsgSafe("没有需要写入的内容（曲目表里的注释已经是最新的），未提交任何修改。");
                return;
            }

            const previewKeys = changed
                .slice(0, 6)
                .map((i) => trackTableKeyOf(lines[i]))
                .join("、");

            if (!flow.save) {
                showMsgSafe(
                    `已按曲目表填上注释（${changed.length} 行有变化：${previewKeys}${changed.length > 6 ? "…" : ""}），` +
                        "保存时只会提交这些章节，检查无误后点「改好了」。"
                );
                return;
            }

            const entries = changed.map((i) => ({ id: episodes[i], line: merged[i] }));

            showMsgSafe(`已按曲目表填上注释（${changed.length} 行有变化），只提交这些章节…`);

            await saveEpBatchPartial(
                entries,
                formhash,
                revVersionInput ? revVersionInput.value : "0",
                editSummaryInput ? editSummaryInput.value : ""
            );

            // 核对：把刚才提交的那部分拉回来，比对第 4 列（注释）
            const head = entries.slice(0, EP_BATCH_CHUNK_SIZE);
            const verifyLines = splitEpListLines(
                await fetchEpBatchListChunk(
                    head.map((entry) => entry.id),
                    formhash
                )
            );
            const expect = head.map((entry) => String(entry.line.split("|")[3] ?? "").trim());
            const got = verifyLines.map((line) => String(line.split("|")[3] ?? "").trim());

            if (verifyLines.length !== expect.length || !expect.every((value, i) => value === got[i])) {
                showMsgSafe("保存后核对不一致，请到批量修改页手动确认。");
                return;
            }

            showMsgSafe(`章节注释已保存（只改了 ${entries.length} 个章节），回章节列表。`);
            location.href = `/subject/${getSubjectId()}/ep`;
        } catch (err) {
            console.warn("[staff-patch] ep comment flow failed:", err);
            showMsgSafe("自动填注释出错了，已停下：详情看控制台。");
        }
    }

    function installSonglistAutoPatchHook() {
        const form = document.querySelector('form[name="new_songlist"][action*="/songlist/new"]');
        if (!form || form.dataset.staffPatchHooked === "1") return;

        form.dataset.staffPatchHooked = "1";

        form.addEventListener("submit", () => {
            const songlistInput = form.querySelector("#songlist");
            const discInput = form.querySelector('input[name="disc"]');

            const songlistText = (songlistInput?.value || "").trim();
            const disc = (discInput?.value || "").trim() || "1";

            if (!songlistText) return;

            captureRawEditorFromKnownReceivers();

            const subjectId = getSubjectId();
            if (!subjectId) return;

            if (getAutoPatchPolicy(subjectId) === "none") {
                console.log("[staff-patch] skip auto submit: selective patch is empty");
                return;
            }

            mergeAutoPatchTask({
                subjectId,
                songlistPending: true,
                songlistMeta: {
                    disc,
                    songCount: songlistText.split(/\r?\n/).map(s => s.trim()).filter(Boolean).length
                },
                lastSource: "songlist"
            });

            // setTimeout(() => {
            //     tryFlushAutoPatchTask(subjectId).catch(err => {
            //         console.warn("[staff-patch] songlist flush failed:", err);
            //     });
            // }, 0);
        });
    }

    function runCreateSubjectPatchCaptureBurst() {
        // 先抓一次当前 receiver
        captureRawEditorFromKnownReceivers();

        // 兼容原生提交、维基工具回填、以及第三方按钮内部固定 200ms 后 sendForm 的链路
        setTimeout(() => {
            captureRawEditorFromKnownReceivers();
        }, 0);

        setTimeout(() => {
            captureRawEditorFromKnownReceivers();
        }, 220);

        setTimeout(() => {
            captureRawEditorFromKnownReceivers();
        }, 420);
    }

    function installCreateSubjectSubmitHook() {
        if (!isCreateMusicPage()) return;

        const form = document.querySelector('form[name="create_subject"][action="/new_subject/3"]');
        if (!form || form.dataset.staffPatchCreateHooked === "1") return;

        form.dataset.staffPatchCreateHooked = "1";

        form.addEventListener("submit", () => {
            runCreateSubjectPatchCaptureBurst();
        });
    }

    function isThirdPartyCreateSubjectButton(target) {
        const btn = target?.closest?.('.e-wiki-cover-container [name="submit"]');
        if (!btn) return false;

        const type = String(btn.getAttribute("type") || "").toLowerCase();
        if (type !== "button") return false;

        return true;
    }

    function installCreateSubjectThirdPartySubmitHook() {
        if (!isCreateMusicPage()) return;
        if (document.documentElement.dataset.staffPatchThirdPartyCreateHooked === "1") return;

        document.documentElement.dataset.staffPatchThirdPartyCreateHooked = "1";

        document.addEventListener("click", (e) => {
            if (!isThirdPartyCreateSubjectButton(e.target)) return;

            runCreateSubjectPatchCaptureBurst();
        }, true);
    }

    /* ------------------------------------------------------------------
     * 「创建条目并补全」
     * 不接管 bgm 自带的创建按钮，而是在它旁边额外挂一个按钮：
     * 回填表单 → 查重 → 提交创建 → 校验返回值 → 上传封面 → 添加曲目 → 关联人物。
     * 命中重名或校验失败时直接中止并销毁一次性数据，
     * 绝不往已存在的同名条目写任何东西。
     * ------------------------------------------------------------------ */
    const CREATE_BUTTON_ID = "bgm-staff-create-complete-btn";
    const CREATE_STATUS_CLASS = "bgm-staff-create-status";
    const CREATE_BUTTON_LABEL = "创建条目并补全";

    function setCreateStatus(html, isError = false) {
        const status = document.querySelector("." + CREATE_STATUS_CLASS);
        if (!status) return;

        status.innerHTML = html || "";
        status.classList.toggle("is-error", Boolean(isError));
        console.log("[staff-patch] create-complete:", status.textContent);
    }

    function getCreateSubjectForm() {
        return document.querySelector('form[name="create_subject"]');
    }

    // 第三方图片组件的按钮也叫 [name=submit]，但 type 是 button；
    // 真正的表单提交按钮 type 是 submit，这里必须挑对。
    function findCreateSubmitInput(form) {
        const candidates = Array.from(form.querySelectorAll('[name="submit"]'));

        return (
            candidates.find(
                (el) => String(el.getAttribute("type") || "").toLowerCase() === "submit"
            ) ||
            candidates.find((el) => !el.closest(".e-wiki-cover-container")) ||
            null
        );
    }

    function findPageFormhash() {
        const el =
            document.querySelector('form[name="create_subject"] input[name="formhash"]') ||
            document.querySelector('input[name="formhash"]');

        return el ? String(el.value || "") : "";
    }

    function dataUrlToBlob(dataUrl) {
        const parts = String(dataUrl || "").split(",");
        if (parts.length < 2) throw new Error("封面数据格式异常");

        const meta = parts[0] || "";
        const isBase64 = meta.indexOf("base64") >= 0;
        const mime = (meta.split(":")[1] || "").split(";")[0] || "image/png";
        const binary = isBase64 ? atob(parts[1]) : decodeURIComponent(parts[1]);

        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        return { blob: new Blob([bytes], { type: mime }), mime };
    }

    // 用户亲手改过的字段（按字段标识记录，不绑 DOM 元素：切换「维基 / 新手」模式
    // 有可能把输入框重建一次）。
    //
    // 只认「真实用户输入」（isTrusted）——不能用「值与我们上次写的不一样」来判断：
    // bgm 自己在模式切换时也会回写/重新序列化表单（例如把带 `[]`、`[DISC 1|]`
    // 占位行的 Infobox 重排），那种差异不是用户修改，按它跳过回填会丢数据。
    const userEditedFields = new Set();

    function fieldKeyOf(el) {
        return (el && (el.name || el.id)) || "";
    }

    // 文档级监听记录「用户亲手改过哪些字段」：一次挂载即可，
    // 不受模式切换重建输入框影响，也不会漏掉脚本加载后、首次回填前的手动输入。
    document.addEventListener(
        "input",
        (e) => {
            if (!e.isTrusted) return;
            const key = fieldKeyOf(e.target);
            if (key) userEditedFields.add(key);
        },
        true
    );

    function setFieldValue(el, value, fieldKey) {
        const text = String(value || "");
        if (!el || !text) return false;

        const key = fieldKey || fieldKeyOf(el);
        // 「有修改的地方做解绑」：用户亲手改过的字段不覆盖
        if (key && userEditedFields.has(key)) return false;

        el.value = text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
    }

    // 维基模式 / 新手（入门）模式的切换链接
    const MODE_LINK_HINTS = {
        wiki: { keywords: ["维基"], fallback: 'table small a:nth-of-type(1)[href="javascript:void(0)"]' },
        newbie: { keywords: ["新手", "入门"], fallback: 'table small a:nth-of-type(2)[href="javascript:void(0)"]' }
    };

    // 标签输入框：bgm 是 input#tags[name="tags"]，但它不一定在 create_subject 表单里，
    // 所以按「表单内 → 全页 → 按行文字兜底」三级找。
    function findCreateTagInput(form) {
        const candidates = [
            'input[name="tags"]',
            "#tags",
            'input[name="subject_tags"]',
            'input[name="subject_tag"]',
            'input[name="tag"]'
        ];

        for (const selector of candidates) {
            const el = (form && form.querySelector(selector)) || document.querySelector(selector);
            if (el) return el;
        }

        // 兜底：找到写着「标签」的那一行/那一格，取里面的文本框
        const scope = form || document;
        for (const row of Array.from(scope.querySelectorAll("tr, .cell, .row"))) {
            if ((row.textContent || "").indexOf("标签") < 0) continue;

            const el = row.querySelector('input[type="text"], input:not([type]), textarea');
            if (el) return el;
        }

        return null;
    }

    function findModeLink(mode) {
        const conf = MODE_LINK_HINTS[mode];
        if (!conf) return null;

        const links = Array.from(
            document.querySelectorAll('table small a[href="javascript:void(0)"]')
        );

        for (const keyword of conf.keywords) {
            const hit = links.find((a) => (a.textContent || "").indexOf(keyword) >= 0);
            if (hit) return hit;
        }

        return document.querySelector(conf.fallback);
    }

    async function fillCreateFormFromPayload(form, payload, options = {}) {
        // Infobox 是 wiki 语法文本，先切到「维基模式」
        const wikiModeLink = findModeLink("wiki");
        if (wikiModeLink) {
            wikiModeLink.click();
            await sleep(200);
        }

        const filled = [];
        const kept = [];

        // 用户已经自己改过的字段不覆盖（「有修改的地方做解绑」）；
        // 跳过时记进 kept 交给调用方提示，免得用户以为没填上。
        const applyField = (label, el, value) => {
            if (!el || !value) return;

            if (setFieldValue(el, value)) {
                filled.push(label);
            } else if (String(el.value || "").trim()) {
                kept.push(label);
            }
        };

        applyField("名称", form.querySelector('[name="subject_title"]'), payload.title);
        applyField("Infobox", form.querySelector("#subject_infobox"), payload.infoBox);
        applyField("简介", form.querySelector("#subject_summary"), payload.description);

        const tagInput = findCreateTagInput(form);
        if (tagInput) {
            applyField("标签", tagInput, payload.metaTags);
        } else if (payload.metaTags) {
            console.warn(
                "[staff-patch] 没找到标签输入框，标签未填充。数据里的标签是：",
                payload.metaTags
            );
        }

        // 回填完成后切回「新手（入门）模式」，方便肉眼核对；
        // 提交路径不切回来，提交时要停留在维基模式。
        if (options.backToNewbie && filled.length) {
            const newbieLink = findModeLink("newbie");
            if (newbieLink) {
                await sleep(150);
                newbieLink.click();
            }
        }

        return { filled, kept };
    }

    async function searchSameNameMusicSubjects(title) {
        const res = await fetch(`/json/search-music/${encodeURIComponent(title)}`, {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store"
        });

        if (!res.ok) {
            throw new Error(`搜索请求失败 HTTP ${res.status}`);
        }

        let data;
        try {
            data = await res.json();
        } catch (err) {
            throw new Error("搜索返回内容无法解析（可能未登录或触发限流）");
        }

        // 没有结果时 Bangumi JSON 搜索返回 null
        if (data === null) return [];
        if (!Array.isArray(data)) throw new Error("搜索返回结构异常");

        return data
            .filter(
                (item) =>
                    item &&
                    Number(item.type_id) === 3 &&
                    (!item.url_mod || item.url_mod === "subject") &&
                    item.id
            )
            .map((item) => ({
                id: String(item.id),
                name: String(item.name || ""),
                nameCn: String(item.name_cn || "")
            }));
    }

    function pickDuplicateCandidates(candidates, title) {
        const target = normalizeCompareText(title).toLowerCase();
        if (!target) return [];

        return candidates.filter((item) => {
            const name = normalizeCompareText(item.name).toLowerCase();
            const nameCn = normalizeCompareText(item.nameCn).toLowerCase();

            return name === target || (nameCn && nameCn === target);
        });
    }

    function submitCreateSubjectForm(form) {
        return new Promise((resolve, reject) => {
            const fd = new FormData(form);
            const submitInput = findCreateSubmitInput(form);

            if (submitInput && submitInput.name && submitInput.value) {
                fd.set(submitInput.name, submitInput.value);
            }

            const xhr = new XMLHttpRequest();
            xhr.open(
                (form.getAttribute("method") || "POST").toUpperCase(),
                form.getAttribute("action") || location.href,
                true
            );

            xhr.onload = () => {
                if (xhr.status !== 200) {
                    reject(new Error(`创建请求失败 HTTP ${xhr.status}`));
                    return;
                }

                resolve(xhr.responseURL || "");
            };

            xhr.onerror = () => reject(new Error("创建请求网络错误"));
            xhr.send(fd);
        });
    }

    function parseSubjectIdFromUrl(url) {
        const m = String(url || "").match(/\/subject\/(\d+)/);
        return m ? m[1] : "";
    }

    // 封面是整条创建流程里最大、也最容易受网络抖动影响的请求。
    // 15 秒没有回应就放弃，避免「连得上但不回数据」把最后的跳转一直吊住。
    const COVER_UPLOAD_TIMEOUT_MS = 15000;

    async function uploadCreateCover(subjectId, dataUrl) {
        const { blob, mime } = dataUrlToBlob(dataUrl);
        const ext = mime === "image/png" ? "png" : mime === "image/gif" ? "gif" : "jpg";

        const fd = new FormData();
        const formhash = findPageFormhash();
        if (formhash) fd.set("formhash", formhash);

        fd.set("picfile", blob, `staff${Date.now().toString(36)}.${ext}`);
        fd.set("submit", "上传图片");

        // 老浏览器没有 AbortSignal.timeout 时退化为「不超时」（与改动前一致）
        const signal =
            typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
                ? AbortSignal.timeout(COVER_UPLOAD_TIMEOUT_MS)
                : undefined;

        let res;
        try {
            res = await fetch(`/subject/${subjectId}/upload_img`, {
                method: "POST",
                body: fd,
                credentials: "same-origin",
                signal
            });
        } catch (err) {
            if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
                throw new Error(`封面上传超时（${COVER_UPLOAD_TIMEOUT_MS / 1000}s）`);
            }
            throw err;
        }

        if (!res.ok) throw new Error(`封面接口 HTTP ${res.status}`);
    }

    // trackTable 每行形如：disc|track|曲名|备注|
    function parseTrackTableToDiscs(trackTable) {
        const discs = new Map();

        for (const line of String(trackTable || "").split(/\r?\n/)) {
            const raw = line.trim();
            if (!raw) continue;

            const parts = raw.split("|");
            if (parts.length < 3) continue;

            const disc = String(parts[0] || "1").trim() || "1";
            const trackTitle = String(parts[2] || "").trim();
            if (!trackTitle) continue;

            if (!discs.has(disc)) discs.set(disc, []);
            discs.get(disc).push(trackTitle);
        }

        return [...discs.entries()]
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([disc, titles]) => ({ disc, titles }));
    }

    async function addSonglistForDisc(subjectId, disc, titles) {
        const fd = new FormData();
        const formhash = findPageFormhash();
        if (formhash) fd.set("formhash", formhash);

        fd.set("songlist", titles.join("\n"));
        fd.set("disc", String(disc));
        fd.set("submit", "加上去");

        const res = await fetch(`/subject/${subjectId}/songlist/new`, {
            method: "POST",
            body: fd,
            credentials: "same-origin"
        });

        if (!res.ok) throw new Error(`曲目接口 HTTP ${res.status}`);
    }

    /* ------------------------------------------------------------------
     * 关联人物（站内关联）
     * 数据取自工具导出的 relaTable（每行形如：
     *   https://bgm.tv/person/1234  作曲  编曲
     * ），提交到 /subject/{id}/add_related/person。
     * 该页面一「行」= 一个「人物 × 职位」，同一个人多职位要拆成多行。
     * ------------------------------------------------------------------ */
    const RELATED_PERSON_ROLE_ID_MAP = {
        艺术家: "3001",
        制作人: "3002",
        厂牌: "3004",
        作曲: "3003",
        作词: "3006",
        编曲: "3008",
        乐器: "3014",
        声乐: "3015",
        客串: "3019",
        和声: "3022",
        合唱: "3021",
        "念白/旁白": "3016",
        念白: "3016",
        旁白: "3016",
        录音: "3007",
        混音: "3013",
        母带制作: "3012",
        母带: "3012",
        人声编辑: "3017",
        人声指导: "3018",
        音响监督: "3020",
        插图: "3009",
        插画: "3009",
        原作: "3005",
        脚本: "3010",
        出版方: "3011",
        设计: "3023"
    };

    function parseRelaTableToRelations(relaTable) {
        const out = [];
        const seen = new Set();

        for (const line of String(relaTable || "").split(/\r?\n/)) {
            const raw = line.trim();
            if (!raw) continue;

            const matched = raw.match(/\/person\/(\d+)/);
            if (!matched) continue;

            const personId = matched[1];
            const rest = raw.slice(matched.index + matched[0].length);
            const tokens = rest
                .split(/\s{2,}/)
                .map((token) => token.trim())
                .filter(Boolean);

            for (const token of tokens) {
                // 形如「作曲」「乐器-吉他」「艺术家#6」「艺术家#1-3,5」：
                // # 后面是参与曲目表达式（工具里由 pagenoJoin / multiDiscPageNoJoin 生成，
                // 与维基端 expandTrackExpr 的语法一致），要原样填进 appear_eps。
                const hashIndex = token.indexOf("#");
                const rolePart = hashIndex >= 0 ? token.slice(0, hashIndex) : token;
                const appearExpr = hashIndex >= 0 ? token.slice(hashIndex + 1).trim() : "";

                const roleLabel = rolePart.split("-")[0].trim();
                const roleId = RELATED_PERSON_ROLE_ID_MAP[roleLabel];

                if (!roleId) {
                    console.warn("[staff-patch] unknown related-person role, skipped:", token);
                    continue;
                }

                const key = `${personId}\u0001${roleId}`;
                if (seen.has(key)) continue;
                seen.add(key);

                out.push({ personId, roleId, roleLabel, appearExpr });
            }
        }

        return out;
    }

    async function addSubjectPersonRelations(subjectId, relations) {
        const pageUrl = `/subject/${subjectId}/add_related/person`;

        const pageRes = await fetch(pageUrl, {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store"
        });

        if (!pageRes.ok) throw new Error(`关联人物页 HTTP ${pageRes.status}`);

        const doc = new DOMParser().parseFromString(await pageRes.text(), "text/html");
        const form = doc.querySelector('form[name="add_related"]');
        if (!form) throw new Error("关联人物页没有找到表单（可能没有权限）");

        const formhash = String(form.querySelector('input[name="formhash"]')?.value || "");
        if (!formhash) throw new Error("关联人物页缺少 formhash");

        // 已有行占用的 index 要避开，避免覆盖既有关系
        let maxIndex = -1;
        for (const el of Array.from(form.querySelectorAll("[name^='infoArr[']"))) {
            const m = String(el.getAttribute("name") || "").match(/^infoArr\[(\d+)\]/);
            if (m) maxIndex = Math.max(maxIndex, Number(m[1]));
        }

        const fd = new FormData();
        fd.set("formhash", formhash);
        fd.set("editSummary", "创建条目并补全");

        let withAppear = 0;

        relations.forEach((item, i) => {
            const n = maxIndex + 1 + i;
            const appear = String(item.appearExpr || "").trim();
            if (appear) withAppear++;

            fd.set(`infoArr[${n}][prsn_id]`, item.personId);
            fd.set(`infoArr[${n}][prsnPos]`, item.roleId);
            // 参与曲目：原样带过去（如 6 / 1-3,5 / 多碟 1.1-3, 1.5）
            fd.set(`infoArr[${n}][appear_eps]`, appear);
        });

        fd.set("submit", "保存关联数据");

        const saved = await fetch(pageUrl, {
            method: "POST",
            body: fd,
            credentials: "same-origin"
        });

        if (!saved.ok) throw new Error(`关联人物提交 HTTP ${saved.status}`);

        const finalUrl = String(saved.url || "");
        const savedHtml = await saved.text();

        console.log(
            "[staff-patch] related persons submitted:",
            relations.length,
            "条，其中带参与曲目",
            withAppear,
            "条；landed on:",
            finalUrl
        );

        // bgm 保存后是原地重渲染（继续停在关联页属正常），所以不能靠 URL 判断成败：
        // 落回关联页时，用响应里的关系行核对「人物 + 职位」是否都已存在。
        if (finalUrl.indexOf(`/subject/${subjectId}/add_related`) >= 0) {
            const savedDoc = new DOMParser().parseFromString(savedHtml, "text/html");
            const list = savedDoc.querySelector("#crtRelateSubjects");

            if (list) {
                const savedPairs = new Set();

                for (const li of Array.from(list.querySelectorAll(":scope > li"))) {
                    const personId = String(
                        li.querySelector('input[name$="[prsn_id]"]')?.value || ""
                    ).trim();
                    const roleId = String(
                        li.querySelector('select[name$="[prsnPos]"]')?.value || ""
                    ).trim();

                    if (personId && roleId) savedPairs.add(`${personId}\u0001${roleId}`);
                }

                const missing = relations.filter(
                    (item) => !savedPairs.has(`${item.personId}\u0001${item.roleId}`)
                );

                if (missing.length) {
                    throw new Error(
                        `提交后未在关联页看到 ${missing.length} 条关系（人物 ${missing
                            .slice(0, 3)
                            .map((item) => item.personId)
                            .join("、")}），可能未保存成功`
                    );
                }
            } else {
                // 页面结构变了、没有可核对的列表：只提示，不当作失败
                console.warn(
                    "[staff-patch] related page has no #crtRelateSubjects to verify; assume saved"
                );
            }
        }

        return relations.length;
    }

    // 取当前要用于创建的数据：以内存里那份为准（剪贴板读取、任意位置粘贴、接收器抓取
    // 都会更新它，所以它总是最新的）；「咏唱」输入框只作兜底——那里可能还留着
    // 上一个条目的旧 JSON，优先读它会把旧数据当成新数据提交。
    function resolveCreateOneshotPayload() {
        const stored = getCreateOneshotPayload();
        if (stored && (stored.title || stored.trackTable || stored.relaTable || stored.cover)) {
            return stored;
        }

        for (const selector of ["#execwb-receiver", "#bgm-btn-import", "#manumatic-raw"]) {
            const el = document.querySelector(selector);
            if (!el) continue;

            const value = "value" in el ? String(el.value || "") : String(el.textContent || "");
            if (!value.trim()) continue;

            const payload = parsePatchPayloadFromReceiverValue(value);
            if (payload && (payload.title || payload.trackTable || payload.relaTable || payload.cover)) {
                // 这里只读不写：暂存要等创建成功（commitCreatePatchForNewSubject）才落地
                return payload;
            }
        }

        return null;
    }

    // 中止时的一次性数据销毁：连自动 patch 的暂存一起清掉。
    // 否则之后点开那个同名旧条目，创建态数据仍会被 maybeBootstrapCreatePatchPending
    // 消费，把本该属于新条目的信息写到旧条目上。
    function destroyOneshotCreateState() {
        clearCreateOneshotPayload();
        clearAutoPatchRawEditor();
        clearPendingCreateExport();
        clearAutoPatchTrackTable();
    }

    // 开始创建新条目时，清掉上一轮遗留的创建态 patch 暂存
    // （session / persist / 导出记录 / 策略），避免被后续条目消费。
    function clearStalePendingCreatePatch() {
        clearAutoPatchRawEditor();
        clearPendingCreateExport();
        clearAutoPatchTrackTable();
    }

    // 唯一允许写「待自动提交」暂存的入口：点「创建条目并补全」且条目真的建出来之后。
    // 所有记录当场就绑定到新条目 id，只有这个条目页会消费它，别的条目拿不到（防串号污染）；
    // 在这之前数据只存在于内存的一次性 payload 里，切到任何条目页都不会产生 patch。
    function commitCreatePatchForNewSubject(subjectId, payload) {
        const id = String(subjectId || "");
        if (!id || !payload) return;

        if (payload.noPatch || !payload.editor) {
            console.log("[staff-patch] create patch skipped: no patch data");
            return;
        }

        saveAutoPatchPolicy("selective", id);
        savePendingCreateExport(payload, id);
        saveAutoPatchRawEditor(payload.editor, id);
        saveAutoPatchTrackTable(payload.trackTable, id);
        saveAutoPatchContent(payload.patchContent, id);

        console.log("[staff-patch] create patch staged for subject", id);
    }

    function formatDuplicateHit(item) {
        const label =
            item.nameCn && item.nameCn !== item.name
                ? `${item.name} / ${item.nameCn}`
                : item.name;

        return `<a href="/subject/${encodeURIComponent(item.id)}" target="_blank" rel="noopener noreferrer">/subject/${escapeHtml(item.id)}</a>（${escapeHtml(label)}）`;
    }

    async function runCreateAndComplete(button) {
        if (button.dataset.staffCreateBusy === "1") return;

        button.dataset.staffCreateBusy = "1";
        button.disabled = true;

        const log = [];

        try {
            const form = getCreateSubjectForm();
            if (!form) {
                setCreateStatus("找不到创建表单，请刷新页面重试。", true);
                return;
            }

            let payload = resolveCreateOneshotPayload();

            if (!payload) {
                // 页面上没有粘贴内容时，点按钮属于用户手势，再试着直接从剪贴板读一次
                await readCreatePayloadFromClipboard();
                payload = resolveCreateOneshotPayload();
            }

            if (!payload) {
                setCreateStatus(
                    "没有待创建的数据：请先在工具里点「打包带走！」，或在页面任意位置 Ctrl+V（也可以粘贴到「在此处粘贴咏唱」输入框里）。",
                    true
                );
                return;
            }

            // 1) 回填表单（用户已经改过的字段会跳过，一切以表单里的实际内容为准）
            const { filled, kept } = await fillCreateFormFromPayload(form, payload);
            const titleInput = form.querySelector('[name="subject_title"]');
            const title = titleInput ? String(titleInput.value || "").trim() : "";

            if (!title) {
                setCreateStatus("创建表单没有标题，无法提交。", true);
                return;
            }

            setCreateStatus(
                `已回填：${filled.length ? escapeHtml(filled.join("、")) : "无"}` +
                    `${kept.length ? `；保留你已改过的：${escapeHtml(kept.join("、"))}` : ""}；正在查重…`
            );

            // 2) 查重：以表单里实际要提交的标题为准
            // 记下搜索返回过的全部 id：新条目不可能出现在这份名单里，
            // 所以提交后一旦落到名单内的 id，就是被重名重定向了。
            let knownIds = new Set();

            try {
                const candidates = await searchSameNameMusicSubjects(title);
                knownIds = new Set(candidates.map((item) => item.id));

                const duplicates = pickDuplicateCandidates(candidates, title);

                if (duplicates.length) {
                    destroyOneshotCreateState();
                    setCreateStatus(
                        `已存在同名条目，已中止，未提交、未上传任何内容：${duplicates
                            .slice(0, 3)
                            .map(formatDuplicateHit)
                            .join("；")}（本次数据已销毁，如需重来请重新打包）`,
                        true
                    );
                    return;
                }
            } catch (err) {
                setCreateStatus(
                    `查重失败：${escapeHtml(err?.message || String(err))}。为避免污染已有条目，本次未做任何提交；数据仍保留，稍后可再点一次。`,
                    true
                );
                return;
            }

            // 3) 提交创建
            setCreateStatus("查重通过，正在创建条目…");

            let responseUrl = "";
            try {
                responseUrl = await submitCreateSubjectForm(form);
            } catch (err) {
                setCreateStatus(
                    `创建请求失败：${escapeHtml(err?.message || String(err))}。数据仍保留，可修正表单后重试。`,
                    true
                );
                return;
            }

            const subjectId = parseSubjectIdFromUrl(responseUrl);
            if (!subjectId) {
                setCreateStatus(
                    `创建未成功（bgm 未跳转到新条目：${escapeHtml(responseUrl || "无返回地址")}）。数据仍保留，可修正表单后重试。`,
                    true
                );
                return;
            }

            // 4) 返回值校验：落在查重时已存在的条目上，说明是重名重定向
            if (knownIds.has(subjectId)) {
                destroyOneshotCreateState();
                setCreateStatus(
                    `被重定向到查重时已存在的条目 /subject/${escapeHtml(subjectId)}，已中止，未上传封面、未添加曲目（本次数据已销毁）。`,
                    true
                );
                return;
            }

            log.push(`条目 #${subjectId} 已创建`);

            // 到这里为止才算「用户点了按钮且条目真的建出来」：
            // 现在才把工具数据写进待自动提交的暂存，并直接绑定到这个新条目上
            commitCreatePatchForNewSubject(subjectId, payload);

            // 5) 逐碟添加曲目
            const discs = parseTrackTableToDiscs(payload.trackTable);

            for (let i = 0; i < discs.length; i++) {
                const item = discs[i];

                setCreateStatus(
                    `${escapeHtml(log.join("；"))}；正在添加 Disc${escapeHtml(item.disc)}（${item.titles.length} 首）…`
                );

                try {
                    await addSonglistForDisc(subjectId, item.disc, item.titles);
                    log.push(`Disc${item.disc} 曲目已添加`);
                } catch (err) {
                    console.warn("[staff-patch] create-complete songlist failed:", err);
                    log.push(`Disc${item.disc} 曲目失败（${err?.message || String(err)}）`);
                }

                if (i < discs.length - 1) {
                    await sleep(600);
                }
            }

            // 5.5) 章节注释：曲目刚添加完就补上（曲目表第 4 列 = 注释 / 外文标题）。
            //      放在关联人物/封面之前：它只依赖刚建好的章节，越早写越不容易被后面的
            //      失败步骤拖住；写的是同一个条目的章节列表，顺序上与前几步互不影响。
            await sleep(500);
            log.push(await fillEpCommentsForSubject(subjectId, payload.trackTable));

            // 6) 关联人物（站内关联）
            const relations = parseRelaTableToRelations(payload.relaTable);

            if (relations.length) {
                setCreateStatus(
                    `${escapeHtml(log.join("；"))}；正在添加关联人物（${relations.length} 条）…`
                );

                try {
                    await addSubjectPersonRelations(subjectId, relations);

                    const appearCount = relations.filter(
                        (item) => String(item.appearExpr || "").trim()
                    ).length;
                    log.push(
                        `关联人物 ${relations.length} 条已保存${appearCount ? `（${appearCount} 条带参与曲目）` : ""}`
                    );
                } catch (err) {
                    console.warn("[staff-patch] create-complete relations failed:", err);
                    log.push(`关联人物失败（${err?.message || String(err)}）`);
                }
            }

            // 7) 上传封面（放在最后：封面体积大、最容易撞上网络抖动，
            //    放最后可保证条目、曲目、关联人物都已先落库，不被它拖住）
            if (payload.cover) {
                setCreateStatus(`${escapeHtml(log.join("；"))}；正在上传封面…`);

                try {
                    await uploadCreateCover(subjectId, payload.cover);
                    log.push("封面已上传");
                } catch (err) {
                    console.warn("[staff-patch] create-complete cover upload failed:", err);
                    log.push(`封面失败（${err?.message || String(err)}）`);
                }
            }

            // 8) 消费掉一次性数据
            // PENDING_CREATE_EXPORT 保留：交给新条目页的自动 patch 流程（写完即被消费清除）
            clearCreateOneshotPayload();

            setCreateStatus(`${escapeHtml(log.join("；"))}；即将跳转到新条目…`);
            setTimeout(() => location.assign(`/subject/${subjectId}`), 900);
        } finally {
            button.dataset.staffCreateBusy = "";
            button.disabled = false;
        }
    }

    /** 视觉微调：按钮比旁边的提交按钮高多少 px（改成 0 就是严格等高） */
    const CREATE_BUTTON_HEIGHT_DELTA = 4;

    // <button> 与 <input> 默认不是同一套盒模型：就算字号、内边距写成一样，
    // 各主题下也会差 1~2px。直接量旁边提交按钮的实际高度，再加上微调量。
    function syncCreateButtonHeight(button, submitInput) {
        try {
            const refHeight = Math.round(submitInput.getBoundingClientRect().height);
            if (refHeight < 18 || refHeight > 48) return;

            const height = refHeight + CREATE_BUTTON_HEIGHT_DELTA;

            button.style.height = `${height}px`;
            button.style.paddingTop = "0";
            button.style.paddingBottom = "0";
            button.style.lineHeight = "1";
            button.style.display = "inline-flex";
            button.style.alignItems = "center";
            button.style.justifyContent = "center";

            console.log(
                "[staff-patch] create button height synced:",
                refHeight,
                "+",
                CREATE_BUTTON_HEIGHT_DELTA,
                "px"
            );
        } catch (err) {
            console.warn("[staff-patch] sync create button height failed:", err);
        }
    }

    const CREATE_COVER_CLASS = "bgm-staff-create-cover";
    const CREATE_COVER_TITLE_CLASS = "bgm-staff-create-cover-title";
    const CREATE_COVER_NOTE_CLASS = "bgm-staff-create-cover-note";
    let coverResizeBound = false;

    function findCreateReceiver() {
        return document.querySelector("#execwb-receiver, #bgm-btn-import, #manumatic-raw");
    }

    // 预览框宽度跟「咏唱」输入框对齐（它不一定占满容器宽度）
    function syncCreateCoverPreviewWidth() {
        const box = document.querySelector("." + CREATE_COVER_CLASS);
        if (!box) return;

        const receiver = findCreateReceiver();
        if (!receiver) {
            box.style.width = "";
            return;
        }

        const width = Math.round(receiver.getBoundingClientRect().width);
        box.style.width = width > 0 ? `${width}px` : "";
    }

    // 封面预览框：优先挂在「咏唱」输入框下面；没有咏唱框时退回到按钮下方的提示下面。
    function ensureCreateCoverPreview() {
        let box = document.querySelector("." + CREATE_COVER_CLASS);

        if (!box) {
            box = document.createElement("div");
            box.className = CREATE_COVER_CLASS;

            const title = document.createElement("div");
            title.className = CREATE_COVER_TITLE_CLASS;
            title.textContent = "专辑封面";

            const img = document.createElement("img");
            img.alt = "专辑封面";
            img.style.display = "none";

            const note = document.createElement("div");
            note.className = CREATE_COVER_NOTE_CLASS;
            note.textContent = "数据里没有封面";
            note.style.display = "none";

            box.appendChild(title);
            box.appendChild(img);
            box.appendChild(note);
        }

        const receiver = findCreateReceiver();

        if (receiver && receiver.parentElement && box.previousElementSibling !== receiver) {
            receiver.insertAdjacentElement("afterend", box);
        } else if (!box.isConnected) {
            const status = document.querySelector("." + CREATE_STATUS_CLASS);
            if (status && status.parentElement) {
                status.insertAdjacentElement("afterend", box);
            }
        }

        syncCreateCoverPreviewWidth();

        if (!coverResizeBound) {
            coverResizeBound = true;
            window.addEventListener("resize", syncCreateCoverPreviewWidth);
        }

        return box;
    }

    function renderCreateCoverPreview(payload) {
        if (!isCreateMusicPage()) return;

        const box = ensureCreateCoverPreview();
        const img = box.querySelector("img");
        const note = box.querySelector("." + CREATE_COVER_NOTE_CLASS);
        if (!img) return;

        const cover = payload && typeof payload.cover === "string" ? payload.cover : "";

        if (cover.startsWith("data:image/")) {
            img.src = cover;
            img.style.display = "";
            if (note) note.style.display = "none";
            box.style.display = "";
            return;
        }

        img.removeAttribute("src");
        img.style.display = "none";

        if (payload) {
            if (note) note.style.display = "";
            box.style.display = "";
            return;
        }

        box.style.display = "none";
    }

    // 直接从剪贴板读工具导出的 JSON（点按钮这类用户手势触发时，浏览器一般都放行）
    async function readCreatePayloadFromClipboard() {
        if (!navigator.clipboard || typeof navigator.clipboard.readText !== "function") {
            return null;
        }

        try {
            const text = await navigator.clipboard.readText();
            if (!text || text.trim().length < 2) return null;

            const payload = parsePatchPayloadFromReceiverValue(text);
            if (!payload) return null;

            console.log("[staff-patch] create-complete: payload read from clipboard");
            // 只进内存：跨页暂存要等点「创建条目并补全」并创建成功后才写
            saveCreateOneshotPayload(payload);
            return payload;
        } catch (err) {
            console.warn("[staff-patch] clipboard read failed:", err);
            return null;
        }
    }

    // 剪贴板取数三条路：①打开页面时静默试一次；②首次交互后再试（部分浏览器要求手势）；
    // ③任何位置 Ctrl+V 兜底（读剪贴板被拦时用）。
    function installCreateClipboardCapture() {
        if (!isCreateMusicPage()) return;
        if (document.documentElement.dataset.staffCreateClipboardHooked === "1") return;

        document.documentElement.dataset.staffCreateClipboardHooked = "1";

        const tryRead = () => {
            if (getCreateOneshotPayload()) return;
            readCreatePayloadFromClipboard();
        };

        tryRead();

        for (const type of ["pointerdown", "keydown", "focus"]) {
            window.addEventListener(type, tryRead, { once: true, passive: true });
        }

        document.addEventListener("paste", (e) => {
            try {
                const text = e.clipboardData?.getData("text/plain") || "";
                if (!text.trim()) return;

                const payload = parsePatchPayloadFromReceiverValue(text);
                if (payload) {
                    // 只进内存：跨页暂存要等点「创建条目并补全」并创建成功后才写
                    saveCreateOneshotPayload(payload);
                }
            } catch (err) {
                console.warn("[staff-patch] clipboard paste capture failed:", err);
            }
        }, true);
    }

    let autoFilledSignature = "";

    // 数据一到就自动回填创建表单（与点按钮时用的是同一套回填逻辑），
    // 这样不必等点按钮，也不依赖「咏唱」脚本先跑一遍。
    function scheduleCreateFormAutoFill(payload) {
        if (!isCreateMusicPage() || !payload) return;

        const signature = [
            payload.title || "",
            String(payload.infoBox || "").length,
            String(payload.description || "").length,
            String(payload.metaTags || "").length
        ].join("\u0001");

        if (signature === autoFilledSignature) return;

        const form = getCreateSubjectForm();
        if (!form) return; // 表单还没露面：留到按钮挂载时再补一次

        autoFilledSignature = signature;

        fillCreateFormFromPayload(form, payload, { backToNewbie: true })
            .then(({ filled, kept }) => {
                if (filled.length) {
                    console.log("[staff-patch] create form auto-filled:", filled.join("、"));
                }
                if (kept.length) {
                    console.log("[staff-patch] create form kept user edits:", kept.join("、"));
                }
            })
            .catch((err) => {
                console.warn("[staff-patch] create form auto-fill failed:", err);
            });
    }

    function installCreateAndCompleteButton() {
        if (!isCreateMusicPage()) return;
        if (document.documentElement.dataset.staffCreateButtonInstalled === "1") return;

        let tries = 0;

        const tryInject = () => {
            if (document.getElementById(CREATE_BUTTON_ID)) {
                document.documentElement.dataset.staffCreateButtonInstalled = "1";
                return true;
            }

            const form = getCreateSubjectForm();
            const submitInput = form ? findCreateSubmitInput(form) : null;
            if (!form || !submitInput) return false;

            const button = document.createElement("button");
            button.type = "button";
            button.id = CREATE_BUTTON_ID;
            // 复用 bgm 自己的按钮样式，观感与旁边的「提交」完全一致
            button.className = "inputBtn";
            button.textContent = CREATE_BUTTON_LABEL;
            button.title = "把工具导出的信息回填到表单，然后创建条目、上传封面、添加曲目并关联人物";
            button.addEventListener("click", () => {
                runCreateAndComplete(button).catch((err) => {
                    console.warn("[staff-patch] create-complete failed:", err);
                    setCreateStatus(`出错：${escapeHtml(err?.message || String(err))}`, true);
                });
            });

            syncCreateButtonHeight(button, submitInput);

            submitInput.insertAdjacentElement("afterend", button);

            const status = document.createElement("span");
            status.className = CREATE_STATUS_CLASS;
            status.textContent = getCreateOneshotPayload() ? CREATE_READY_HINT : CREATE_WAITING_HINT;
            button.insertAdjacentElement("afterend", status);

            // 先把封面预览槽位建好（没有封面时是隐藏的）
            renderCreateCoverPreview(getCreateOneshotPayload());

            // 数据比表单先到的情况：这里再补一次自动回填
            scheduleCreateFormAutoFill(getCreateOneshotPayload());

            // 字体/主题样式可能晚一步生效，插进 DOM 后再校一次高度
            requestAnimationFrame(() => syncCreateButtonHeight(button, submitInput));
            setTimeout(() => syncCreateButtonHeight(button, submitInput), 600);

            document.documentElement.dataset.staffCreateButtonInstalled = "1";
            console.log("[staff-patch] create-complete button installed");
            return true;
        };

        if (tryInject()) return;

        // 表单可能晚于本脚本出现，晚到就重试一段时间
        const timer = setInterval(() => {
            tries++;
            if (tryInject() || tries >= 120) {
                clearInterval(timer);
            }
        }, 500);
    }

    function installEditDetailAutoSubmitHook() {
        if (!isEditDetailPage()) return;

        const form = document.querySelector('form[action*="/edit_detail"]');
        if (!form || form.dataset.staffPatchEditDetailHooked === "1") return;

        form.dataset.staffPatchEditDetailHooked = "1";

        form.addEventListener("submit", () => {
            const subjectId = getSubjectId();
            if (!subjectId) return;

            captureRawEditorFromKnownReceivers();

            if (getAutoPatchPolicy(subjectId) === "none") {
                console.log("[staff-patch] edit_detail submit skipped: selective patch is empty");
                return;
            }

            mergeAutoPatchTask({
                subjectId,
                needsEditDetailSync: true,
                lastSource: "edit-detail-save"
            });

            // notifyAutoPatchTask("更新记录啦", subjectId);

            setTimeout(() => {
                tryFlushAutoPatchTask(subjectId).catch(err => {
                    console.warn("[staff-patch] edit_detail flush failed:", err);
                });
            }, 0);
        });
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

    function buildRoleDataFromRows(rows) {
        const roleData = {};
        const extras = [];

        for (const row of rows) {
            const roles = resolveLabelToRoles(row.label);
            if (!roles) {
                extras.push(row);
                continue;
            }

            const items = parseExistingRoleItems(row.nodes);

            /* ---------X-子角色 前缀职位--------- */
            // 页面本身写了 乐器-Guitar / 设计-Web 时，把子角色标记到条目上
            const prefixed = splitPrefixedRoleLabel(row.label);
            if (prefixed) {
                items.forEach(item => { item.subRole = prefixed.sub; });
            }
            /* ---------X-子角色 前缀职位--------- */

            for (const roleKey of roles) {
                roleData[roleKey] = items;
            }
        }

        return { roleData, extras, indent: rows[0]?.indent || "　　　　" };
    }

    function getSubjectAliasRegistryKey(roleKey, aliasText) {
        return `${roleKey}::${normalizeAliasKey(aliasText)}`;
    }

    function extractAliasResolutionFromItem(item) {
        const segs = item?.segments || [];

        // 1) 已关联的普通单人显示：凍傷のエト
        //    内部会是 [ entity(ref=p:123, text="凍傷のエト") ]
        if (
            segs.length === 1 &&
            segs[0]?.kind === "entity" &&
            segs[0]?.ref &&
            /^p:\d+$/.test(segs[0].ref)
        ) {
            return {
                aliasText: segs[0].text || "",
                personRef: segs[0].ref || null,
                personText: segs[0].text || ""
            };
        }

        // 2) 已关联的乐器单人显示：凍傷のエト (Bass)
        //    内部会是 [ entity(ref), text(" (Bass)") ]
        if (
            segs.length === 2 &&
            segs[0]?.kind === "entity" &&
            segs[0]?.ref &&
            /^p:\d+$/.test(segs[0].ref) &&
            segs[1]?.kind === "text" &&
            /^\s*\(.+\)\s*$/.test(segs[1].text || "")
        ) {
            return {
                aliasText: segs[0].text || "",
                personRef: segs[0].ref || null,
                personText: segs[0].text || ""
            };
        }

        // 3) 已关联的 CV 显示：角色(CV:凍傷のエト)
        //    内部会是 [ text("角色(CV:"), entity(ref), text(")") ]
        if (
            segs.length === 3 &&
            segs[0]?.kind === "text" &&
            parseCvPrefixText(segs[0].text || "") &&
            segs[1]?.kind === "entity" &&
            segs[1]?.ref &&
            /^p:\d+$/.test(segs[1].ref) &&
            segs[2]?.kind === "text" &&
            segs[2].text === ")"
        ) {
            return {
                aliasText: segs[1].text || "",
                personRef: segs[1].ref || null,
                personText: segs[1].text || ""
            };
        }

        // 4) alias_person: 别名 (真实人物)
        if (
            segs.length === 4 &&
            segs[0]?.kind === "entity" &&
            segs[1]?.kind === "text" &&
            segs[1].text === " (" &&
            segs[2]?.kind === "entity" &&
            segs[3]?.kind === "text" &&
            segs[3].text === ")"
        ) {
            return {
                aliasText: segs[0].text || "",
                personRef: segs[2].ref || null,
                personText: segs[2].text || ""
            };
        }

        // 5) alias_instrument_credit: 别名 (真实人物) (Inst)
        if (
            segs.length === 4 &&
            segs[0]?.kind === "entity" &&
            segs[1]?.kind === "text" &&
            segs[1].text === " (" &&
            segs[2]?.kind === "entity" &&
            segs[3]?.kind === "text" &&
            /^\)\s*\(.+\)\s*$/.test(segs[3].text || "")
        ) {
            return {
                aliasText: segs[0].text || "",
                personRef: segs[2].ref || null,
                personText: segs[2].text || ""
            };
        }

        return null;
    }

    function rebuildSubjectAliasRegistry() {
        const registry = {};

        for (const [, base] of STAFF_PATCH_RUNTIME.baseTrackState.entries()) {
            const parsed = buildRoleDataFromRows(cloneParsedRows(base.rows || []));
            const roleData = parsed.roleData || {};

            for (const [roleKey, items] of Object.entries(roleData)) {
                for (const item of items || []) {
                    const resolved = extractAliasResolutionFromItem(item);
                    if (!resolved) continue;

                    const key = getSubjectAliasRegistryKey(roleKey, resolved.aliasText);
                    registry[key] = {
                        ref: resolved.personRef || null,
                        text: resolved.personText || ""
                    };
                }
            }
        }

        STAFF_PATCH_RUNTIME.subjectAliasRegistry = registry;
    }

    function getSubjectAliasResolution(roleKey, aliasText) {
        const key = getSubjectAliasRegistryKey(roleKey, aliasText);
        return STAFF_PATCH_RUNTIME.subjectAliasRegistry[key] || null;
    }

    function normalizeRoleItems(items) {
        return JSON.stringify(items);
    }

    function itemsHaveSubRole(items) {
        return (items || []).some(item => item && item.subRole);
    }

    function mergeRolesForRender(roleData) {
        const groups = [];
        const seen = new Set();

        for (const roleKey of ROLE_ORDER) {
            const items = roleData[roleKey];
            if (!items || !items.length || seen.has(roleKey)) continue;

            /* ---------X-子角色 前缀职位--------- */
            if (roleKey === "instrument" || (PREFIXABLE_ROLE_KEYS.has(roleKey) && itemsHaveSubRole(items))) {
                groups.push({ roles: [roleKey], items });
                seen.add(roleKey);
                continue;
            }
            /* ---------X-子角色 前缀职位--------- */

            const signature = normalizeRoleItems(items);
            const mergedRoles = [roleKey];
            seen.add(roleKey);

            for (const otherRole of ROLE_ORDER) {
                if (otherRole === "instrument" || otherRole === roleKey || seen.has(otherRole)) continue;
                const otherItems = roleData[otherRole];
                if (!otherItems || !otherItems.length) continue;
                if (PREFIXABLE_ROLE_KEYS.has(otherRole) && itemsHaveSubRole(otherItems)) continue;

                if (normalizeRoleItems(otherItems) === signature) {
                    mergedRoles.push(otherRole);
                    seen.add(otherRole);
                }
            }

            groups.push({ roles: mergedRoles, items });
        }

        /* ---------自定义职位--------- */
        // 追加 ROLE_ORDER 之外的角色，custom-* 也会在这里显示出来
        const restRoleKeys = Object.keys(roleData || {})
            .filter(roleKey => !seen.has(roleKey) && Array.isArray(roleData[roleKey]) && roleData[roleKey].length)
            .sort((a, b) => {
                const aCustom = isCustomRoleKey(a);
                const bCustom = isCustomRoleKey(b);
                if (aCustom !== bCustom) return aCustom ? -1 : 1;
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
        // return roleKeys.map(k => ROLE_LABELS[k]).join("、");
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

    function createLinkedOrText(seg, globalMap, context = null) {
        if (seg.kind === "text") {
            return document.createTextNode(seg.text);
        }

        const unlinkContext =
            context && typeof context.onToggleUnlink === "function" ? context : null;

        // 已去除关联：显示为可点击的划线文本，便于点回来
        if (seg.unlinked) {
            const span = document.createElement("span");
            span.className = "bgm-staff-fix-ref-unlinked";
            span.textContent = seg.text;

            if (unlinkContext) {
                span.title = "点击恢复关联";
                span.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    unlinkContext.onToggleUnlink(unlinkContext, seg);
                });
            }

            return span;
        }

        if (seg.noLink) {
            return document.createTextNode(seg.text);
        }

        if (seg.ref && /^p:\d+$/.test(seg.ref)) {
            const a = document.createElement("a");
            a.href = `/person/${seg.ref.replace(/^p:/, "")}`;
            a.className = "l";
            a.textContent = seg.text;

            if (unlinkContext && STAFF_PATCH_RUNTIME.unlinkMode) {
                a.classList.add("bgm-staff-fix-ref-toggle");
                a.title = "点击去除关联";

                a.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    unlinkContext.onToggleUnlink(unlinkContext, seg);
                });
            }

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

    function renderItems(items, globalMap, context = null) {
        const frag = document.createDocumentFragment();

        items.forEach((item, idx) => {
            const itemContext = context ? { ...context, item } : null;

            for (const seg of item.segments) {
                frag.appendChild(createLinkedOrText(seg, globalMap, itemContext));
            }
            if (idx < items.length - 1) {
                frag.appendChild(document.createTextNode("、"));
            }
        });

        return frag;
    }

    function normalizeCompareText(text) {
        return (text || "")
            .trim()
            .normalize("NFKC")
            .replace(/\s+/g, " ");
    }

    function getComparableUnitsForItem(item, roleKey) {
        const segs = item?.segments || [];
        const units = [];

        // CV: 角色(CV:某人)
        if (
            segs.length === 3 &&
            segs[0]?.kind === "text" &&
            segs[1]?.kind === "entity" &&
            segs[2]?.kind === "text" &&
            segs[2].text === ")"
        ) {
            const parsedCv = parseCvPrefixText(segs[0].text || "");
            if (parsedCv) {
                const character = normalizeCompareText(parsedCv.character || "");
                const cvName = normalizeCompareText(segs[1].text || "");
                if (character && cvName) {
                    units.push(`cv|${character}|${cvName}`);
                }
                return units;
            }
        }

        // 乐器：优先按 “乐器种类 + 第一实体名” 比较
        if (roleKey === "instrument") {
            const lastText = segs[segs.length - 1]?.kind === "text" ? segs[segs.length - 1].text || "" : "";
            const instMatch = lastText.match(/\((.+)\)\s*$/);
            const firstEntity = segs.find(seg => seg.kind === "entity" && seg.text);
            if (instMatch && firstEntity) {
                const inst = normalizeCompareText(instMatch[1]);
                const name = normalizeCompareText(firstEntity.text || "");
                if (inst && name) {
                    units.push(`inst|${inst}|${name}`);
                }
                return units;
            }
        }

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
            if (alias) units.push(`${roleKey}|${alias}`);
            return units;
        }

        // alias_instrument_credit: 别名 (真实人物) (Inst)
        if (
            roleKey === "instrument" &&
            segs.length === 4 &&
            segs[0]?.kind === "entity" &&
            segs[1]?.kind === "text" &&
            segs[1].text === " (" &&
            segs[2]?.kind === "entity" &&
            segs[3]?.kind === "text" &&
            /^\)\s*\(.+\)\s*$/.test(segs[3].text || "")
        ) {
            const instMatch = (segs[3].text || "").match(/^\)\s*\((.+)\)\s*$/);
            const alias = normalizeCompareText(segs[0].text || "");
            const inst = normalizeCompareText(instMatch?.[1] || "");
            if (alias && inst) units.push(`inst|${inst}|${alias}`);
            return units;
        }

        // 普通情况：
        // - 单人：一条 unit
        // - 组合显示（如 Gyr0 & KBSNK）：按每个 entity 展开
        for (const seg of segs) {
            if (seg.kind === "entity" && seg.text) {
                const name = normalizeCompareText(seg.text);
                if (name) units.push(`${roleKey}|${name}`);
            }
        }

        return units;
    }

    function buildComparableUnitSet(items, roleKey) {
        const set = new Set();

        for (const item of items || []) {
            for (const unit of getComparableUnitsForItem(item, roleKey)) {
                set.add(unit);
            }
        }

        return set;
    }

    function filterPatchItemsAgainstBase(roleKey, patchItems, baseItems) {
        if (!Array.isArray(patchItems) || !patchItems.length) return [];
        if (!Array.isArray(baseItems) || !baseItems.length) return patchItems.slice();

        const baseUnitSet = buildComparableUnitSet(baseItems, roleKey);

        return patchItems.filter(item => {
            const units = getComparableUnitsForItem(item, roleKey);
            if (!units.length) return true;

            // 该 item 的所有语义单元都已存在于当前显示，则跳过
            return !units.every(unit => baseUnitSet.has(unit));
        });
    }

    function diffPatchMapAgainstBaseDisplay(patchMap) {
        const result = {};

        for (const [trackKey, roleMap] of Object.entries(patchMap || {})) {
            const base = getOrBuildBaseTrackState(trackKey);

            let baseRoleData = {};
            if (base?.rows?.length) {
                baseRoleData = buildRoleDataFromRows(cloneParsedRows(base.rows)).roleData || {};
            }

            let hasAny = false;
            const nextRoleMap = {};

            for (const [roleKey, patchItems] of Object.entries(roleMap || {})) {
                const baseItems = baseRoleData[roleKey] || [];
                const remaining = filterPatchItemsAgainstBase(roleKey, patchItems, baseItems);

                if (remaining.length) {
                    nextRoleMap[roleKey] = remaining;
                    hasAny = true;
                }
            }

            if (hasAny) {
                result[trackKey] = nextRoleMap;
            }
        }

        return result;
    }

    function cloneItem(item) {
        return {
            segments: (item?.segments || []).map(seg => ({ ...seg }))
        };
    }

    function cloneItems(items) {
        return (items || []).map(cloneItem);
    }

    function normalizeCompareName(text) {
        return (text || "")
            .trim()
            .normalize("NFKC")
            .replace(/\s+/g, " ");
    }

    function flattenEntityNames(items) {
        const out = [];
        for (const item of items || []) {
            for (const seg of item?.segments || []) {
                if (seg.kind === "entity" && seg.text) {
                    out.push(normalizeCompareName(seg.text));
                }
            }
        }
        return out;
    }

    function isWeakPlainSingleEntityItem(item) {
        const segs = item?.segments || [];
        const entitySegs = segs.filter(seg => seg.kind === "entity");

        if (entitySegs.length !== 1) return false;
        if (entitySegs[0].ref) return false;

        return segs.every(seg => {
            if (seg.kind === "entity") return true;
            return !seg.text || !seg.text.trim();
        });
    }

    function baseItemsHaveCompositeFormatting(items) {
        return (items || []).some(item => {
            const segs = item?.segments || [];
            const entityCount = segs.filter(seg => seg.kind === "entity").length;

            if (entityCount > 1) return true;

            return segs.some(seg =>
                seg.kind === "text" &&
                /[&＆＋+×xX\/／・]/.test(seg.text || "")
            );
        });
    }

    function maybePreferBaseDisplayItems(patchItems, baseItems) {
        if (!Array.isArray(patchItems) || !patchItems.length) return patchItems || [];
        if (!Array.isArray(baseItems) || !baseItems.length) return patchItems;

        // 只对“弱输入”做保留显示组件结果
        if (!patchItems.every(isWeakPlainSingleEntityItem)) {
            return patchItems;
        }

        if (!baseItemsHaveCompositeFormatting(baseItems)) {
            return patchItems;
        }

        const patchNames = flattenEntityNames(patchItems);
        const baseNames = flattenEntityNames(baseItems);

        if (!patchNames.length || patchNames.length !== baseNames.length) {
            return patchItems;
        }

        for (let i = 0; i < patchNames.length; i++) {
            if (patchNames[i] !== baseNames[i]) {
                return patchItems;
            }
        }

        return cloneItems(baseItems);
    }

    function reconcilePatchMapWithBaseDisplay(patchMap) {
        const out = {};

        for (const [trackKey, roleMap] of Object.entries(patchMap || {})) {
            let baseRows = [];

            if (trackKey === EPINFO_TRACK_KEY) {
                const base = getOrBuildBaseEpinfoState();
                baseRows = base?.rows || [];
            } else {
                const base = getOrBuildBaseTrackState(trackKey);
                baseRows = base?.rows || [];
            }

            let baseRoleData = {};
            if (baseRows.length) {
                baseRoleData = buildRoleDataFromRows(cloneParsedRows(baseRows)).roleData || {};
            }

            out[trackKey] = {};

            for (const [roleKey, items] of Object.entries(roleMap || {})) {
                const baseItems = baseRoleData[roleKey] || [];
                out[trackKey][roleKey] = maybePreferBaseDisplayItems(items, baseItems);
            }
        }

        return out;
    }

    function buildPatchMapFromCurrentDisplay() {
        const trackRows = collectTrackRows();
        if (!trackRows.size) return {};

        snapshotBaseTrackState(trackRows);
        snapshotBaseEpinfoState();
        rebuildSubjectAliasRegistry();

        const patchMap = {};

        const globalBase = STAFF_PATCH_RUNTIME.baseEpinfoState;
        if (globalBase?.rows?.length) {
            const parsed = buildRoleDataFromRows(cloneParsedRows(globalBase.rows || []));
            const roleData = parsed.roleData || {};
            const nextRoleMap = {};

            for (const [roleKey, items] of Object.entries(roleData)) {
                if (!Array.isArray(items) || !items.length) continue;
                nextRoleMap[roleKey] = cloneItems(items);
            }

            if (Object.keys(nextRoleMap).length) {
                patchMap[EPINFO_TRACK_KEY] = nextRoleMap;
            }
        }

        for (const [trackKey, base] of STAFF_PATCH_RUNTIME.baseTrackState.entries()) {
            const parsed = buildRoleDataFromRows(cloneParsedRows(base.rows || []));
            const roleData = parsed.roleData || {};
            const nextRoleMap = {};

            for (const [roleKey, items] of Object.entries(roleData)) {
                if (!Array.isArray(items) || !items.length) continue;
                nextRoleMap[roleKey] = cloneItems(items);
            }

            if (Object.keys(nextRoleMap).length) {
                patchMap[trackKey] = nextRoleMap;
            }
        }

        return patchMap;
    }

    function patchMapsEqual(a, b) {
        return JSON.stringify(a || {}) === JSON.stringify(b || {});
    }

    function compareTrackKey(a, b) {
        const [discA, trackA] = String(a).split(".").map(n => Number(n) || 0);
        const [discB, trackB] = String(b).split(".").map(n => Number(n) || 0);

        if (discA !== discB) return discA - discB;
        return trackA - trackB;
    }

    function cloneRoleData(roleData = {}) {
        const out = {};
        for (const [roleKey, items] of Object.entries(roleData)) {
            out[roleKey] = Array.isArray(items) ? items.slice() : items;
        }
        return out;
    }

    function buildPreviewBlocks(beforePatchMap, afterPatchMap) {
        const blocks = [];

        const allTrackKeys = new Set([
            ...Object.keys(beforePatchMap || {}),
            ...Object.keys(afterPatchMap || {})
        ]);

        // 提交数据里没有条目级信息时，页面显示的条目级信息也要进预览
        if (!allTrackKeys.has(EPINFO_TRACK_KEY)) {
            const epinfoBase = getOrBuildBaseEpinfoState();
            if (epinfoBase?.rows?.length) {
                allTrackKeys.add(EPINFO_TRACK_KEY);
            }
        }

        const sortedTrackKeys = Array.from(allTrackKeys).sort((a, b) => {
            if (a === EPINFO_TRACK_KEY) return -1;
            if (b === EPINFO_TRACK_KEY) return 1;
            return compareTrackKey(a, b);
        });

        for (const trackKey of sortedTrackKeys) {
            const base =
                trackKey === EPINFO_TRACK_KEY
                    ? getOrBuildBaseEpinfoState()
                    : getOrBuildBaseTrackState(trackKey);

            console.log("[staff-patch] preview trackKey =", trackKey, "base =", base);

            if (!base) continue;

            const parsedBase = base.rows && base.rows.length
                ? buildRoleDataFromRows(cloneParsedRows(base.rows))
                : { roleData: {}, extras: [], indent: "　　　　" };

            const baseRoleData = parsedBase.roleData || {};

            const beforeRoleData = cloneRoleData(baseRoleData);
            // 修改后 = 页面现状 + 提交数据覆盖（提交数据没有的曲目/条目级信息保持原样）
            const afterRoleData = cloneRoleData(baseRoleData);

            const beforeTrackPatch = beforePatchMap?.[trackKey] || {};
            const afterTrackPatch = afterPatchMap?.[trackKey] || {};

            for (const [roleKey, items] of Object.entries(beforeTrackPatch)) {
                if (!Array.isArray(items) || !items.length) continue;
                beforeRoleData[roleKey] = items;
            }

            for (const [roleKey, items] of Object.entries(afterTrackPatch)) {
                if (!Array.isArray(items) || !items.length) continue;
                afterRoleData[roleKey] = items;
            }

            const beforeGroups = mergeRolesForRender(beforeRoleData);
            const afterGroups = mergeRolesForRender(afterRoleData);

            if (!beforeGroups.length && !afterGroups.length) continue;

            blocks.push({
                title: trackKey === EPINFO_TRACK_KEY ? "条目级信息" : base.title,
                trackKey,
                beforeGroups,
                afterGroups
            });
        }

        return blocks;
    }

    function renderPreview(blocks, container, context = null) {
        container.innerHTML = "";

        if (!blocks.length) {
            container.textContent = "输入参与信息后，这里会显示按当前曲目表计算出的总体预览。";
            return;
        }

        function renderGroupList(groups, groupContext) {
            const ep = document.createElement("div");
            ep.className = "epinfo";

            for (const group of groups || []) {
                ep.appendChild(document.createTextNode("　　　　"));

                const labelSpan = document.createElement("span");
                labelSpan.className = "tip";
                labelSpan.textContent = getMergedRoleLabel(group.roles);
                ep.appendChild(labelSpan);

                ep.appendChild(document.createTextNode("："));

                const itemContext = groupContext
                    ? { ...groupContext, roleKeys: group.roles }
                    : null;

                ep.appendChild(renderItems(group.items, STAFF_PATCH_RUNTIME.globalMap || new Map(), itemContext));
                ep.appendChild(document.createElement("br"));
            }

            return ep;
        }

        for (const block of blocks) {
            const wrap = document.createElement("div");
            wrap.className = "bgm-staff-fix-preview-track";

            const title = document.createElement("div");
            title.className = "bgm-staff-fix-preview-title";
            title.textContent = `${block.trackKey} ${block.title}`;
            wrap.appendChild(title);

            const afterContext = context ? { ...context, trackKey: block.trackKey } : null;

            if (STAFF_PATCH_RUNTIME.previewCompareMode) {
                const beforeSection = document.createElement("div");
                beforeSection.className = "bgm-staff-fix-preview-section";

                const beforeTitle = document.createElement("div");
                beforeTitle.className = "bgm-staff-fix-preview-section-title";
                beforeTitle.textContent = "修改前";
                beforeSection.appendChild(beforeTitle);
                beforeSection.appendChild(renderGroupList(block.beforeGroups, null));

                const afterSection = document.createElement("div");
                afterSection.className = "bgm-staff-fix-preview-section";

                const afterTitle = document.createElement("div");
                afterTitle.className = "bgm-staff-fix-preview-section-title";
                afterTitle.textContent = "修改后";
                afterSection.appendChild(afterTitle);
                afterSection.appendChild(renderGroupList(block.afterGroups, afterContext));

                wrap.appendChild(beforeSection);
                wrap.appendChild(afterSection);
            } else {
                wrap.appendChild(renderGroupList(block.afterGroups, afterContext));
            }

            container.appendChild(wrap);
        }
    }

    function getRelatedPersonTypeMap() {
        const out = {};
        const list = Array.isArray(window.crtTypeList) ? window.crtTypeList : [];

        for (const item of list) {
            const candidates = [item?.en, item?.cn, item?.jp]
                .map(v => String(v || "").trim())
                .filter(Boolean);

            let roleKey = null;
            for (const candidate of candidates) {
                const mapped = RELATED_PERSON_ROLE_LABEL_MAP[candidate] || RELATED_PERSON_ROLE_LABEL_MAP[candidate.toLowerCase()];
                if (mapped) {
                    roleKey = mapped;
                    break;
                }
            }

            if (roleKey && item?.id != null) {
                out[String(item.id)] = roleKey;
            }
        }

        if (!Object.keys(out).length) {
            out["3001"] = "artist";
            out["3002"] = "producer";
            out["3004"] = "label";
            out["3003"] = "composer";
            out["3006"] = "lyricist";
            out["3008"] = "arranger";
            out["3009"] = "illustrator";
            out["3014"] = "instrument";
            out["3015"] = "vocal";
            out["3022"] = "chorus";
            out["3007"] = "recording";
            out["3013"] = "mixing";
            out["3012"] = "mastering";
            out["3023"] = "design"
        }

        return out;
    }

    function collectRelatedPersonEntriesFromPage() {
        const form = document.querySelector('form[name="add_related"][action*="/add_related/person"]');
        const list = document.querySelector("#crtRelateSubjects");
        if (!form || !list) return [];

        const roleTypeMap = getRelatedPersonTypeMap();
        const entries = [];

        for (const li of Array.from(list.querySelectorAll(':scope > li'))) {
            const personInput = li.querySelector('input[name$="[prsn_id]"]');
            const roleSelect = li.querySelector('select[name$="[prsnPos]"]');
            const appearInput = li.querySelector('input[name$="[appear_eps]"]');
            const titleLink = li.querySelector('p.title a[href*="/person/"]');
            const applyCheckbox = li.querySelector('.relate-checkbox');

            if (applyCheckbox && !applyCheckbox.checked) continue;
            if (!personInput || !roleSelect || !titleLink) continue;

            const personId = String(personInput.value || "").trim();
            const roleId = String(roleSelect.value || "").trim();
            const roleKey = roleTypeMap[roleId] || null;
            if (!personId || !roleKey) continue;

            const personName = normalizeCompareText(titleLink.textContent || "");
            if (!personName) continue;

            const appearText = String(appearInput?.value || "").trim();
            const trackKeys = appearText ? expandTrackExpr(appearText) : null;

            entries.push({ roleKey, personId, personName, trackKeys });
        }

        return entries;
    }

    function getComparableNamesForRelatedItem(item) {
        const segs = item?.segments || [];
        const names = [];

        // alias_person / alias_instrument_credit：外层和括号内都纳入匹配
        if (
            segs.length === 4 &&
            segs[0]?.kind === "entity" &&
            segs[1]?.kind === "text" &&
            segs[1].text === " (" &&
            segs[2]?.kind === "entity" &&
            segs[3]?.kind === "text" &&
            (segs[3].text === ")" || /^\)\s*\(.+\)\s*$/.test(segs[3].text || ""))
        ) {
            const outer = normalizeCompareText(segs[0].text || "");
            const inner = normalizeCompareText(segs[2].text || "");

            if (outer) names.push(outer);
            if (inner && !names.includes(inner)) names.push(inner);

            return names;
        }

        // CV：只认中间那个 CV 真人
        if (
            segs.length === 3 &&
            segs[0]?.kind === "text" &&
            parseCvPrefixText(segs[0].text || "") &&
            segs[1]?.kind === "entity" &&
            segs[2]?.kind === "text" &&
            segs[2].text === ")"
        ) {
            const normalized = normalizeCompareText(segs[1].text || "");
            return normalized ? [normalized] : [];
        }

        // 普通 mixed / 单人：保留所有 entity 名
        for (const seg of segs) {
            if (seg?.kind === "entity" && seg.text) {
                const normalized = normalizeCompareText(seg.text);
                if (normalized && !names.includes(normalized)) {
                    names.push(normalized);
                }
            }
        }

        return names;
    }

    function applyRelatedRefToItem(item, ref, targetName = "") {
        const segs = item?.segments || [];
        const normalizedTarget = normalizeCompareText(targetName || "");

        // 1) 整个 item 本身就是 alias_person / alias_instrument_credit
        if (
            segs.length === 4 &&
            segs[0]?.kind === "entity" &&
            segs[1]?.kind === "text" &&
            segs[1].text === " (" &&
            segs[2]?.kind === "entity" &&
            segs[3]?.kind === "text" &&
            (segs[3].text === ")" || /^\)\s*\(.+\)\s*$/.test(segs[3].text || ""))
        ) {
            const outerName = normalizeCompareText(segs[0].text || "");
            const innerName = normalizeCompareText(segs[2].text || "");

            if (!normalizedTarget || innerName === normalizedTarget) {
                segs[2].ref = ref;
                segs[0].ref = null;
                return true;
            }

            if (outerName === normalizedTarget) {
                segs[0].ref = ref;
                segs[2].ref = null;
                return true;
            }

            return false;
        }

        // 2) CV：只改中间那个 CV 真人
        if (
            segs.length === 3 &&
            segs[0]?.kind === "text" &&
            parseCvPrefixText(segs[0].text || "") &&
            segs[1]?.kind === "entity" &&
            segs[2]?.kind === "text" &&
            segs[2].text === ")"
        ) {
            const cvName = normalizeCompareText(segs[1].text || "");
            if (!normalizedTarget || cvName === normalizedTarget) {
                segs[1].ref = ref;
                return true;
            }
            return false;
        }

        // 3) mixed item 内部出现的局部 alias 结构：
        //    entity + " (" + entity + ")" / ") (Inst)"
        //    命中哪一侧，就给哪一侧写 ref，并清掉另一侧
        for (let i = 0; i <= segs.length - 4; i++) {
            if (
                segs[i]?.kind === "entity" &&
                segs[i + 1]?.kind === "text" &&
                segs[i + 1].text === " (" &&
                segs[i + 2]?.kind === "entity" &&
                segs[i + 3]?.kind === "text" &&
                (
                    segs[i + 3].text === ")" ||
                    /^\)\s*\(.+\)\s*$/.test(segs[i + 3].text || "") ||
                    /^\)\)+\s*$/.test(segs[i + 3].text || "")
                )
            ) {
                const outerName = normalizeCompareText(segs[i].text || "");
                const innerName = normalizeCompareText(segs[i + 2].text || "");

                if (normalizedTarget && outerName === normalizedTarget) {
                    segs[i].ref = ref;
                    segs[i + 2].ref = null;
                    return true;
                }

                if (normalizedTarget && innerName === normalizedTarget) {
                    segs[i + 2].ref = ref;
                    segs[i].ref = null;
                    return true;
                }
            }
        }

        // 4) 普通情况：只改命中的 entity
        for (const seg of segs) {
            if (seg?.kind !== "entity") continue;

            const name = normalizeCompareText(seg.text || "");
            if (normalizedTarget && name !== normalizedTarget) continue;

            seg.ref = ref;
            return true;
        }

        return false;
    }

    function applyRelatedPersonEntriesToPatchMap(patchMap, entries) {
        let changed = false;

        for (const entry of entries || []) {
            const targetTrackKeys = entry.trackKeys && entry.trackKeys.length
                ? entry.trackKeys
                : Object.keys(patchMap || {});

            for (const trackKey of targetTrackKeys) {
                const items = patchMap?.[trackKey]?.[entry.roleKey];
                if (!Array.isArray(items) || !items.length) continue;

                for (const item of items) {
                    const names = getComparableNamesForRelatedItem(item);
                    if (!names.includes(entry.personName)) continue;

                    const ref = `p:${entry.personId}`;
                    const segs = item?.segments || [];
                    let matchedRef = null;

                    // alias_person / alias_instrument_credit：外层和括号内都支持
                    if (
                        segs.length === 4 &&
                        segs[0]?.kind === "entity" &&
                        segs[1]?.kind === "text" &&
                        segs[1].text === " (" &&
                        segs[2]?.kind === "entity" &&
                        segs[3]?.kind === "text" &&
                        (segs[3].text === ")" || /^\)\s*\(.+\)\s*$/.test(segs[3].text || ""))
                    ) {
                        const outerName = normalizeCompareText(segs[0].text || "");
                        const innerName = normalizeCompareText(segs[2].text || "");

                        if (outerName === entry.personName) {
                            matchedRef = segs[0].ref || null;
                        } else if (innerName === entry.personName) {
                            matchedRef = segs[2].ref || null;
                        }
                    }
                    // CV：看中间那个真人位
                    else if (
                        segs.length === 3 &&
                        segs[0]?.kind === "text" &&
                        parseCvPrefixText(segs[0].text || "") &&
                        segs[1]?.kind === "entity" &&
                        segs[2]?.kind === "text" &&
                        segs[2].text === ")"
                    ) {
                        const cvName = normalizeCompareText(segs[1].text || "");
                        if (cvName === entry.personName) {
                            matchedRef = segs[1].ref || null;
                        }
                    }
                    // 普通情况：找命中的 entity
                    else {
                        const matchedSeg = segs.find(seg =>
                            seg?.kind === "entity" &&
                            normalizeCompareText(seg.text || "") === entry.personName
                        );
                        matchedRef = matchedSeg?.ref || null;
                    }

                    let needsPairCleanup = false;

                    for (let i = 0; i <= segs.length - 4; i++) {
                        if (
                            segs[i]?.kind === "entity" &&
                            segs[i + 1]?.kind === "text" &&
                            segs[i + 1].text === " (" &&
                            segs[i + 2]?.kind === "entity" &&
                            segs[i + 3]?.kind === "text" &&
                            (
                                segs[i + 3].text === ")" ||
                                /^\)\s*\(.+\)\s*$/.test(segs[i + 3].text || "") ||
                                /^\)\)+\s*$/.test(segs[i + 3].text || "")
                            )
                        ) {
                            const outerName = normalizeCompareText(segs[i].text || "");
                            const innerName = normalizeCompareText(segs[i + 2].text || "");

                            if (outerName === entry.personName && !!segs[i + 2].ref) {
                                needsPairCleanup = true;
                                break;
                            }

                            if (innerName === entry.personName && !!segs[i].ref) {
                                needsPairCleanup = true;
                                break;
                            }
                        }
                    }

                    if (matchedRef === ref && !needsPairCleanup) continue;

                    if (applyRelatedRefToItem(item, ref, entry.personName)) {
                        changed = true;
                    }
                }
            }
        }

        return changed;
    }

    function getRelatedRefRemovalItemKey(item) {
        return normalizeCompareText(itemSegmentsToPlainText(item));
    }

    function getRelatedRefRemovalKey(trackKey, roleKey, item, segText) {
        return `${trackKey}::${roleKey}::${getRelatedRefRemovalItemKey(item)}::${normalizeCompareText(segText || "")}`;
    }

    function toggleRelatedRefRemoval(trackKey, roleKeys, item, segText) {
        const roles = Array.isArray(roleKeys) ? roleKeys.filter(Boolean) : [];
        const removals = STAFF_PATCH_RUNTIME.relatedRefRemovals;

        if (!trackKey || !roles.length || !item || !removals || !segText) return false;

        const marked = roles.some(roleKey =>
            removals.has(getRelatedRefRemovalKey(trackKey, roleKey, item, segText))
        );

        for (const roleKey of roles) {
            const key = getRelatedRefRemovalKey(trackKey, roleKey, item, segText);

            if (marked) {
                removals.delete(key);
            } else {
                removals.add(key);
            }
        }

        return !marked;
    }

    function resetRelatedRefRemovals() {
        STAFF_PATCH_RUNTIME.relatedRefRemovals = new Set();
        STAFF_PATCH_RUNTIME.unlinkMode = false;
    }

    function applyRelatedRefRemovalsToPatchMap(patchMap, hitKeys = null) {
        const removals = STAFF_PATCH_RUNTIME.relatedRefRemovals;
        if (!removals || !removals.size) return false;

        let changed = false;

        for (const [trackKey, roleMap] of Object.entries(patchMap || {})) {
            for (const [roleKey, items] of Object.entries(roleMap || {})) {
                if (!Array.isArray(items) || !items.length) continue;

                for (const item of items) {
                    for (const seg of item?.segments || []) {
                        if (seg?.kind !== "entity") continue;
                        if (!seg.ref && !seg.unlinked) continue;

                        const key = getRelatedRefRemovalKey(trackKey, roleKey, item, seg.text);
                        if (!removals.has(key)) continue;

                        if (hitKeys) hitKeys.add(key);

                        if (seg.ref) {
                            seg.originalRef = seg.ref;
                            seg.ref = null;
                        }

                        seg.noLink = true;
                        seg.unlinked = true;
                        changed = true;
                    }
                }
            }
        }

        return changed;
    }

    async function getLatestRepoDataForSubject(subjectId) {
        if (STAFF_PATCH_RUNTIME.subjectId && String(STAFF_PATCH_RUNTIME.subjectId) === String(subjectId) && STAFF_PATCH_RUNTIME.data) {
            return STAFF_PATCH_RUNTIME.data;
        }

        return await fetchPatchData(subjectId);
    }

    async function buildRelatedPersonSubmitContentFromEntries(subjectId, relatedEntries) {
        if (!relatedEntries || !relatedEntries.length) {
            return { ok: false, reason: "no-related-person-entries" };
        }

        let fullPatchMap = null;
        let originalData = null;
        let usedCachedEditor = false;

        if (getAutoPatchPolicy(subjectId) !== "none") {
            const built = await buildImmediateContentFromCachedEditor(subjectId);
            if (built.ok) {
                fullPatchMap = built.fullPatchMap;
                originalData = built.content;
                usedCachedEditor = true;
            }
        }

        if (!fullPatchMap) {
            const data = await getLatestRepoDataForSubject(subjectId);
            if (!data) {
                return { ok: false, reason: "no-existing-json" };
            }

            originalData = data;
            fullPatchMap = buildPatchMapFromData(data);
        }

        const changed = applyRelatedPersonEntriesToPatchMap(fullPatchMap, relatedEntries);

        if (!changed && !usedCachedEditor) {
            return { ok: false, reason: "no-ref-updates" };
        }

        const content = patchMapToTrackCredits(fullPatchMap, subjectId);
        const originalRawPatches = originalData?.rawPatches && typeof originalData.rawPatches === "object"
            ? { ...originalData.rawPatches }
            : {};

        if (Object.keys(originalRawPatches).length) {
            content.rawPatches = originalRawPatches;
        }

        return { ok: true, content, fullPatchMap, changed, usedCachedEditor };
    }

    async function buildRelatedPersonSubmitContent(subjectId) {
        const relatedEntries = collectRelatedPersonEntriesFromPage();
        return buildRelatedPersonSubmitContentFromEntries(subjectId, relatedEntries);
    }

    function recordAutoSubmitResult(subjectId, result) {
        saveAutoPatchLastResult({
            ok: true,
            subjectId,
            mode: result.mode || "",
            prUrl: result.prUrl || "",
            prNumber: result.prNumber || null,
            deduped: !!result.deduped,
            reviewedFromSubmit: !!result.reviewedFromSubmit,
            merged: !!result.merged,
            submitSource: result.submitSource || "",

            supersededExistingPr: !!result.supersededExistingPr,
            closedExistingPr: !!result.closedExistingPr,
            previousPrNumber: result.previousPrNumber || null,
            previousPrUrl: result.previousPrUrl || "",
            prCloseError: result.prCloseError || ""
        });
    }

    function recordAutoSubmitFailure(subjectId, reason, detail) {
        saveAutoPatchLastResult({
            ok: false,
            subjectId,
            reason,
            detail: detail || null
        });
    }

    function installRelatedPersonAutoSubmitHook() {
        if (!isRelatedPersonEditPage()) return;

        const form = document.querySelector('form[name="add_related"][action*="/add_related/person"]');
        if (!form || form.dataset.staffPatchRelatedHooked === "1") return;

        form.dataset.staffPatchRelatedHooked = "1";

        form.addEventListener("submit", () => {
            const subjectId = getSubjectId();
            if (!subjectId) return;

            const relatedEntries = collectRelatedPersonEntriesFromPage();
            if (!relatedEntries.length) return;

            mergeAutoPatchTask({
                subjectId,
                needsRelatedPersonSync: true,
                relatedEntries,
                lastSource: "related-person-save"
            });

            notifyAutoPatchTask("同步中~", subjectId);

            // 这里不要立即 flush。
            // /add_related/person 提交后页面会立刻跳转，当前页发起的 fetch 很容易被浏览器中断。
            // 统一交给下一次稳定页面 init() -> tryAutoSubmitPatchFromCurrentDisplay() 去补提。
        });
    }

    async function submitPatchContent(subjectId, content, options = {}) {
        const session = await ensureSessionMatchesCurrentBangumiUser();
        if (!session) {
            throw new Error("未授权");
        }

        const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session}`
        };

        if (APP_SUBMIT_KEY) {
            headers["X-Submit-Key"] = APP_SUBMIT_KEY;
        }

        const body = {
            subjectId: Number(subjectId),
            content,
            submitSource: String(options.submitSource || "manual_repair_submit"),
            skipSameContent: options.skipSameContent === true
        };

        const res = await fetch(`${WORKER_URL}/submit`, {
            method: "POST",
            headers,
            body: JSON.stringify(body)
        });

        const data = await res.json();

        if (!res.ok || !data.ok) {
            throw new Error(data.error || `提交失败: ${res.status}`);
        }

        return { ...data, savedContent: content };
    }

    async function submitPatchContentInBackground(subjectId, content, options = {}) {
        const session = await ensureSessionMatchesCurrentBangumiUser();
        if (!session) {
            return { ok: false, reason: "missing-session" };
        }

        const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session}`
        };

        if (APP_SUBMIT_KEY) {
            headers["X-Submit-Key"] = APP_SUBMIT_KEY;
        }

        const body = JSON.stringify({
            subjectId: Number(subjectId),
            content,
            submitSource: String(options.submitSource || "track_add_auto"),
            skipSameContent: options.skipSameContent !== false
        });

        const useKeepalive = body.length <= 60 * 1024;

        try {
            const res = await fetch(`${WORKER_URL}/submit`, {
                method: "POST",
                headers,
                body,
                mode: "cors",
                credentials: "omit",
                cache: "no-store",
                keepalive: useKeepalive
            });

            const data = await res.json().catch(() => ({}));

            if (res.ok && data.ok) {
                return { ok: true, data, via: "fetch" };
            }

            return {
                ok: false,
                status: res.status,
                reason: "submit-failed",
                data,
                via: "fetch"
            };
        } catch (err) {
            return {
                ok: false,
                reason: "fetch-fallback-failed",
                detail: err instanceof Error ? err.message : String(err),
                via: "fetch"
            };
        }
    }

    async function submitRepairText(subjectId, inputText) {
        const session = await ensureSessionMatchesCurrentBangumiUser();
        if (!session) {
            throw new Error("未授权");
        }

        const parsed = parseEditorInput(inputText);

        if (parsed.mode === "empty") {
            throw new Error("没有可提交内容");
        }

        const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session}`
        };

        if (APP_SUBMIT_KEY) {
            headers["X-Submit-Key"] = APP_SUBMIT_KEY;
        }

        // 先得到“完整 patchMap”
        let fullPatchMap;

        if (parsed.mode === "trackCredits" || parsed.mode === "rawPatches") {
            fullPatchMap = buildPatchMapFromData(parsed.data);
        } else {
            // rawText 先升级成完整 trackCredits，再转回 patchMap
            const upgraded = patchMapToTrackCredits(parsed.patchMap, subjectId);
            fullPatchMap = buildPatchMapFromData(upgraded);
        }

        // 保留当前页面显示组件整理好的更强格式
        fullPatchMap = reconcilePatchMapWithBaseDisplay(fullPatchMap);

        // 差集只用于判断“这次有没有新内容需要提交”
        const diffPatchMap = diffPatchMapAgainstBaseDisplay(fullPatchMap);
        if (!Object.keys(diffPatchMap).length) {
            throw new Error("输入内容与当前显示一致，没有需要提交的差异");
        }

        // 真正写入 repo 的必须是完整状态，不是差集
        const content = patchMapToTrackCredits(fullPatchMap, subjectId);

        // 保留原始 editor 文本，方便以后回填/重建
        const originalRawPatches =
            parsed.data && parsed.data.rawPatches && typeof parsed.data.rawPatches === "object"
                ? { ...parsed.data.rawPatches }
                : {};

        if (parsed.mode === "rawText") {
            originalRawPatches.editor = inputText.trim();
        } else if (!originalRawPatches.editor && inputText.trim()) {
            originalRawPatches.editor = inputText.trim();
        }

        if (Object.keys(originalRawPatches).length) {
            content.rawPatches = originalRawPatches;
        }

        const body = {
            subjectId: Number(subjectId),
            content
        };

        const res = await fetch(`${WORKER_URL}/submit`, {
            method: "POST",
            headers,
            body: JSON.stringify(body)
        });

        const data = await res.json();

        if (!res.ok || !data.ok) {
            throw new Error(data.error || `提交失败: ${res.status}`);
        }

        return { ...data, savedContent: content };
    }

    async function buildImmediateContentFromCachedEditor(subjectId) {
        // 优先：工具端 patch_content（结构化直传，不再解析 patch 文本）
        const toolContent = getAutoPatchContent(subjectId);
        if (toolContent) {
            const toolPatchMap = buildPatchMapFromData(toolContent, false);

            if (Object.keys(toolPatchMap).length) {
                const editor =
                    getAutoPatchRawEditor(subjectId) ||
                    (typeof toolContent.rawPatches?.editor === "string"
                        ? toolContent.rawPatches.editor.trim()
                        : "");

                const content = {
                    ...toolContent,
                    subjectId: Number(subjectId),
                    rawPatches: {
                        ...(toolContent.rawPatches || {}),
                        editor
                    }
                };

                return {
                    ok: true,
                    content,
                    fullPatchMap: toolPatchMap,
                    rawEditor: editor,
                    fromToolContent: true
                };
            }
        }

        const cachedRawEditor = getAutoPatchRawEditor(subjectId);
        if (!cachedRawEditor) {
            return { ok: false, reason: "no-raw-editor" };
        }

        const parsed = parseEditorInput(cachedRawEditor);

        let fullPatchMap;
        if (parsed.mode === "trackCredits" || parsed.mode === "rawPatches") {
            fullPatchMap = buildPatchMapFromData(parsed.data);
        } else {
            const upgraded = patchMapToTrackCredits(parsed.patchMap, subjectId);
            fullPatchMap = buildPatchMapFromData(upgraded);
        }

        fullPatchMap = reconcilePatchMapWithBaseDisplay(fullPatchMap);

        if (!Object.keys(fullPatchMap).length) {
            return { ok: false, reason: "empty-patch-map", rawEditor: cachedRawEditor };
        }

        const content = patchMapToTrackCredits(fullPatchMap, subjectId);
        content.rawPatches = {
            ...(content.rawPatches || {}),
            editor: cachedRawEditor
        };

        return {
            ok: true,
            content,
            fullPatchMap,
            rawEditor: cachedRawEditor
        };
    }

    async function buildPatchOnlySubmitContent(subjectId) {
        if (getAutoPatchPolicy(subjectId) === "none") {
            return { ok: false, reason: "no-patch-policy" };
        }

        const built = await buildImmediateContentFromCachedEditor(subjectId);
        if (!built || !built.ok) {
            return { ok: false, reason: built?.reason || "no-patch-content" };
        }

        const currentPatchMap = STAFF_PATCH_RUNTIME.patchMap || {};
        const currentEditor =
            typeof STAFF_PATCH_RUNTIME.data?.rawPatches?.editor === "string"
                ? STAFF_PATCH_RUNTIME.data.rawPatches.editor.trim()
                : "";

        const hasPatchDelta = !patchMapsEqual(currentPatchMap, built.fullPatchMap);
        const hasEditorDelta = built.rawEditor !== currentEditor;
        const hasExistingRepoData = !!STAFF_PATCH_RUNTIME.data;

        // repo 已存在时，没有变化就不再提
        if (hasExistingRepoData && !hasPatchDelta && !hasEditorDelta) {
            return { ok: false, reason: "no-changes" };
        }

        return {
            ok: true,
            content: built.content,
            fullPatchMap: built.fullPatchMap,
            rawEditor: built.rawEditor,
            hasExistingRepoData
        };
    }

    /**
     * /subject/{id}/edit_detail 点「提交」时的内容构造：有则覆盖，无则新建。
     *
     * 与 buildPatchOnlySubmitContent 的区别：
     *  - 不因为「和 repo 现有内容一样」就放弃（那边是增量同步，这边是覆盖写入）；
     *  - 页面上没有暂存的工具数据时，退回用 repo 已有的 patch 重建一份完整内容，
     *    这样「改 detail 顺手覆盖 patch」不依赖用户先粘一次 JSON；
     *  - repo 里没有 patch 且没有暂存数据时返回失败（没有可新建的内容）。
     */
    async function buildEditDetailSubmitContent(subjectId) {
        if (getAutoPatchPolicy(subjectId) === "none") {
            return { ok: false, reason: "no-patch-policy" };
        }

        const staged = await buildImmediateContentFromCachedEditor(subjectId);
        if (staged && staged.ok) {
            return {
                ok: true,
                content: staged.content,
                fullPatchMap: staged.fullPatchMap,
                rawEditor: staged.rawEditor,
                hasExistingRepoData: !!STAFF_PATCH_RUNTIME.data
            };
        }

        // 没有暂存数据：repo 已有 patch 的就地重建（覆盖），没有就没什么可新建
        const repoData = await ensureRepoPatchDataForSubject(subjectId);
        if (!repoData) {
            return { ok: false, reason: staged?.reason || "no-patch-content" };
        }

        const fullPatchMap = reconcilePatchMapWithBaseDisplay(buildPatchMapFromData(repoData));
        if (!Object.keys(fullPatchMap).length) {
            return { ok: false, reason: "empty-patch-map" };
        }

        const content = patchMapToTrackCredits(fullPatchMap, subjectId);
        const editor =
            typeof repoData.rawPatches?.editor === "string" ? repoData.rawPatches.editor.trim() : "";

        if (editor || (repoData.rawPatches && typeof repoData.rawPatches === "object")) {
            content.rawPatches = { ...(repoData.rawPatches || {}), editor };
        }

        return {
            ok: true,
            content,
            fullPatchMap,
            rawEditor: editor,
            hasExistingRepoData: true
        };
    }

    // 保证 STAFF_PATCH_RUNTIME 里装的就是当前条目的 repo patch
    async function ensureRepoPatchDataForSubject(subjectId) {
        if (
            STAFF_PATCH_RUNTIME.subjectId &&
            String(STAFF_PATCH_RUNTIME.subjectId) === String(subjectId)
        ) {
            return STAFF_PATCH_RUNTIME.data || null;
        }

        try {
            const data = await fetchPatchData(subjectId);
            STAFF_PATCH_RUNTIME.subjectId = subjectId;
            STAFF_PATCH_RUNTIME.data = data;
            return data || null;
        } catch (err) {
            console.warn("[staff-patch] fetch repo patch failed:", err);
            return null;
        }
    }

    async function tryFlushAutoPatchTask(subjectId = getSubjectId()) {
        const task = getAutoPatchTaskForSubject(subjectId);
        if (!task) return;
        if (STAFF_PATCH_RUNTIME.autoTaskSubmitting) return;

        STAFF_PATCH_RUNTIME.autoTaskSubmitting = true;

        try {
            const me = await authMe().catch(() => ({ ok: false }));
            if (!me || !me.ok) {
                return;
            }

            const userGroup = getAuthUserGroup(me);

            let built = null;
            let submitSource = "";
            let successKind = "";
            // edit-detail 保存时按「有则覆盖、无则新建」处理：不再因为「与 repo 一致」而跳过
            let forceOverwrite = false;

            // 1) 最高优先：关联页任务
            if (task.needsRelatedPersonSync && Array.isArray(task.relatedEntries) && task.relatedEntries.length) {
                built = await buildRelatedPersonSubmitContentFromEntries(subjectId, task.relatedEntries);

                if (built.ok) {
                    submitSource = "related_person_save";
                    successKind = "related";
                } else if (built.reason === "no-ref-updates") {
                    clearAutoPatchTaskFlags("related", subjectId);
                    return;
                } else if (built.reason !== "no-existing-json") {
                    return;
                }
            }

            // 2) 其次：edit-detail（仅维基人）
            if ((!built || !built.ok) && task.needsEditDetailSync) {
                if (!isWikiDirectSubmitGroup(userGroup)) {
                    // 非维基人永远提交不了 edit-detail：只清掉这个标记再往下走。
                    // 原来这里是 return，会把同一份 task 里的 create-bootstrap / songlist
                    // 一起挡掉，导致该条目一直等不到首次入库的 patch。
                    clearAutoPatchTaskFlags("edit-detail", subjectId);
                } else {
                    // 已有条目改完 detail 后点提交：repo 里有 patch 就整份覆盖，没有就新建。
                    // 这里不再走 buildPatchOnlySubmitContent 的「无变化即放弃」分支，
                    // 否则保存后 patch 永远停在旧内容上。
                    built = await buildEditDetailSubmitContent(subjectId);

                    if (built.ok) {
                        submitSource = "edit_detail_save";
                        successKind = "patch";
                        forceOverwrite = true;
                    } else {
                        return;
                    }
                }
            }

            // 3) 首次入库：create-bootstrap（所有已授权用户都允许，Worker 自己决定直写还是 PR）
            if ((!built || !built.ok) && task.needsCreateBootstrap) {
                built = await buildPatchOnlySubmitContent(subjectId);

                if (built.ok) {
                    submitSource = "create_bootstrap";
                    successKind = "patch";
                } else if (built.reason === "no-changes") {
                    clearAutoPatchTaskFlags("patch", subjectId);
                    return;
                } else {
                    return;
                }
            }

            // 4) 最后：songlist
            if ((!built || !built.ok) && task.songlistPending) {
                if (!shouldAutoSubmitSonglistForUserGroup(userGroup)) {
                    return;
                }

                built = await buildPatchOnlySubmitContent(subjectId);

                if (built.ok) {
                    submitSource = "track_add_auto";
                    successKind = "songlist";
                } else if (built.reason === "no-changes") {
                    clearAutoPatchTaskFlags("songlist", subjectId);
                    return;
                } else {
                    return;
                }
            }

            if (!built || !built.ok) {
                return;
            }

            const submitRes = await submitPatchContentInBackground(subjectId, built.content, {
                submitSource,
                // 覆盖式提交：即使与 repo 现有内容完全一致也要写一次（worker 自己会去重）
                skipSameContent: !forceOverwrite
            });

            if (!submitRes.ok || !submitRes.data) {
                if (
                    submitSource === "related_person_save" &&
                    submitRes.reason === "fetch-fallback-failed"
                ) {
                    console.log("[staff-patch] related-person submit deferred to next stable page");
                    return;
                }

                if (submitRes.status === 401) {
                    // 授权真的失效了：清掉本地 session（连带授权时间戳），
                    // 下次进条目创建页 / 点人员修复会重新走授权；任务仍留在队列里等补提交。
                    clearSession();
                    showTopNotice("组件授权已过期，patch 未写入。重新授权后会自动补提交。", {
                        type: "error",
                        autoHideMs: 8000
                    });
                }

                recordAutoSubmitFailure(
                    subjectId,
                    submitRes.reason || "submit-failed",
                    submitRes.detail || submitRes.data || null
                );
                return;
            }

            STAFF_PATCH_RUNTIME.subjectId = subjectId;
            STAFF_PATCH_RUNTIME.data = built.content;
            STAFF_PATCH_RUNTIME.patchMap = built.fullPatchMap || STAFF_PATCH_RUNTIME.patchMap;

            recordAutoSubmitResult(subjectId, submitRes.data);
            handleAutoSubmitResultNotice(submitRes.data, subjectId);

            consumeTaskAfterSuccessfulSubmit(task, successKind);
        } catch (err) {
            recordAutoSubmitFailure(
                subjectId,
                "submit-exception",
                err instanceof Error ? err.message : String(err)
            );
            console.warn("[staff-patch] tryFlushAutoPatchTask exception:", err);
        } finally {
            STAFF_PATCH_RUNTIME.autoTaskSubmitting = false;
        }
    }

    function maybeBootstrapCreatePatchPending(subjectId) {
        if (!isSubjectMainPage()) return;
        if (!subjectId) return;

        if (STAFF_PATCH_RUNTIME.data) return;

        const pendingCreate = getPendingCreateExportForCurrentPage();
        if (!pendingCreate || !pendingCreate.editor) return;

        if (getAutoPatchPolicy(subjectId) === "none") return;

        const cachedRawEditor = getAutoPatchRawEditor(subjectId);
        if (!cachedRawEditor) return;

        mergeAutoPatchTask({
            subjectId,
            needsCreateBootstrap: true,
            lastSource: "create-bootstrap"
        });

        // notifyAutoPatchTask("入库信息写入", subjectId);
        console.log("[staff-patch] bootstrapped create task for subject:", subjectId);
    }

    async function tryAutoSubmitPatchFromCurrentDisplay() {
        const subjectId = getSubjectId();
        if (!subjectId) return;
        await tryFlushAutoPatchTask(subjectId);
    }

    function importWikiToolBackupFromFile(onImported, onStatus) {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".txt,.tsv,.csv,text/plain";
        input.style.display = "none";

        input.addEventListener("change", async () => {
            const file = input.files && input.files[0];
            if (!file) return;

            try {
                const raw = await file.text();
                const db = parseWikiToolBackup(raw);
                saveImportedDB(db);
                saveResolutionCache({});
                STAFF_PATCH_RUNTIME.subjectAliasRegistry = {};

                const stats = getImportedDBStats();
                if (typeof onStatus === "function") {
                    onStatus(`数据库导入成功：人物 ${stats.people} 条，别名索引 ${stats.aliases} 条。`);
                }

                if (typeof onImported === "function") {
                    onImported();
                }
            } catch (err) {
                if (typeof onStatus === "function") {
                    onStatus(`数据库导入失败：${err instanceof Error ? err.message : String(err)}`);
                }
            } finally {
                input.remove();
            }
        });

        document.body.appendChild(input);
        input.click();
    }

    function showTopNotice(message, options = {}) {
        const {
            type = "info",
            html = false,
            autoHideMs = 0
        } = options;

        let box = document.getElementById("bgm-staff-fix-top-notice");
        if (!box) {
            box = document.createElement("div");
            box.id = "bgm-staff-fix-top-notice";
            box.style.margin = "0 0 10px 0";
            box.style.padding = "8px 12px";
            box.style.borderRadius = "6px";
            box.style.fontSize = "12px";
            box.style.lineHeight = "1.6";
            box.style.border = "1px solid #f0c36d";
            box.style.background = "#fff8e1";
            box.style.color = "#8a5a00";

            const relatedPersonForm = document.querySelector(
                'form[name="add_related"][action*="/add_related/person"]'
            );
            const relatedPersonContainer = relatedPersonForm?.closest(".crtRelatedLeft");

            if (relatedPersonForm && relatedPersonContainer) {
                relatedPersonContainer.insertBefore(box, relatedPersonForm);
            } else {
                const nameSingle = document.getElementById("nameSingle");
                if (nameSingle && nameSingle.parentNode) {
                    nameSingle.parentNode.insertBefore(box, nameSingle);
                } else {
                    const column = document.querySelector("#columnSubjectHomeA") || document.body;
                    column.insertBefore(box, column.firstChild);
                }
            }
        }

        box.dataset.noticeType = type;

        if (type === "success") {
            box.style.border = "1px solid #9ad29a";
            box.style.background = "#edf9ed";
            box.style.color = "#2d6a2d";
        } else if (type === "error") {
            box.style.border = "1px solid #e2a4a4";
            box.style.background = "#fff1f1";
            box.style.color = "#8a2d2d";
        } else {
            box.style.border = "1px solid #f0c36d";
            box.style.background = "#fff8e1";
            box.style.color = "#8a5a00";
        }

        if (html) {
            box.innerHTML = message;
        } else {
            box.textContent = message;
        }

        if (autoHideMs > 0) {
            setTimeout(() => {
                if (box) box.remove();
            }, autoHideMs);
        }

        return box;
    }

    function showMsgSafe(html) {
        try {
            if (typeof showMsg === "function") {
                showMsg(html);
                return;
            }

            if (typeof chiiLib !== "undefined" && chiiLib?.ukagaka?.presentSpeech) {
                chiiLib.ukagaka.presentSpeech(html, true);
            }
        } catch (err) {
            console.warn("[staff-patch] showMsgSafe failed:", err);
        }
    }

    function notifyAutoPatchTask(message, subjectId = getSubjectId()) {
        if (!subjectId || !message) return;

        const pageKey = `${subjectId}::${location.pathname}`;
        const last = sessionStorage.getItem(AUTO_PATCH_TASK_HINT_KEY);
        if (last === pageKey) return;

        sessionStorage.setItem(AUTO_PATCH_TASK_HINT_KEY, pageKey);
        showMsgSafe(message);
    }

    async function openPrReviewModal(me, subjectId) {
        const prInfo = await fetchPendingPrContent(subjectId);

        // 用 PR 内容刷新运行时，但不要覆盖当前页面基准状态
        const prPatchMap = buildPatchMapFromData(prInfo.content);

        openRepairModal(me, {
            mode: "pr-review",
            prInfo,
            initialData: prInfo.content,
            initialPatchMap: prPatchMap
        });
    }


    async function openExistingPrEditModal(me, subjectId) {
        const prInfo = await fetchPendingPrContent(subjectId);

        const prPatchMap = buildPatchMapFromData(prInfo.content);

        openRepairModal(me, {
            mode: "existing-pr-edit",
            prInfo,
            initialData: prInfo.content,
            initialPatchMap: prPatchMap
        });
    }

    async function installPendingPrBanner() {
        if (!isSubjectMainPage()) return;

        const subjectId = getSubjectId();
        if (!subjectId) return;

        try {
            const prStatus = await fetchPendingPrStatus(subjectId);
            if (!prStatus || !prStatus.ok || !prStatus.hasOpenPr) return;

            const parts = [];
            parts.push(`此页面存在待通过的信息`);

            if (prStatus.prNumber && prStatus.prUrl) {
                parts.push(`：<a class="l" target="_blank" href="${prStatus.prUrl}">PR #${prStatus.prNumber}</a>`);
            } else if (prStatus.prUrl) {
                parts.push(`：<a class="l" target="_blank" href="${prStatus.prUrl}">查看 PR</a>`);
            }

            if (prStatus.author) {
                if (prStatus.authorUserUrl) {
                    parts.push(`（提交者：<a class="l" target="_blank" href="${prStatus.authorUserUrl}">${prStatus.author}</a>）`);
                } else {
                    parts.push(`（提交者：${prStatus.author}）`);
                }
            }

            const box = showTopNotice(parts.join(""), {
                type: "info",
                html: true
            });

            box.style.cursor = "pointer";
            box.title = "点击读取当前待修改 PR 内容";

            box.addEventListener("click", async (e) => {
                const link = e.target.closest("a");
                if (link) return; // 点链接时不劫持

                const me = await authMe().catch(() => ({ ok: false }));
                if (!me || !me.ok) {
                    startAuth();
                    return;
                }

                // 这里不要只靠前端做权限，但前端先挡一下体验更好
                try {
                    const prStatus = await fetchPendingPrStatus(subjectId);

                    if (prStatus?.viewerCanReview) {
                        await openPrReviewModal(me, subjectId);
                        return;
                    }

                    if (prStatus?.viewerIsSubmitter || prStatus?.viewerCanEditExistingPr) {
                        await openExistingPrEditModal(me, subjectId);
                        return;
                    }

                    showTopNotice(
                        "当前无法直接读取待审核 PR：只有维基人或原提交者可以继续处理。",
                        { type: "error", autoHideMs: 3500 }
                    );
                } catch (err) {
                    showTopNotice(
                        `当前无法直接读取待审核 PR：${err instanceof Error ? err.message : String(err)}`,
                        { type: "error", autoHideMs: 3500 }
                    );
                }
            });
        } catch (err) {
            console.warn("[staff-patch] installPendingPrBanner failed:", err);
        }
    }

    function closeRepairModal() {
        const el = document.querySelector(".bgm-staff-fix-overlay");
        if (el) el.remove();

        resetRelatedRefRemovals();
    }

    async function onRepairEntryClick() {
        await consumeSessionFromHash();

        const me = await authMe().catch(() => ({ ok: false }));
        if (!me || !me.ok) {
            markRepairPageAuthReloadPending();
            startAuth();
            return;
        }

        const subjectId = getSubjectId();
        await openBestRepairModal(me, subjectId);
    }

    function openRepairModal(me, options = {}) {

        const {
            mode = "normal",        // normal | pr-review
            prInfo = null,
            initialData = null
        } = options;

        closeRepairModal();

        resetRelatedRefRemovals();

        const overlay = document.createElement("div");
        overlay.className = "bgm-staff-fix-overlay";

        const modal = document.createElement("div");
        modal.className = "bgm-staff-fix-modal";

        const header = document.createElement("div");
        header.className = "bgm-staff-fix-header";
        header.innerHTML = `
        <span>人员修复</span>
        <a href="javascript:void(0);" id="bgm-staff-fix-close" class="l">✖</a>
    `;

        const body = document.createElement("div");
        body.className = "bgm-staff-fix-body";

        const left = document.createElement("div");
        left.className = "bgm-staff-fix-pane";
        left.innerHTML = `
        <div class="bgm-staff-fix-pane-title">
  <span>输入区</span>
  <button type="button"
          class="bgm-staff-fix-compare-toggle"
          id="bgm-staff-fix-toggle-input-source"
          hidden>输入来源：用户</button>
</div>
        <textarea class="bgm-staff-fix-textarea" id="bgm-staff-fix-input" placeholder="在这里粘贴维基工具导出的参与信息，例如：
作曲：佐藤元気(1.1)
编曲：佐藤元気(1.1)
乐器-Bass：樋田竜太(1.1)"></textarea>
    `;

        const right = document.createElement("div");
        right.className = "bgm-staff-fix-pane";
        right.innerHTML = `
    <div class="bgm-staff-fix-pane-title">
    <span>预览</span>
    <span style="display:flex; gap:8px; align-items:center;">
        <button type="button"
                class="bgm-staff-fix-compare-toggle"
                id="bgm-staff-fix-toggle-unlink"
                title="开启后点击预览中的人名即可去除其关联">去除关联：关</button>
        <button type="button"
                class="bgm-staff-fix-compare-toggle"
                id="bgm-staff-fix-toggle-json-preview">提交 JSON：关</button>
        <button type="button"
                class="bgm-staff-fix-compare-toggle"
                id="bgm-staff-fix-toggle-compare">对比前后：关</button>
    </span>
</div>
    <div class="bgm-staff-fix-preview" id="bgm-staff-fix-preview">正在加载当前修复状态...</div>
`;
        body.appendChild(left);
        body.appendChild(right);

        const prStatusHtml = prInfo
            ? `${mode === "pr-review" ? "待审核 PR" : "当前待修改 PR"
            }：<a class="l" target="_blank" href="${prInfo.prUrl}">#${prInfo.prNumber}</a> · 提交者：${prInfo.submittedByUserUrl
                ? `<a class="l" target="_blank" href="${prInfo.submittedByUserUrl}">${prInfo.submittedBy}</a>`
                : (prInfo.submittedBy || "-")
            }`
            : `已授权：${me.username}（用户组 ${me.userGroup}）`;

        const footer = document.createElement("div");
        footer.className = "bgm-staff-fix-footer";
        footer.innerHTML = `
    <div class="bgm-staff-fix-status" id="bgm-staff-fix-status">${prStatusHtml}</div>
    <div class="bgm-staff-fix-actions">
    <button type="button" id="bgm-staff-fix-import-db">导入数据库</button>
    <button type="button" id="bgm-staff-fix-logout">退出授权</button>
    ${mode === "pr-review" && prInfo
                ? '<button type="button" id="bgm-staff-fix-reject-pr">拒绝 PR</button>'
                : ""}
${mode === "existing-pr-edit" && prInfo
                ? '<button type="button" id="bgm-staff-fix-close-pr">关闭 PR</button>'
                : ""}
<button type="button" id="bgm-staff-fix-submit">${mode === "pr-review" ? "通过并提交" : "提交修复"}</button>
`;

        modal.appendChild(header);
        modal.appendChild(body);
        modal.appendChild(footer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const input = modal.querySelector("#bgm-staff-fix-input");
        const preview = modal.querySelector("#bgm-staff-fix-preview");
        const status = modal.querySelector("#bgm-staff-fix-status");
        const compareToggle = modal.querySelector("#bgm-staff-fix-toggle-compare");
        const inputSourceToggle = modal.querySelector("#bgm-staff-fix-toggle-input-source");
        const jsonPreviewToggle = modal.querySelector("#bgm-staff-fix-toggle-json-preview");
        const unlinkToggle = modal.querySelector("#bgm-staff-fix-toggle-unlink");

        const liveTrackRows = collectTrackRows();
        snapshotBaseTrackState(liveTrackRows);
        snapshotBaseEpinfoState();
        rebuildSubjectAliasRegistry();

        function syncCompareToggleButton() {
            if (!compareToggle) return;

            if (STAFF_PATCH_RUNTIME.previewCompareMode) {
                compareToggle.textContent = "对比前后：开";
                compareToggle.classList.add("is-on");
            } else {
                compareToggle.textContent = "对比前后：关";
                compareToggle.classList.remove("is-on");
            }
        }

        let effectiveRemovalCount = 0;

        function syncUnlinkToggleButton() {
            if (!unlinkToggle) return;

            const count = effectiveRemovalCount;

            unlinkToggle.hidden = !!STAFF_PATCH_RUNTIME.previewJsonMode;

            if (STAFF_PATCH_RUNTIME.unlinkMode) {
                unlinkToggle.textContent = count ? `去除关联：开（${count}）` : "去除关联：开";
                unlinkToggle.classList.add("is-on");
            } else {
                unlinkToggle.textContent = count ? `去除关联：关（${count}）` : "去除关联：关";
                unlinkToggle.classList.remove("is-on");
            }
        }

        const previewRenderContext = {
            onToggleUnlink: (ctx, seg) => {
                if (!ctx?.trackKey || !Array.isArray(ctx.roleKeys) || !ctx.roleKeys.length || !ctx.item) return;

                const segText = String(seg?.text || "");
                if (!segText) return;

                const nowMarked = toggleRelatedRefRemoval(ctx.trackKey, ctx.roleKeys, ctx.item, segText);

                updatePreviewFromText();

                status.textContent = nowMarked
                    ? `已标记去除关联：${segText}（${ctx.trackKey === EPINFO_TRACK_KEY ? "条目级信息" : `曲目 ${ctx.trackKey}`}），提交时一并生效。`
                    : `已恢复关联：${segText}（${ctx.trackKey === EPINFO_TRACK_KEY ? "条目级信息" : `曲目 ${ctx.trackKey}`}）。`;
            }
        };

        const updatePreviewFromText = () => {
            const text = input.value.trim();

            if (STAFF_PATCH_RUNTIME.previewJsonMode) {
                try {
                    const subjectId = Number(getSubjectId());
                    const built = buildContentFromInputLoose(subjectId, text);

                    preview.innerHTML = "";
                    const pre = document.createElement("pre");
                    pre.className = "bgm-staff-fix-json-preview";
                    pre.style.margin = "0";
                    pre.style.whiteSpace = "pre-wrap";
                    pre.style.wordBreak = "break-word";
                    pre.style.font = "12px/1.6 Consolas, Monaco, monospace";
                    pre.textContent = JSON.stringify(built.content, null, 2);
                    preview.appendChild(pre);
                } catch (err) {
                    preview.textContent = `JSON 预览失败：${err instanceof Error ? err.message : String(err)}`;
                }
                return;
            }

            if (!text) {
                preview.textContent = "当前输入为空。点击“提交修复”后，会清空当前条目的 staff 修复信息。";
                effectiveRemovalCount = 0;
                syncUnlinkToggleButton();
                return;
            }

            try {
                const parsed = parseEditorInput(text);
                const subjectId = Number(getSubjectId());

                let previewPatchMap;

                if (parsed.mode === "trackCredits") {
                    previewPatchMap = buildPatchMapFromData(parsed.data);
                } else if (parsed.mode === "rawPatches") {
                    previewPatchMap = buildPatchMapFromData(parsed.data);
                } else {
                    // rawText 也先升级成 trackCredits，再回到 patchMap
                    const upgraded = patchMapToTrackCredits(parsed.patchMap, subjectId);
                    previewPatchMap = buildPatchMapFromData(upgraded);
                }

                previewPatchMap = reconcilePatchMapWithBaseDisplay(previewPatchMap);

                const appliedRemovalKeys = new Set();
                applyRelatedRefRemovalsToPatchMap(previewPatchMap, appliedRemovalKeys);
                effectiveRemovalCount = appliedRemovalKeys.size;

                const beforePatchMap = STAFF_PATCH_RUNTIME.patchMap || {};
                const blocks = buildPreviewBlocks(beforePatchMap, previewPatchMap);

                if (!blocks.length) {
                    preview.textContent = "已读取输入内容，但没有匹配到可预览的曲目。请检查曲目键是否与当前条目一致。";
                    effectiveRemovalCount = 0;
                    syncUnlinkToggleButton();
                    return;
                }

                renderPreview(blocks, preview, previewRenderContext);
                syncUnlinkToggleButton();
            } catch (err) {
                preview.textContent = `预览解析失败：${err instanceof Error ? err.message : String(err)}`;
            }
        };

        syncCompareToggleButton();
        syncUnlinkToggleButton();

        compareToggle.addEventListener("click", () => {
            STAFF_PATCH_RUNTIME.previewCompareMode = !STAFF_PATCH_RUNTIME.previewCompareMode;
            syncCompareToggleButton();
            updatePreviewFromText();
        });

        unlinkToggle?.addEventListener("click", () => {
            STAFF_PATCH_RUNTIME.unlinkMode = !STAFF_PATCH_RUNTIME.unlinkMode;
            updatePreviewFromText();

            status.textContent = STAFF_PATCH_RUNTIME.unlinkMode
                ? "已开启去除关联：点击预览中带虚线下划线的人名即可去除关联，再点一次可恢复。"
                : "已关闭去除关联：预览恢复普通显示，已标记的去除仍会在提交时生效。";
        });

        // const existingText = extractEditableInputText(STAFF_PATCH_RUNTIME.data);

        const sourceData = initialData || STAFF_PATCH_RUNTIME.data;
        const inputVariants = extractEditableInputVariants(sourceData);

        STAFF_PATCH_RUNTIME.inputDrafts = {
            rawPatches: inputVariants.rawEditorText || "",
            trackCredits: inputVariants.rebuiltTrackCreditsText || ""
        };

        if (prInfo?.editorText) {
            STAFF_PATCH_RUNTIME.inputSourceMode = "rawPatches";
            STAFF_PATCH_RUNTIME.inputDrafts.rawPatches = prInfo.editorText;
        } else if (inputVariants.hasRawEditor) {
            STAFF_PATCH_RUNTIME.inputSourceMode = "rawPatches";
        } else if (inputVariants.hasTrackCredits) {
            STAFF_PATCH_RUNTIME.inputSourceMode = "trackCredits";
        } else {
            STAFF_PATCH_RUNTIME.inputSourceMode = "rawPatches";
        }

        function getCurrentInputSourceText() {
            return STAFF_PATCH_RUNTIME.inputDrafts[STAFF_PATCH_RUNTIME.inputSourceMode] || "";
        }

        function saveCurrentInputDraft() {
            STAFF_PATCH_RUNTIME.inputDrafts[STAFF_PATCH_RUNTIME.inputSourceMode] = input.value || "";
        }

        function syncInputSourceToggleButton() {
            if (!inputSourceToggle) return;

            const showToggle = !!(inputVariants.hasRawEditor && inputVariants.hasTrackCredits);
            inputSourceToggle.hidden = !showToggle;

            if (!showToggle) return;

            if (STAFF_PATCH_RUNTIME.inputSourceMode === "trackCredits") {
                inputSourceToggle.textContent = "输入来源：组件";
                inputSourceToggle.classList.add("is-on");
            } else {
                inputSourceToggle.textContent = "输入来源：用户";
                inputSourceToggle.classList.remove("is-on");
            }
        }

        function syncJsonPreviewToggleButton() {
            if (!jsonPreviewToggle) return;

            if (STAFF_PATCH_RUNTIME.previewJsonMode) {
                jsonPreviewToggle.textContent = "提交 JSON：开";
                jsonPreviewToggle.classList.add("is-on");
            } else {
                jsonPreviewToggle.textContent = "提交 JSON：关";
                jsonPreviewToggle.classList.remove("is-on");
            }
        }

        input.value = getCurrentInputSourceText();
        syncInputSourceToggleButton();
        syncJsonPreviewToggleButton();

        inputSourceToggle?.addEventListener("click", () => {
            saveCurrentInputDraft();

            STAFF_PATCH_RUNTIME.inputSourceMode =
                STAFF_PATCH_RUNTIME.inputSourceMode === "rawPatches"
                    ? "trackCredits"
                    : "rawPatches";

            input.value = getCurrentInputSourceText();
            syncInputSourceToggleButton();
            updatePreviewFromText();
        });

        jsonPreviewToggle?.addEventListener("click", () => {
            STAFF_PATCH_RUNTIME.previewJsonMode = !STAFF_PATCH_RUNTIME.previewJsonMode;
            syncJsonPreviewToggleButton();
            syncUnlinkToggleButton();
            updatePreviewFromText();
        });

        try {
            const basePatchMap = STAFF_PATCH_RUNTIME.patchMap || {};

            const initialAfterPatchMap =
                options.initialPatchMap
                    ? options.initialPatchMap
                    : (STAFF_PATCH_RUNTIME.patchMap || buildPatchMapFromData(sourceData));

            const initialBlocks = buildPreviewBlocks(basePatchMap, initialAfterPatchMap);

            if (initialBlocks.length) {
                renderPreview(initialBlocks, preview, previewRenderContext);
            } else {
                updatePreviewFromText();
            }
        } catch (err) {
            preview.textContent = `初始预览失败：${err instanceof Error ? err.message : String(err)}`;
        }

        input.addEventListener("input", updatePreviewFromText);

        modal.querySelector("#bgm-staff-fix-close").addEventListener("click", closeRepairModal);

        modal.querySelector("#bgm-staff-fix-import-db").addEventListener("click", () => {
            importWikiToolBackupFromFile(
                () => {
                    const stats = getImportedDBStats();
                    status.textContent = `数据库已导入：人物 ${stats.people} 条，别名索引 ${stats.aliases} 条。`;
                    updatePreviewFromText();
                },
                (msg) => {
                    status.textContent = msg;
                }
            );
        });

        modal.querySelector("#bgm-staff-fix-logout").addEventListener("click", async () => {
            await authLogout().catch(() => null);
            closeRepairModal();
        });

        const rejectPrBtn = modal.querySelector("#bgm-staff-fix-reject-pr");
        const closePrBtn = modal.querySelector("#bgm-staff-fix-close-pr");

        const submitBtn = modal.querySelector("#bgm-staff-fix-submit");
        let modalBusy = false;

        function setModalBusy(busy) {
            modalBusy = !!busy;

            const buttons = [
                submitBtn,
                rejectPrBtn,
                closePrBtn,
                modal.querySelector("#bgm-staff-fix-import-db"),
                modal.querySelector("#bgm-staff-fix-logout")
            ].filter(Boolean);

            for (const btn of buttons) {
                btn.disabled = modalBusy;
                btn.style.opacity = modalBusy ? "0.65" : "";
                btn.style.cursor = modalBusy ? "not-allowed" : "";
            }
        }

        if (rejectPrBtn && mode === "pr-review" && prInfo) {
            rejectPrBtn.addEventListener("click", async () => {
                if (modalBusy) return;

                const confirmed = window.confirm("确定要拒绝并关闭当前 PR 吗？此操作不会合并内容。");
                if (!confirmed) return;

                const reason = window.prompt("可选：填写拒绝原因（会作为评论写入 PR）", "") || "";
                const currentSubjectId = getSubjectId();

                if (!currentSubjectId) {
                    status.textContent = "拒绝失败：未能获取当前条目 ID";
                    return;
                }

                setModalBusy(true);
                status.textContent = "正在拒绝 PR...";

                try {
                    await submitPrReject(currentSubjectId, prInfo.prNumber, reason);

                    status.innerHTML = `已拒绝并关闭 PR：<a class="l" target="_blank" href="${prInfo.prUrl}">#${prInfo.prNumber}</a>，正在刷新页面...`;

                    setTimeout(() => {
                        location.reload();
                    }, 500);
                } catch (err) {
                    status.textContent = `拒绝失败：${err instanceof Error ? err.message : String(err)}`;
                    setModalBusy(false);
                }
            });
        }

        if (closePrBtn && mode === "existing-pr-edit" && prInfo) {
            closePrBtn.addEventListener("click", async () => {
                if (modalBusy) return;

                const confirmed = window.confirm("确定要关闭你当前提交的 PR 吗？此操作不会合并内容。");
                if (!confirmed) return;

                const reason = window.prompt("可选：填写关闭原因（会作为评论写入 PR）", "") || "";
                const currentSubjectId = getSubjectId();

                if (!currentSubjectId) {
                    status.textContent = "关闭失败：未能获取当前条目 ID";
                    return;
                }

                setModalBusy(true);
                status.textContent = "正在关闭 PR...";

                try {
                    await submitPrReject(currentSubjectId, prInfo.prNumber, reason);

                    status.innerHTML = `已关闭 PR：<a class="l" target="_blank" href="${prInfo.prUrl}">#${prInfo.prNumber}</a>，正在刷新页面...`;

                    setTimeout(() => {
                        location.reload();
                    }, 500);
                } catch (err) {
                    status.textContent = `关闭失败：${err instanceof Error ? err.message : String(err)}`;
                    setModalBusy(false);
                }
            });
        }

        submitBtn.addEventListener("click", async () => {
            if (modalBusy) return;

            const rawText = input.value.trim();
            const subjectId = getSubjectId();

            if (!subjectId) {
                status.textContent = "提交失败：未能获取当前条目 ID";
                return;
            }

            const isClearSubmit = !rawText;

            if (isClearSubmit) {
                if (mode === "pr-review" && prInfo) {
                    status.textContent = "待审核 PR 不支持空提交，请填写内容后提交，或直接拒绝 PR。";
                    return;
                }

                const confirmed = window.confirm("当前输入为空。确定要清空当前条目的 staff 修复信息吗？");
                if (!confirmed) return;
            }

            status.textContent = isClearSubmit ? "正在清空..." : "正在提交...";
            setModalBusy(true);

            try {
                const built = isClearSubmit
                    ? buildContentFromInputLoose(subjectId, "")
                    : buildSubmitContentFromInput(subjectId, rawText);

                let result;

                if (mode === "pr-review" && prInfo) {
                    result = await submitPrReviewFast(subjectId, prInfo.prNumber, built.content);

                    if (!result.ok) {
                        status.textContent =
                            result?.data?.error ||
                            result?.detail ||
                            "提交失败，请稍后再试";
                        setModalBusy(false);
                        return;
                    }

                    STAFF_PATCH_RUNTIME.subjectId = subjectId;
                    STAFF_PATCH_RUNTIME.data = built.content;
                    STAFF_PATCH_RUNTIME.patchMap = built.fullPatchMap;

                    status.innerHTML = `已受理：<a class="l" target="_blank" href="${prInfo.prUrl}">#${prInfo.prNumber}</a>，正在后台处理。可继续下一个条目。`;

                    setTimeout(() => {
                        closeRepairModal();
                    }, 600);

                    return;
                }

                result = await submitPatchContent(subjectId, built.content);

                STAFF_PATCH_RUNTIME.subjectId = subjectId;
                STAFF_PATCH_RUNTIME.data = built.content;
                STAFF_PATCH_RUNTIME.patchMap = built.fullPatchMap;

                status.innerHTML = isClearSubmit
                    ? "已清空当前修复信息，正在刷新页面..."
                    : buildSubmitSuccessHtml(result);

                setTimeout(() => {
                    location.reload();
                }, 500);
            } catch (err) {
                status.textContent = `提交失败：${err instanceof Error ? err.message : String(err)}`;
                setModalBusy(false);
            }
        });
    }

    async function init() {
        console.log("[staff-patch] init start");

        const consumedSession = await consumeSessionFromHash();

        if (maybeReloadCreateMusicPageAfterAuth(consumedSession)) {
            return;
        }

        if (maybeReloadRepairPageAfterAuth(consumedSession)) {
            return;
        }

        await ensureSessionMatchesCurrentBangumiUser();

        if (isHomePage()) {
            installHomePendingPrWidget().catch(err => {
                console.warn("[staff-patch] home pending PR widget failed:", err);
            });
        }

        const afterAuthAction = consumeAfterAuthAction();
        if (afterAuthAction?.type === "open-home-pr-list" && isHomePage()) {
            setTimeout(async () => {
                try {
                    await consumeSessionFromHash();

                    const me = await authMe().catch(() => ({ ok: false }));
                    if (!me || !me.ok) return;

                    const latestData = await fetchPendingPrList(100);
                    renderHomePendingPrBadge(latestData);

                    if (latestData?.canOpen) {
                        openHomePendingPrModal(latestData);
                    }
                } catch (err) {
                    console.warn("[staff-patch] resume after auth failed:", err);
                }
            }, 0);
        }

        if (currentType !== typeConfig['3'] && !isHomePage()) {
            console.warn("[staff-patch] 非音乐条目");
            return;
        }

        ensureStyle();

        installReceiverPatchCapture();
        armReceiverBackfillCapture();

        if (isCreateMusicPage()) {
            console.log("[staff-patch] create music page detected");
            captureRawEditorFromKnownReceivers();
            installCreateSubjectSubmitHook();
            installCreateSubjectThirdPartySubmitHook();

            const authorized = await ensureAuthorizedOnCreateMusicPage();
            if (!authorized) return;

            installCreateAndCompleteButton();
            installCreateClipboardCapture();

            return;
        }

        if (isEpBatchEditPage()) {
            // 章节批量修改页：只跑「一键填注释」的自动流程，不走条目页那套
            await maybeRunEpCommentFlow();
            return;
        }

        const subjectId = getSubjectId();
        console.log("[staff-patch] subjectId =", subjectId);

        if (!subjectId) return;

        const lastAutoPatchResult = consumeAutoPatchLastResult();
        if (lastAutoPatchResult) {
            console.log("[staff-patch] last immediate submit result =", lastAutoPatchResult);
        }

        injectRepairEntry();
        injectEditDetailEntry();
        installEpCommentFlowEntry();
        installSonglistAutoPatchHook();
        installEditDetailAutoSubmitHook();
        installRelatedPersonAutoSubmitHook();

        const trackRows = await waitForTrackRowsReady();
        console.log("[staff-patch] track keys =", [...trackRows.keys()]);

        snapshotBaseTrackState(trackRows);
        snapshotBaseEpinfoState();
        rebuildSubjectAliasRegistry();

        const data = await fetchPatchData(subjectId);
        STAFF_PATCH_RUNTIME.subjectId = subjectId;
        STAFF_PATCH_RUNTIME.data = data;

        console.log("[staff-patch] fetched data =", data);

        const globalMap = buildGlobalLinkMap();
        STAFF_PATCH_RUNTIME.globalMap = globalMap;
        console.log("[staff-patch] globalMap size =", globalMap.size);

        if (!data) {
            console.log("[staff-patch] no data");
            STAFF_PATCH_RUNTIME.patchMap = {};
        } else {
            const patchMap = buildPatchMapFromData(data);
            const reconciledPatchMap = reconcilePatchMapWithBaseDisplay(patchMap);

            STAFF_PATCH_RUNTIME.patchMap = reconciledPatchMap;
            console.log("[staff-patch] patchMap =", reconciledPatchMap);
        }

        if (isSubjectMainPage()) {
            maybeBootstrapCreatePatchPending(subjectId);
        }

        // const autoTask = getAutoPatchTaskForSubject(subjectId);
        // if (autoTask && hasAnyAutoPatchTask(autoTask)) {
        //     notifyAutoPatchTask("信息处理中", subjectId);
        // }

        tryAutoSubmitPatchFromCurrentDisplay().catch(err => {
            console.warn("[staff-patch] auto patch failed:", err);
        });

        if (isSubjectMainPage()) {
            installPendingPrBanner().catch(err => {
                console.warn("[staff-patch] pending PR banner failed:", err);
            });
        }

    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();