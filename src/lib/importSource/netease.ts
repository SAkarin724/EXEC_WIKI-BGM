import type {
    AutoEditor,
    CreditLineCandidate,
    CreditReviewData,
    CreditReviewDecision,
    CreditReviewTrack,
    Credits,
    Disc,
    ImportSource
} from "./common";
import {
    applyDurationField,
    discSecondsOf,
    PREFIXABLE_ROLES,
    warningTemplate3rdPartyWiki
} from "./common";
import { instrumentRole } from "$lib/instruments";

/**
 * 网易云音乐专辑导入。
 *
 * 专辑信息与歌词都直连 ncmapi（`access-control-allow-origin: *`，无需自建 worker
 * 代理；该 API 自己已经在 Cloudflare + Vercel CDN 之后）。`realIP` 只能走 query
 * 参数（响应头允许的请求头里没有 X-Real-IP），所以这里按专辑 id 稳定挑池里的一个
 * IP，只有失败才换下一个——避免把 API 的 CDN 缓存打散，也无谓地踩风控。
 *
 * 歌词头里的「作词 : 某人」这类信息只当候选收上来，不做判断：
 * 是否采用、对应哪个职位，由维基人在 `CreditReviewDialog` 里逐曲逐行决定。
 * 未识别的职位一旦被采用，一律写成 `custom-<原文标签>`（项目既有的自定义职位写法）。
 *
 * 网易云常把中文和英文并排写（`制谱 Music Copyist：彭龙飞 Landon Peng`），这里按
 * 「中文 + 空格 + 英文」的固定形态把标签与人名都裁成中文，团体括号 `(HOYO-MiX)` 保留；
 * 纯英文/日文写法（`Produced by`、`カムパネルラ`）原样不动。乐器类标签由
 * `$lib/instruments.ts` 的词表识别成 `乐器-<乐器>`，识别不了才落到 custom。
 */
const NETEASE_API = "https://ncmapi.sakarin724.top";

/** 真实大陆运营商出口 IP，只用于 `realIP` 参数 */
const REAL_IP_POOL = [
    "116.25.146.177",
    "223.104.3.1",
    "117.136.79.20",
    "1.180.24.61",
    "183.232.51.7",
    "120.196.145.3",
];

/** 导入后写进「链接」字段的专辑页（与用户粘贴的形态无关） */
const ALBUM_PAGE = "https://music.163.com/#/album?id=";

/** 单曲页：确认窗口里让每首曲目都能跳去网易云核对 */
export const SONG_PAGE = "https://music.163.com/#/song?id=";

/** 歌词请求的并发数（整张专辑可能 20 首以上） */
const LYRIC_CONCURRENCY = 6;

/** 确认窗口里可选的正式职位（与 postprocess 的 Role 枚举保持一致） */
export const FORMAL_ROLES = [
    "艺术家", "作词", "作曲", "编曲", "制作人", "混音", "母带制作", "录音",
    "声乐", "和声", "合唱", "乐器", "人声编辑", "人声指导", "音响监督",
    "插图", "设计", "原作", "脚本", "出版方", "厂牌", "客串", "念白/旁白",
];

/**
 * 歌词头标签 -> 正式职位。只收「明确的等价写法」；
 * 发行 / 出版 / OP / SP / 出品 / 监制 / 统筹 / 企划 / 调校 / 后期
 * 这些网易云常见但语义含糊的标签故意不入表，留给人工判断。
 * 具体乐器也不在这张表里：它们走 `$lib/instruments.ts` 的词表，识别成 `乐器-<乐器>`。
 *
 * 带子职位的写法（`录音-录音棚`、`声乐-人声`）只加在语义已经明确的一侧：
 * `录音棚`/`Recording Studio` 一定是录音场地，`人声`/`Voice` 一定是声乐轨，
 * 落到子职位比落到裸职位更有信息量，也和站点既有的 `基础职位-子职位` 语法一致。
 */
const LYRIC_ROLE_ALIASES: Record<string, string> = {
    "作词": "作词", "作詞": "作词", "词": "作词", "詞": "作词",
    "lyrics": "作词", "lyric": "作词", "lyricist": "作词", "lyricists": "作词",
    "作曲": "作曲", "曲": "作曲",
    "music": "作曲", "composer": "作曲", "composers": "作曲", "composed by": "作曲",
    "编曲": "编曲", "編曲": "编曲", "arrangement": "编曲", "arranger": "编曲", "arranged by": "编曲",
    "制作人": "制作人", "producer": "制作人", "produced by": "制作人",
    "混音": "混音", "混音师": "混音", "混音工程师": "混音", "mixing": "混音", "mix": "混音", "mixed by": "混音",
    "母带": "母带制作", "母带制作": "母带制作", "母带工程师": "母带制作", "mastering": "母带制作", "mastered by": "母带制作",
    "录音": "录音", "錄音": "录音", "录音师": "录音", "录音工程师": "录音", "recording": "录音", "recorded by": "录音",
    "录音棚": "录音-录音棚", "录音室": "录音-录音棚", "recording studio": "录音-Recording Studio",
    "声乐": "声乐", "vocal": "声乐", "vocals": "声乐", "vocalist": "声乐",
    "人声": "声乐-人声", "voice": "声乐-Voice",
    "和声": "和声", "和聲": "和声", "background vocals": "和声", "backing vocals": "和声",
    "合唱": "合唱", "choir": "合唱", "chorus": "合唱",
    "乐器": "乐器", "演奏": "乐器", "instrument": "乐器", "instruments": "乐器", "instrumental": "乐器",
    "插图": "插图", "插画": "插图", "illustration": "插图", "illust": "插图", "illustrator": "插图",
    "设计": "设计", "design": "设计", "designer": "设计",
    "原作": "原作", "original": "原作",
    "脚本": "脚本", "script": "脚本",
    "出版方": "出版方", "publisher": "出版方",
    "厂牌": "厂牌", "label": "厂牌",
    "客串": "客串", "featuring": "客串", "featured": "客串",
    "念白人声": "念白/旁白", "念白": "念白/旁白", "旁白": "念白/旁白",
    "人声编辑": "人声编辑", "vocal edit": "人声编辑", "vocal editing": "人声编辑",
    "人声指导": "人声指导", "vocal direction": "人声指导",
    "音响监督": "音响监督", "sound direction": "音响监督", "sound director": "音响监督",
};

/** 厂牌名里带分隔符时用书名号括起来，否则写进曲目列表会被拆成多个人 */
const RE_LABEL_SEP = /[ 　\t&＆:：\/・、；,]/;
const RE_LATIN_SPACE = /[A-Za-z] [A-Za-z]/;
/** 拉丁字母：网易云双语写法「中文 + 空格 + 英文」的分界 */
const RE_LATIN = /[A-Za-z]/;
/** 汉字（不含假名），用来判断「有没有中文可留」 */
const RE_HAN = /\p{Script=Han}/u;
/** 汉字/间隔号，取人名里的中文前缀 */
const RE_HAN_HEAD = /^[\p{Script=Han}·・]+/u;

/** 专辑 `type` -> Infobox「版本特性」的取值（默认不写，选项默认关） */
const TYPE2FORMAT: Record<string, string> = {
    "专辑": "Album",
    "album": "Album",
    "single": "Single",
    "单曲": "Single",
    "ep": "EP",
    "精选集": "Compilation",
    "合辑": "Compilation",
    "compilation": "Compilation",
    "原声带": "Soundtrack",
    "soundtrack": "Soundtrack",
};

interface NeteaseAlbum {
    id: number;
    name: string;
    type: string;
    subType: string;
    company: string;
    description: string;
    briefDesc: string;
    publishTime: number;
    picUrl: string;
    size: number;
    /** 别名，网页上以 `专辑名 (别名)` 的括号形式显示 */
    alias?: string[];
}

interface NeteaseSong {
    id: number;
    name: string;
    no: number;
    cd: string;
    dt: number;
    ar: { id: number; name: string }[];
    /** 别名 */
    alia?: string[];
    /** 翻译名，网页上曲名后的括号优先显示它 */
    tns?: string[];
}

interface AlbumData {
    album: NeteaseAlbum;
    songs: NeteaseSong[];
}

interface LyricData {
    lrc: string;
    yrc: string;
}

/** 不可重试的错误（例如专辑确实不存在） */
class FatalImportError extends Error {}

export class Netease implements ImportSource {
    name = "网易云音乐";
    // 覆盖 /album/123、/#/album?id=123、/m/album?id=123、y.music.163.com/m/... 以及尾巴参数
    match = /^https?:\/\/(?:y\.)?music\.163\.com\/(?:#\/|m\/)?album(?:\/|\?id=)(\d+)/i;
    warning = warningTemplate3rdPartyWiki("网易云音乐");
    options = [
        { id: "trackListCredits", text: "曲目列表与制作人员", default: true },
        { id: "titleIntro", text: "标题与简介", default: true },
        { id: "splitTitle", text: "曲名/专辑名中英并列时只保留中文（英文写进曲目注释与专辑别名）", default: true },
        { id: "lyricCredits", text: "歌词里的词曲信息（导入前会逐曲要你确认）", default: true },
        { id: "length", text: "播放时长", default: true },
        { id: "releaseDate", text: "发售日期", default: true },
        { id: "alias", text: "别名", default: true },
        { id: "links", text: "条目链接", default: true },
        { id: "cover", text: "封面图", default: true },
        { id: "formatType", text: "版本特性", default: false },
    ];

    private albumId = "";
    private albumInfo: Promise<AlbumData> | null = null;
    /** 歌词拉取过程中的提示（在 apply 末尾一次性抛给用户） */
    private lyricWarnings: string[] = [];

    async load(url: string): Promise<string> {
        const id = this.match.exec(url)![1];
        this.albumId = id;
        this.lyricWarnings = [];
        this.albumInfo = fetchAlbum(id);
        return (await this.albumInfo).album.name;
    }

    /**
     * 拉取每首曲目的歌词、把歌词头解析成候选职员行，交给确认窗口。
     * 专辑本身没取到时不在这里报错（apply 会统一报），直接返回 null。
     */
    async review(opts: { [key: string]: any }): Promise<CreditReviewData | null> {
        if (!opts.lyricCredits || !this.albumInfo) return null;

        let data: AlbumData;
        try {
            data = await this.albumInfo;
        } catch {
            return null;
        }
        if (!data.songs.length) return null;

        const ip = pickIp(this.albumId, 0);
        const tracks: CreditReviewTrack[] = [];
        let failed = 0;

        for (let i = 0; i < data.songs.length; i += LYRIC_CONCURRENCY) {
            const chunk = data.songs.slice(i, i + LYRIC_CONCURRENCY);
            const results = await Promise.all(chunk.map(async (song) => {
                try {
                    const lyric = await fetchLyric(song.id, ip);
                    if (lyric === null) {
                        return {
                            song,
                            lines: [] as CreditLineCandidate[],
                            lyric: "",
                            failed: false,
                        };
                    }
                    return {
                        song,
                        lines: parseLyricCredits(lyric),
                        lyric: plainLyric(lyric),
                        failed: false,
                    };
                } catch {
                    return { song, lines: [] as CreditLineCandidate[], lyric: "", failed: true };
                }
            }));

            for (const result of results) {
                if (result.failed) failed++;
                // 解析不出职位的曲目也交上去：窗口里能看歌词、能手动补行
                tracks.push({
                    songId: result.song.id,
                    title: result.song.name.trim(),
                    lines: mergeCandidates(result.lines),
                    lyric: result.lyric,
                });
            }
        }

        if (failed > 0) {
            this.lyricWarnings.push(`${failed} 首曲目的歌词获取失败，这些曲目没有提供词曲信息`);
        }
        // 一行都没有、歌词也读不到时，没必要拿空窗口拦人
        return tracks.some((track) => track.lines.length > 0 || track.lyric) ? { tracks } : null;
    }

    async apply(opts: { [key: string]: any }, editor: AutoEditor): Promise<void> {
        let data: AlbumData;
        try {
            data = await this.albumInfo!;
        } catch (e) {
            editor.pushWarning(`导入失败：${messageOf(e)}`);
            editor.done();
            return;
        }

        const decisions = (opts.creditReview ?? []) as CreditReviewDecision[];
        const lyricCredits = new Map(decisions.map((d) => [d.songId, d.credits]));
        const discs = buildDiscs(data.songs, lyricCredits, {
            alias: !!opts.alias,
            splitTitle: !!opts.splitTitle,
        });

        if (opts.trackListCredits) {
            const company = data.album.company?.trim();
            const credits: Credits = company ? { 厂牌: [quoteLabel(company)] } : {};
            if (discs.length === 0) {
                editor.pushWarning("这个专辑里没有曲目");
            } else {
                // `import` 风格按 credits 原顺序逐曲写「职位：人名」，不会像默认风格那样
                // 按人名反向聚合再排序——窗口里的行序、预览、落盘文本三者才能一致
                editor.setTrackInfo({ credits, discs }, 'import');
            }
        }

        if (opts.length) {
            const discSeconds = discSecondsOf(discs);
            const total = discSeconds.reduce<number>((sum, s) => sum + (s ?? 0), 0);
            applyDurationField(editor, discSeconds, total);
        }

        const albumTitle = opts.splitTitle ? splitBilingual(data.album.name) : null;

        if (opts.titleIntro) {
            editor.editTitleIntro(
                albumTitle?.zh ?? data.album.name,
                cleanIntro(data.album.description || data.album.briefDesc || "")
            );
        }

        if (opts.alias) {
            // 中英并列时，英文原名并进别名，不丢信息
            const aliases = Array.from(new Set([
                ...albumAliases(data.album),
                ...(albumTitle ? [albumTitle.en] : []),
            ]));
            if (aliases.length > 0) {
                // `|别名={` 是列表字段，每一项写成 `[值]`
                editor.setInfoBoxField("别名", aliases.map((a): [string, string] => ["", a]));
            }
        }

        if (opts.releaseDate) {
            const date = beijingDate(data.album.publishTime);
            if (date) editor.setInfoBoxField("发售日期", date);
        }

        if (opts.formatType) {
            const format = TYPE2FORMAT[(data.album.type ?? "").trim().toLowerCase()];
            if (format) editor.setInfoBoxField("版本特性", format);
        }

        if (opts.links) {
            editor.setInfoBoxField("链接", [[this.name, `${ALBUM_PAGE}${data.album.id}`]]);
        }

        if (opts.cover && data.album.picUrl) {
            try {
                await editor.setCover(`${data.album.picUrl}?param=2000y2000`);
            } catch (e) {
                editor.pushWarning(`封面导入失败：${messageOf(e)}`);
            }
        }

        for (const warning of this.lyricWarnings) {
            editor.pushWarning(warning);
        }

        editor.done();
    }
}

/** 专辑详情：`realIP` 按专辑 id 稳定取，失败时换池里的下一个，最多 3 次 */
async function fetchAlbum(id: string): Promise<AlbumData> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
        const ip = pickIp(id, attempt);
        try {
            const res = await fetch(`${NETEASE_API}/album?id=${id}&realIP=${ip}`, { mode: "cors" });
            const text = await res.text();

            let json: any = null;
            try {
                json = JSON.parse(text);
            } catch {
                // 不是 JSON：多半是 API 挂了或者返回了网关错误页
            }

            if (res.status === 404 || json?.code === 404) {
                throw new FatalImportError("专辑不存在或已下架");
            }
            if (!res.ok || json === null || json.code !== 200 || !json.album || !Array.isArray(json.songs)) {
                lastError = new Error(json?.msg ?? `HTTP ${res.status}`);
                continue;
            }

            return { album: json.album as NeteaseAlbum, songs: json.songs as NeteaseSong[] };
        } catch (e) {
            if (e instanceof FatalImportError) throw e;
            lastError = e instanceof Error ? e : new Error(String(e));
        }
    }

    throw lastError ?? new Error("接口没有返回可用的专辑数据");
}

/** 歌词按 songId 缓存（失败不缓存，换一次导入还能再试） */
const lyricCache = new Map<number, Promise<LyricData>>();

/**
 * 取一首曲目的歌词：优先 `yrc.lyric`（部署支持逐字歌词时才有），
 * 退回 `lrc.lyric`。两者都空则返回 null。
 */
async function fetchLyric(songId: number, ip: string): Promise<string | null> {
    let promise = lyricCache.get(songId);
    if (!promise) {
        const created = (async (): Promise<LyricData> => {
            const res = await fetch(
                `${NETEASE_API}/lyric?id=${songId}&lv=-1&kv=-1&tv=-1&realIP=${ip}`,
                { mode: "cors" }
            );
            const text = await res.text();

            let json: any = null;
            try {
                json = JSON.parse(text);
            } catch {
                // 同上：非 JSON 当失败处理
            }
            if (!res.ok || json === null || json.code !== 200) {
                throw new Error(json?.msg ?? `HTTP ${res.status}`);
            }
            return { lrc: json.lrc?.lyric ?? "", yrc: json.yrc?.lyric ?? "" };
        })();
        promise = created;
        lyricCache.set(songId, created);
        created.catch(() => {
            if (lyricCache.get(songId) === created) lyricCache.delete(songId);
        });
    }

    const lyric = await promise;
    // 有 yrc 且能从里面认出歌词头才用 yrc；否则退回 lrc（文本头更干净）
    if (lyric.yrc && parseLyricCredits(lyric.yrc).length > 0) return lyric.yrc;
    return lyric.lrc.trim() ? lyric.lrc : null;
}

/**
 * 从歌词里收集「职位 : 人名」候选行。
 *
 * 只看歌词最前面的几行：网易云的歌词头都是 `[00:00.000] 作词 : X` 这种连号时间戳，
 * 正文第一句出现时头部就结束了，所以遇到第一行不像职位行就停——不做全文扫描，
 * 也就不存在把歌词正文当职员的风险以外的猜测。正文里带冒号的句子偶尔会被收进来，
 * 但那也只是窗口里多一条默认不勾选的未识别行，不会自己写进曲目列表。
 */
export function parseLyricCredits(text: string): CreditLineCandidate[] {
    if (!text) return [];

    const candidates: CreditLineCandidate[] = [];
    for (const line of lyricLines(text)) {
        if (!line.text) continue;
        if (line.time > 30) break;
        if (isInstrumentalNotice(line.text)) continue;

        // 人名一侧不设长度上限：`作曲 : A / B / C / D / E` 动辄一百多字，
        // 旧上限会让这一行匹配失败、进而把后面所有职位行都截掉（只剩第一行）
        const m = /^([^:：]{1,40})[:：]\s*(.+)$/.exec(line.text);
        if (!m) break;

        // 双语标签（`录音棚 Recording Studio`）会超过旧上限；先归一成中文再判断
        const rawLabel = m[1].trim();
        const label = toChineseLabel(rawLabel);
        // 不带拉丁字母的长标签基本是歌词正文；双语标签天然带拉丁，不受这条限制
        if (!RE_LATIN.test(rawLabel) && label.length > 8) break;
        if (!looksLikeRoleLabel(label)) break;

        // 两级职位叠写（`合唱 Choir：童声合唱指挥…：李烨琳`）：先按子职位合并再切人名
        const nested = splitNestedRole(label, m[2]);
        const names = splitNames(nested ? nested.names : m[2]);
        if (names.length === 0) break;

        if (nested) {
            candidates.push({
                raw: line.text.trim(),
                label,
                names,
                role: nested.role,
                flag: 'nested-role'
            });
            continue;
        }

        pushCandidates(candidates, label, names, line.text.trim());
    }

    return candidates;
}

interface LyricLine {
    /** 秒；yrc 的行时间拿不到具体值，统一按 0（头部都在最前面） */
    time: number;
    text: string;
}

/** 去掉时间戳与逐字标记，只留「这一行的文字」 */
function lyricLines(text: string): LyricLine[] {
    const lines: LyricLine[] = [];

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;

        const lrc = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\](.*)$/.exec(line);
        if (lrc) {
            const millis = lrc[3] ? parseInt(lrc[3].padEnd(3, "0"), 10) : 0;
            lines.push({
                time: parseInt(lrc[1], 10) * 60 + parseInt(lrc[2], 10) + millis / 1000,
                text: stripWordTiming(lrc[4]),
            });
            continue;
        }

        // yrc：`[起始毫秒,时长](字起点,字时长,0)字…`，把逐字标记去掉就是整行文字
        const yrc = /^\[\d+,\d+\](.*)$/.exec(line);
        if (yrc) {
            lines.push({ time: 0, text: stripWordTiming(yrc[1]) });
            continue;
        }

        // [by:xxx] / [offset:0] 之类的元信息，忽略
    }

    return lines;
}

/** 整首歌词的纯文本（去时间戳 / 逐字标记），给确认窗口里对照原文用 */
function plainLyric(text: string): string {
    return lyricLines(text)
        .map((line) => line.text)
        .filter(Boolean)
        .join("\n");
}

function stripWordTiming(text: string): string {
    return text.replace(/\(\d+,\d+,\d+\)/g, "").trim();
}

function isInstrumentalNotice(text: string): boolean {
    return /纯音乐|纯音樂|请欣赏|請欣賞|没有填词|沒有填詞|instrumental/i.test(text);
}

/** 标签里出现句读符号基本就是歌词正文，不是职位 */
function looksLikeRoleLabel(label: string): boolean {
    if (!label) return false;
    if (/[（）()「」『』。！？!?，,；;：:]/.test(label)) return false;
    // 单字标签只认职位表 / 乐器词表里的明确写法（`曲`、`箫`、`鼓`），
    // 免得把歌词里「洛：…」的歌者标记当职位
    return label.length > 1 || lookupRole(label) !== null || instrumentRole(label) !== null;
}

function lookupRole(label: string): string | null {
    return LYRIC_ROLE_ALIASES[label.toLowerCase()] ?? null;
}

/**
 * 职位文本 -> 正式职位：先查职位别名表，再查乐器词表（`巴扬` → `乐器-巴扬`）。
 *
 * 导出给确认窗口的 `toRoleId` 用：自动识别与人工手填必须落在同一套映射上，
 * 否则窗口里手打「人声」「录音棚」会和自动识别结果分叉。
 */
export function lookupLyricRole(label: string): string | null {
    return lookupRole(label) ?? instrumentRole(label);
}

/** 人名只按分隔符切，连接词（feat. / & 之类）留给后续既有逻辑处理 */
function splitNames(text: string): string[] {
    return Array.from(
        new Set(
            text
                .split(/[\/／、＆&;；]+/)
                .map((s) => toChineseCreatorName(s))
                .filter(Boolean)
        )
    );
}

/**
 * 职位标签只留中文：`制谱 Music Copyist` → `制谱`、`混音师 MixingEngineer` → `混音师`。
 * 纯英文标签（`Produced by`）原样返回，交给职位表按英文别名匹配。
 */
export function toChineseLabel(label: string): string {
    const text = label.trim();
    const i = text.search(/[A-Za-z]/);
    if (i <= 0) return text;

    // 中文前缀可能以括注/分隔符收尾（`巴扬（Bayan）`），一并去掉
    const head = text
        .slice(0, i)
        .trim()
        .replace(/[\s・、,，/／&＆+＋\-…—:：;；·（(【\[]+$/, "");
    return head || text;
}

/**
 * 人名只留中文、保留末尾团体括号：
 * `李洋 Yang Lee (HOYO-MiX)` → `李洋 (HOYO-MiX)`、`伦敦交响乐团 London Symphony Orchestra` → `伦敦交响乐团`。
 * 没有中文、或中文之后没有英文的写法（`Robert Ziegler`、`HOYO-MiX`、`カムパネルラ`）原样返回。
 */
export function toChineseCreatorName(name: string): string {
    const text = name.trim();
    if (!text) return text;

    // 末尾括号可能是团体名，先摘出来再裁
    const m = /^(.*?)\s*[（(]\s*([^（）()]*?)\s*[）)]$/.exec(text);
    const main = m ? m[1].trim() : text;
    const group = m ? m[2].trim() : "";

    const head = RE_HAN_HEAD.exec(main)?.[0] ?? "";
    const rest = main.slice(head.length).trim();
    // 至少两个汉字前缀 + 后面还有拉丁字母，才认定是「中文 + 英文」的并排写法
    if (head.length < 2 || !RE_LATIN.test(rest)) return text;

    return group ? `${head} (${group})` : head;
}

/**
 * 一条「标签 : 人名」可能是合并写法（`作词/作曲 : A`）。
 * 只有每一片都是已知职位时才拆成多行——拆不动就整条当未识别。
 */
function pushCandidates(
    out: CreditLineCandidate[],
    label: string,
    names: string[],
    raw: string
): void {
    const parts = label.split(/[\/＆&、]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length > 1) {
        const roles = parts.map(resolveRole);
        if (roles.every((role) => role !== null)) {
            parts.forEach((part, i) => {
                out.push({ raw, label: part, names, role: roles[i] });
            });
            return;
        }
    }

    out.push({ raw, label, names, role: resolveRole(label) });
}

/**
 * 两级职位叠写：`合唱 Choir：童声合唱指挥 Children's Choir Conductor：李烨琳 Yelin Li`
 * → `合唱-童声合唱指挥：李烨琳`。
 *
 * 只认「基础职位可带子职位 + 中间那段像个职位标签」的形状，普通的 `职位：人名`
 * 不会进这里。写法极少见，认出来之后会在确认窗口里标 `两级职位`，让人复核。
 */
function splitNestedRole(label: string, nameText: string): { role: string; names: string } | null {
    const base = resolveRole(label);
    if (!base || !(PREFIXABLE_ROLES as readonly string[]).includes(base)) return null;

    const m = /^([^:：]{1,40})[:：]\s*(.+)$/.exec(nameText.trim());
    if (!m) return null;

    // 子职位也按同一套规则只留中文（`童声合唱指挥 Children's Choir Conductor`）
    const sub = toChineseLabel(m[1].trim());
    if (!sub || !looksLikeRoleLabel(sub)) return null;

    return { role: `${base}-${sub}`, names: m[2].trim() };
}

/** 标签 -> 正式职位：先查职位别名表，再查乐器词表（`巴扬` → `乐器-巴扬`） */
function resolveRole(label: string): string | null {
    return lookupLyricRole(label);
}

/** 同一曲目里同一个正式职位出现多次时合并人名（未识别的行各自保留，便于分别判断） */
function mergeCandidates(lines: CreditLineCandidate[]): CreditLineCandidate[] {
    const merged: CreditLineCandidate[] = [];
    const byRole = new Map<string, CreditLineCandidate>();

    for (const line of lines) {
        if (line.role === null) {
            merged.push(line);
            continue;
        }
        const existing = byRole.get(line.role);
        if (existing) {
            existing.names = Array.from(new Set([...existing.names, ...line.names]));
            // 合并后仍保留「需要复核」的标记，不然合并会把它抹掉
            if (line.flag && !existing.flag) existing.flag = line.flag;
            continue;
        }
        const copy: CreditLineCandidate = { ...line, names: [...line.names] };
        byRole.set(line.role, copy);
        merged.push(copy);
    }

    return merged;
}

/**
 * 网易云网页在名字后用括号补的那个称呼：曲目优先翻译名 `tns`，其次别名 `alia`。
 * 只取网页显示的那一个，名字里本来就带括号的（`XXX (Live)`）不拆。
 */
function songAliasName(song: NeteaseSong): string {
    const name = song.name.trim();
    return (
        [...(song.tns ?? []), ...(song.alia ?? [])]
            .map((s) => s?.trim())
            .find((s): s is string => !!s && s !== name) ?? ""
    );
}

/** 专辑别名（网页上 `专辑名 (别名)` 的括号内容） */
function albumAliases(album: NeteaseAlbum): string[] {
    const name = album.name.trim();
    return Array.from(
        new Set(
            (album.alias ?? [])
                .map((s) => s?.trim())
                .filter((s): s is string => !!s && s !== name)
        )
    );
}

/** 曲名/专辑名的处理开关，都由导入选项决定 */
interface TitleOptions {
    /** 「别名」开关：曲名末尾的中文括注转成 `// 注释` */
    alias: boolean;
    /** 中英并列的曲名/专辑名只留中文，曲名英文进注释、专辑名英文进别名 */
    splitTitle: boolean;
}

/** 汉字个数（`（日）` 只有 1 个，`(Live)` 是 0 个） */
function hanCount(text: string): number {
    return text.replace(/[^\p{Script=Han}]/gu, "").length;
}

/**
 * 曲名末尾的中文括注：`Silhouette in the Waves (换装pv「浮夏丽影」配乐)`。
 * 只有括号里有两个以上汉字才当注释——`（日）`、`(Live)`、`(Bayan Version)`
 * 这类是曲名的组成部分（语言/版本标记），拆出去反而丢信息。
 */
function splitTrailingParen(name: string): { main: string; note: string } | null {
    const m = /^(.*?)\s*[（(]\s*([^（）()]{1,80})\s*[）)]$/.exec(name.trim());
    if (!m) return null;

    const main = m[1].trim();
    const note = m[2].trim();
    if (!main || !note || hanCount(note) < 2) return null;

    return { main, note };
}

/**
 * 「中文 + 空格 + 英文」的并列标题：`原神-悯宥慈怜之垠 Where Mercy Endures`。
 * 第一个拉丁字母之前必须是汉字，否则不拆（纯英文标题不受影响）。
 */
function splitBilingual(name: string): { zh: string; en: string } | null {
    const text = name.trim();
    const i = text.search(RE_LATIN);
    if (i <= 0) return null;

    const zh = text.slice(0, i).trim();
    const en = text.slice(i).trim();
    if (!zh || !en || !RE_HAN.test(zh)) return null;

    return { zh, en };
}

/** 曲名 -> 标题与 `// 注释`：括注、英文原名、网页上的翻译名都在注释里并列 */
function trackNameOf(song: NeteaseSong, opts: TitleOptions): { title: string; comment: string } {
    const raw = song.name.trim();
    const paren = opts.alias ? splitTrailingParen(raw) : null;
    const base = paren ? paren.main : raw;
    const bilingual = opts.splitTitle ? splitBilingual(base) : null;

    const comment = Array.from(
        new Set([paren?.note ?? "", bilingual?.en ?? "", songAliasName(song)].filter(Boolean))
    ).join(" // ");

    return { title: bilingual ? bilingual.zh : base, comment };
}

function buildDiscs(
    songs: NeteaseSong[],
    lyricCredits?: Map<number, Credits>,
    opts: TitleOptions = { alias: false, splitTitle: false }
): Disc[] {
    const byDisc = new Map<number, NeteaseSong[]>();

    for (const song of songs) {
        const disc = parseInt(String(song.cd ?? "1"), 10) || 1;
        const list = byDisc.get(disc);
        if (list) list.push(song);
        else byDisc.set(disc, [song]);
    }

    return Array.from(byDisc.entries())
        .sort(([a], [b]) => a - b)
        .map(([, list]) => ({
            tracks: [...list]
                .sort((a, b) => (a.no ?? 0) - (b.no ?? 0))
                .map((song) => {
                    const credits: Credits = {};
                    const artists = (song.ar ?? []).map((a) => a.name).filter(Boolean);
                    if (artists.length > 0) credits["艺术家"] = artists;
                    Object.assign(credits, lyricCredits?.get(song.id) ?? {});

                    return {
                        ...trackNameOf(song, opts),
                        ...(song.dt > 0 ? { duration: song.dt / 1000 } : {}),
                        credits,
                    };
                }),
        }));
}

/** 同一专辑固定同一个 IP（命中 API 自己的 CDN 缓存），重试才往后挪 */
function pickIp(seed: string, offset: number): string {
    const n = parseInt(seed.replace(/\D/g, ""), 10) || 0;
    return REAL_IP_POOL[(n + offset) % REAL_IP_POOL.length];
}

function quoteLabel(name: string): string {
    return RE_LABEL_SEP.test(name) && !RE_LATIN_SPACE.test(name) ? `《${name}》` : name;
}

/** 网易云的简介里混着 `<br>` 和 HTML 实体，粗洗一遍即可 */
function cleanIntro(raw: string): string {
    return raw
        .replace(/\r\n?/g, "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|h\d)>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/[ \t\u00a0]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/** `publishTime` 是北京时间零点的毫秒值，必须按 UTC+8 取日期 */
function beijingDate(ms: number): string {
    if (!ms || ms <= 0) return "";
    return new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
}

function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}