import { type Release, type Track, DefaultDict, durationToSeconds } from "./importSource/common";
import { type SubjectEpInfo, type SubjectRelaPerson } from "./client";

/// Assemble Bangumi API data into a Release
export function assembleRelease(subjectEpInfo: SubjectEpInfo[], subjectRelaPerson: SubjectRelaPerson[]): Release {
    const relaMap0 = DefaultDict(() => [] as string[]); // relation -> names
    const relaMap = DefaultDict(() => DefaultDict(() => DefaultDict(() => [] as string[]))); // disc -> track -> relation -> names
    subjectRelaPerson.forEach(({ name, relation, eps }) => {
        if (eps === "") {
            relaMap0[relation].push(name);
            return;
        }
        const dts = parsePart(eps);
        dts.forEach(([disc, track]) => {
            relaMap[disc][track][relation].push(name);
        });
    });

    const discs = DefaultDict(() => ({} as Record<number, Track>));
    subjectEpInfo.forEach((tr) => {
        const d = tr.disc === 0 ? 1 : tr.disc;
        const rawDuration = tr.duration ?? tr.duration_seconds;
        const durationText = String(rawDuration ?? '').trim();
        const duration = typeof rawDuration === 'number'
            ? rawDuration
            : /^\d+$/.test(durationText)
                ? parseInt(durationText, 10)
                : durationToSeconds(durationText);
        discs[d][tr.ep] = {
            title: tr.name,
            comment: tr.name_cn,
            ...(duration !== null && duration > 0 ? { duration } : {}),
            credits: relaMap[d][tr.ep],
        };
    });
    return {
        credits: relaMap0,
        discs: Array.from(
            { length: Object.keys(discs).length },
            (_, i) => {
                const trm = discs[i + 1];
                return {
                    tracks: Array.from(
                        { length: Math.max(...Object.keys(trm).map(x => parseInt(x))) },
                        (_, j) => trm[j + 1]
                    ).filter(x => x)
                };
            },
        ),
    };
}

/// Parse track number list in single disc (e.g. `1,3-5,7`) or multiple discs (e.g. `1.1, 1.3-5, 2.7`) format
export function parsePart(part: string): [number, number][] {
    if (!part.includes('.')) {
        // single disc
        return part.split(',').flatMap(_parseMaybeRange).map(track => [1, track]);
    }
    return part.split(',').flatMap(x => {
        const [_disc, _tracks] = x.split('.');
        const [disc, tracks] = [parseInt(_disc), _parseMaybeRange(_tracks)];
        return tracks.map(track => [disc, track]) as [number, number][];
    });
}

/// e.g. `3-5` => [3, 4, 5]; `5` => [5]
function _parseMaybeRange(s: string) {
    const [start, end] = s.split('-').map(x => parseInt(x));
    return Array.from({ length: (end || start) - start + 1 }, (_, i) => start + i);
}

const defaultRoleOrder = [
    '制作人', '艺术家', '作词', '作曲', '编曲', '脚本', '声乐', '乐器', '混音', '母带制作',
    '插图', '原作', '出版方', '厂牌', '客串', '和声', '合唱', '人声编辑', '人声指导', '音响监督', '设计'
];

/** `乐器-钢琴` -> `乐器`；`custom-录音棚` -> `custom` */
function baseRoleOf(key: string): string {
    const i = key.indexOf('-');
    return i > 0 ? key.slice(0, i) : key;
}

const UNKNOWN_RANK = Number.MAX_SAFE_INTEGER;

/**
 * 职位的排序位次：规范职位占偶数位，子职位占其基础职位之后的奇数位
 * （`乐器` 在 `乐器-钢琴` 前，两者都落在 `乐器` 原本的那一格）。
 * 表里没有的职位（`custom-*`、`录音-录音棚` 之类）一律排到最后。
 */
function roleRank(key: string): number {
    const exact = defaultRoleOrder.indexOf(key);
    if (exact >= 0) return exact * 2;
    const base = defaultRoleOrder.indexOf(baseRoleOf(key));
    return base >= 0 ? base * 2 + 1 : UNKNOWN_RANK;
}

/**
 * 按规范职位顺序重排 credits：`作词 → 作曲 → 编曲 → …`，`乐器-*`、`声乐-*` 等
 * 子职位紧跟基础职位，规范表里没有的职位排在最后、彼此保持传入顺序（同职位内
 * 人名顺序不受影响）。写入曲目信息、预览、patch 都走这里，顺序只有一处来源。
 */
export function orderedEntries<T>(d: Record<string, T>): [string, T][] {
    return Object.entries(d)
        .map(([key, value], index) => ({ key, value, rank: roleRank(key), index }))
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .map(({ key, value }) => [key, value] as [string, T]);
}
