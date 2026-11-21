
export interface ImportSource {
    name: string;
    match: RegExp;
    warning: string;
    options: ImportSourceOption[];
    load: (url: string) => Promise<string>;
    apply: (opts: { [key: string]: any }, editor: AutoEditor) => Promise<void>;
    search?: (query: string) => Promise<SearchResultEntry[]>;
}

export interface ImportSourceOption {
    id: string;
    text: string;
    default: any;
}

export interface AutoEditor {
    associableFields: Set<string>;
    editTitleIntro: (title: string, intro: string) => void;
    setTrackInfo: (info: Release, style?: 'parts' | 'tracks' | 'import') => void;
    setTrackInfoText: (text: string) => void;
    setInfoBox: (content: string, override: boolean) => void;
    setInfoBoxField: (field: string, value: string | [string, string][], options?: { editOnly?: boolean }) => boolean;
    unlinkInfoBoxField: (field: string) => void;
    setMetaTags: (tags: string[]) => void;
    /** 从 URL 拉取封面图并设为当前条目的封面（失败时抛错） */
    setCover: (url: string) => Promise<void>;
    importRela: (pids: number[]) => void;
    setSID: (sid: number) => void;
    pushWarning: (warning: string) => void;
    done: () => void;
}

export interface Release {
    credits: Credits;
    discs: Disc[];
}

export interface Disc {
    tracks: Track[];
}

export interface Track {
    title: string;
    comment: string;
    /** 曲目时长（秒）；undefined = 没有写 */
    duration?: number;
    credits: Credits;
}

export type Credits = Record<string, string[]>;

export interface SearchResultEntry {
    title: string;
    subtitle: string;
    url: string;
    date: string;
    imgThumbnail: string;
    imgOriginal: string;
}

export function warningTemplate3rdPartyWiki(name: string): string {
    return `
类似班古米，${name} 是由爱好者们维护的第三方维基站，信息可能有错漏。
建议优先采用官方信息。如需使用 ${name} 的信息，请先核对。

建议仅在满足下列任一情况时使用：
<ol><li>已比对自己买到的小册子/维基站上提供的小册子扫图</li>
<li>已比对作者的官方网站或官方指定贩售渠道上的信息</li>
<li>网上能找到的信息实在太少，连用 Wayback Machine 都翻不出任何信息</li></ol>
`.trim().split("\n").join("<br />");
}

type DefaultDictType<K extends PropertyKey, V> = { [P in K]: V; } & { [key: PropertyKey]: V; };
export function DefaultDict<K extends PropertyKey, V>(defaultInit: () => V): DefaultDictType<K, V> {
    return new Proxy({} as DefaultDictType<K, V>, {
        get: (target, name: PropertyKey) => name in target ? target[name] : ((target as any)[name] = defaultInit())
    })
}

/** 秒 -> `hh:mm:ss`（不走 Date，超过 24 小时也不会溢出/回绕） */
export function secondsToHMS(seconds: number): string {
    const total = Math.max(0, Math.round(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;

    return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

export function formatDuration(seconds: number): string {
    return secondsToHMS(seconds);
}

/** 秒 -> 曲目行用的 `mm:ss`（不足 1 小时）或 `hh:mm:ss` */
export function secondsToTrackDuration(seconds: number): string {
    const total = Math.max(0, Math.round(seconds));
    if (total >= 3600) return secondsToHMS(total);

    const m = Math.floor(total / 60);
    const s = total % 60;
    return [m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

/**
 * `mm:ss` / `h:mm:ss` -> 秒；认不出来返回 null。
 * （纯秒数不认，属不规范写法。）
 */
export function durationToSeconds(value: string): number | null {
    const text = String(value ?? '').trim();
    if (!text) return null;

    const m = text.match(/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/);
    if (!m) return null;

    const [, a, b, c] = m;
    const n = (s: string) => parseInt(s, 10);

    if (c !== undefined) {
        if (n(b) > 59 || n(c) > 59) return null;
        return n(a) * 3600 + n(b) * 60 + n(c);
    }
    if (n(b) > 59) return null;
    return n(a) * 60 + n(b);
}

/** 把「播放时长」的写法归一成 `hh:mm:ss`；认不出来返回 null（保持原样） */
export function normalizeDuration(value: string): string | null {
    const sec = durationToSeconds(value);
    return sec === null ? null : secondsToHMS(sec);
}

/**
 * 逐碟时长（秒）：某碟非空且每首都有正时长才给出数字，否则 null。
 * 用于「播放时长」字段，允许只补了部分碟的曲目表。
 */
export function discSecondsOf(discs: Disc[]): (number | null)[] {
    return discs.map((disc) => {
        const { tracks } = disc;
        if (!tracks.length) return null;
        if (!tracks.every((t) => typeof t.duration === 'number' && t.duration > 0)) return null;
        return tracks.reduce((sum, t) => sum + (t.duration ?? 0), 0);
    });
}

/**
 * 构造「播放时长」字段的值：
 *   单碟有效 -> 单行 `hh:mm:ss`（等效 `{ [hh:mm:ss] }`）
 *   多碟 -> `[["DISC 1", "hh:mm:ss"], ...]`，只列出时长齐备的碟，不写总时长行
 *   无可用数据 -> null（调用方不应写入该字段）
 * @param discSeconds 每碟秒数；null/非正数 = 该碟时长未知
 * @param totalSeconds 外部给出的总时长（如第三方站的合计收录时间），仅在无可用的碟时回退
 */
export function buildDurationValue(
    discSeconds: (number | null)[],
    totalSeconds = 0
): string | [string, string][] | null {
    const known = discSeconds.filter((s): s is number => typeof s === 'number' && s > 0);

    if (discSeconds.length > 1) {
        if (!known.length) return totalSeconds > 0 ? secondsToHMS(totalSeconds) : null;
        return discSeconds
            .map((s, i): [string, string] | null =>
                typeof s === 'number' && s > 0 ? [`DISC ${i + 1}`, secondsToHMS(s)] : null
            )
            .filter((item): item is [string, string] => item !== null);
    }

    const single = known[0] ?? totalSeconds;
    return single > 0 ? secondsToHMS(single) : null;
}

/** 把逐碟时长写进 Infobox 的「播放时长」；没有可用数据时保持原样。 */
export function applyDurationField(
    editor: AutoEditor,
    discSeconds: (number | null)[],
    totalSeconds = 0
): boolean {
    const value = buildDurationValue(discSeconds, totalSeconds);
    if (value === null) return false;
    return editor.setInfoBoxField('播放时长', value);
}