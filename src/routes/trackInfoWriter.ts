import { type Release, type Credits } from "$lib/importSource";
import { RE_ROLE_KEYWORD, pagenoJoin, multiDiscPageNoJoin, Role, stripRedundantAlias, Release as FormalRelease } from "./postprocess";
import { hasArtistJoinerSyntax, isComposedName, matchCreatorUnits, resolvePlainStarring, shouldJoinStarring } from "./artistJoiner";
import { isQuotedCreatorName } from "./nameQuoting";
import { splitStarringCredit } from "./starringCredit";
import type { ResolvedRelaMap } from "./disambiguation";
import { orderedEntries } from "$lib/bangumiUtils";

const RE_SEP = /[ 　\t&＆:：\/・、；,]/;
const RE_LATIN_SPACE = /[A-Za-z] [A-Za-z]/;

export { type Release };

export function writeTrackInfo(info: Release, style: 'parts' | 'tracks' | 'default' = 'default'): string {
    switch (style) {
        case 'parts': return writeTrackInfoCreditParts(info);
        case 'tracks': return writeTrackInfoCreditTracks(info);
    }
    // Use the parts-style credits only for simple cases; otherwise use the tracks-style credits.
    if (info.discs.length > 1) return writeTrackInfoCreditTracks(info);
    const trackCreators = new Set<string>();
    info.discs.forEach((disc) => {
        disc.tracks.forEach((tr) => {
            Object.values(tr.credits).forEach((names) => {
                names.forEach((name) => trackCreators.add(name));
            });
        });
    });
    if (trackCreators.size >= 5) return writeTrackInfoCreditTracks(info);
    return writeTrackInfoCreditParts(info);
}

function writeTrackInfoCreditTracks(info: Release): string {
    const isMulti = info.discs.length > 1;
    let trackInfo = Object.keys(info.credits).length > 0 ? formatCredits(info.credits) + '\n' : '';
    trackInfo += info.discs.map((disc) => {
        let s = isMulti ? "\nDISC\n" : "";
        s += disc.tracks.map((tr, i) => {
            let t = disc.tracks.length > 1 ? `${String(i + 1).padStart(2, '0')} ${tr.title}` : tr.title;
            t = RE_ROLE_KEYWORD.test(t) ? `《${t}》` : t;
            if (tr.comment) t += ` // ${tr.comment}`;
            t += '\n';
            if (Object.keys(tr.credits).length > 0) {
                t += formatCredits(tr.credits);
            }
            return t;
        }).join('\n');
        return s;
    }).join('\n');
    return trackInfo;
}

function writeTrackInfoCreditParts(info: Release): string {
    const isMulti = info.discs.length > 1;
    let trackInfo = Object.keys(info.credits).length > 0 ? formatCredits(info.credits) + '\n' : '';

    const pt = {} as Record<string, Record<string, number[][]>>;
    info.discs.forEach((disc, i) => {
        disc.tracks.forEach((tr, j) => {
            Object.entries(tr.credits).forEach(([role, names]) => {
                pt[role] = pt[role] ?? {};
                names.forEach((name) => {
                    pt[role][name] = pt[role][name] ?? Array(info.discs.length).fill(null).map(() => []);
                    pt[role][name][i].push(j + 1);
                });
            });
        });
    });
    trackInfo += orderedEntries(pt).map(([role, names]) => {
        return `${role}：${Object.entries(names).map(([name, ps]) => {
            return `${nameEscape(name)}(${isMulti ? multiDiscPageNoJoin(ps) : pagenoJoin(ps.flat())})`;
        }).join('、')}\n`;
    }).join('') + '\n';

    trackInfo += info.discs.map((disc) => {
        let s = isMulti ? "\nDISC\n" : "";
        s += disc.tracks.map((tr, i) => {
            let t = disc.tracks.length > 1 ? `${String(i + 1).padStart(2, '0')} ${tr.title}` : tr.title;
            t = RE_ROLE_KEYWORD.test(t) ? `《${t}》` : t;
            if (tr.comment) t += ` // ${tr.comment}`;
            t += '\n';
            return t;
        }).join('\n');
        return s;
    }).join('\n');
    return trackInfo;
}

export function fromFormalRelease(rf: Readonly<FormalRelease>, name2staff?: ResolvedRelaMap): Release {
    const r: Release = {
        credits: {},
        discs: rf.tracks.map((d) => ({
            tracks: d.map((t) => ({ title: t.title, comment: t.comment, credits: {} }))
        }))
    }
    let pushCredit: (credit: Credits, role: string, name: string) => void;
    if (name2staff) { // only include matched credits
        pushCredit = (credit: Credits, role: string, name: string) => {
            credit[role] = credit[role] ?? [];
            const staff = name2staff.get(name)?.[0];
            if (staff) {
                credit[role].push(staff.name);
                return;
            }
            // 书名号引用（`《A & B》`）：整段是一个名字，原样保留
            // （写出时 nameEscape 会把书名号加回来）
            if (isQuotedCreatorName(name)) {
                credit[role].push(name);
                return;
            }

            // 连接词写法（`A feat. B` / `A & B`）：整体没有唯一人物可对应，
            // 但也不该整条丢掉（曲目列表要用完整写法）。
            // 艺术家职位才认艺术家专用连接词；开关关掉时按通用分隔拆（回退成普通多名并列）
            const units = matchCreatorUnits(
                name,
                name2staff,
                shouldJoinStarring(name),
                role === Role.V && rf.useArtistJoiner
            );
            if (units?.some(([, s]) => s)) {
                credit[role].push(stripRedundantAlias(name));
                return;
            }
            
            // 角色曲老写法（`角色 starring 声优`）：声优是人物，角色不是。
            // 声优对得上就按原写法写出，角色名不会因此被关联。
            const starring = resolvePlainStarring(name);
            if (starring && name2staff.get(starring.cv)?.[0]) {
                credit[role].push(stripRedundantAlias(name));
            }
        }
    } else {
        pushCredit = (credit: Credits, role: string, name: string) => {
            credit[role] = credit[role] ?? [];
            credit[role].push(rf.formatCreator(name, undefined));
        }
    }
    Object.entries(rf.credits).forEach(([role, nameData]) => {
        if (name2staff) { // remove role annotation
            role = role.split('-')[0];
        }
        Object.entries(nameData).forEach(([name, pd]) => {
            if (pd.parts.length === 0) {
                pushCredit(r.credits, role, name);
                return;
            }
            pd.parts.forEach((discParts, i) => {
                discParts.forEach((j) => {
                    const trij = r.discs[i].tracks[j - 1].credits;
                    pushCredit(trij, role, name);
                });
            });
        });
    });
    return r
}

export { splitStarringCredit, starringCvNames, STARRING_WORD } from './starringCredit';

export function nameEscape(n: string): string {
    // `角色 starring 声优`：只转义角色名，` starring 声优` 留在外面，
    // 保持这种老写法可读、也能被继续识别
    const starring = splitStarringCredit(n);
    if (starring) {
        return `${nameEscape(starring.character)} starring ${nameEscape(starring.cv)}`;
    }

    if (n.includes('(CV')) {
        const [name, cv] = n.split('(CV', 2);
        return `${nameEscape(name)}(CV${cv.slice(0, 1)}${nameEscape(cv.slice(1, -1))})`;
    }
    // Alias annotation `name (primaryName)`: escape the name only, keeping the
    // `(primaryName)` hint outside the 《》 so the patch stays parseable.
    const alias = n.match(/\s+\(([^()]*)\)$/);
    if (alias?.index != null) {
        return `${nameEscape(n.slice(0, alias.index))} (${alias[1]})`;
    }
    // 书名号引用（`《MK & Kanae Asaba》`）：整段是一个名字。满足原有转义条件
    // （含会被误读的分隔符、含角色关键字），或含连接词写法（会被连接词层重新拆开）时，
    // 写出去要把书名号加回去；否则原样写（书名号是语法转义，不是名字的一部分）。
    if (isQuotedCreatorName(n)) {
        return hasArtistJoinerSyntax(n) || (RE_SEP.test(n) && !RE_LATIN_SPACE.test(n)) || RE_ROLE_KEYWORD.test(n)
            ? `《${n}》`
            : n;
    }

    // 工具自己支持的连接词写法（`藤本記子 & 福富雅之` / `A feat. B` / `角色 starring 声优`）
    // 不进书名号：它们能被正确拆成单元，不属于「无法判断是否被错误分割」的情形。
    // 但名字里同时有关键字（`作編曲` 之类）时仍然要括——那种才是真的会被当成制作人员行。
    if (isComposedName(n) && !RE_ROLE_KEYWORD.test(n)) return n;

    return ((RE_SEP.test(n) && !RE_LATIN_SPACE.test(n)) || RE_ROLE_KEYWORD.test(n)) ? `《${n}》` : n;
}

function formatCredits(rmap: Record<string, string[]>): string {
    return Object.entries(reverseRecord(rmap))
        .map(([n, rs]) => `${rs.sort().join('、')}：${nameEscape(n)}`).sort()
        .join('\n') + '\n';
}

function reverseRecord<K extends string | number, V extends string | number>(obj: Record<K, V[]>): Record<V, K[]> {
    const d = {} as Record<V, K[]>;
    Object.entries(obj).forEach(([k, vs]) => {
        (vs as V[]).forEach((v) => {
            d[v] = d[v] ?? [];
            d[v].push(k as K);
        });
    });
    return d;
}