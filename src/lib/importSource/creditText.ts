import { INSTRUMENT_NAMES } from '$lib/instruments';
import { orderedEntries } from '$lib/bangumiUtils';
import { FORMAL_ROLES, lookupLyricRole, toChineseCreatorName } from './netease';
import type { Credits } from './common';

/**
 * 歌词头 credits 确认窗口用到的文本规则。
 *
 * 职位写入规则必须和 `postprocess.ts` / 维基端保持一致，否则人工在窗口里填的
 * 「竹笛」会被写成站点不认的 ID：
 * 正式职位原样 → 歌词头别名表（`人声`、`录音棚`、`Voice`、`Recording Studio`）
 * → 乐器名补 `乐器-` → 已带可前缀职位（`乐器-竹笛`、`设计-封面`）原样
 * → 其余一律 `custom-<原文>`。
 */

/** 可写 `职位-子职位` 的基础职位，与 `src/routes/postprocess.ts` 的 `PREFIXABLE_ROLES` 保持同步 */
const PREFIXABLE_ROLES = [
	'乐器',
	'设计',
	'插图',
	'作曲',
	'作词',
	'编曲',
	'制作人',
	'声乐',
	'和声',
	'合唱',
	'录音',
	'混音',
	'母带制作'
];

const PREFIXABLE_RE = new RegExp(`^(${PREFIXABLE_ROLES.join('|')})-.+$`);

/**
 * 人手输入的职位文本 → 写进 `credits` 的键；空串表示没填。
 *
 * 别名表（`人声` → `声乐-人声`、`录音棚` → `录音-录音棚`）在窗口里同样生效：
 * 手填与歌词自动识别共用 `lookupLyricRole`，不会出现两套规则。
 */
export function toRoleId(text: string): string {
	const raw = text.trim();
	if (!raw) return '';
	if (raw.startsWith('custom-')) return raw;
	if ((FORMAL_ROLES as string[]).includes(raw)) return raw;
	const alias = lookupLyricRole(raw);
	if (alias) return alias;
	if ((INSTRUMENT_NAMES as string[]).includes(raw)) return `乐器-${raw}`;
	if (PREFIXABLE_RE.test(raw)) return raw;
	return `custom-${raw}`;
}

/** `custom-调校` → `调校`，其余原样（与 `postprocess.displayRoleName()` 一致） */
export function displayRole(roleId: string): string {
	return roleId.startsWith('custom-') ? roleId.slice(7) : roleId;
}

/** 与 `netease.ts` 切人名用同一套分隔符，额外容忍半角/全角逗号（人工手填常用） */
export function splitNames(text: string): string[] {
	return Array.from(
		new Set(
			text
				.split(/[/／、＆&;；,，]+/)
				.map((s) => s.trim())
				.filter(Boolean)
		)
	);
}

/** 歌词按行拆开（去空白行），对照与高亮都用它 */
export function lyricLines(lyric: string): string[] {
	return lyric
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}

function normalizeLine(text: string): string {
	return text.replace(/[\s\u00a0]+/g, '');
}

/** 这条候选是否对得上这行歌词原文（合并候选可能把多行并成一条） */
export function rowMatchesLyric(raw: string | null | undefined, line: string): boolean {
	if (!raw) return false;
	const a = normalizeLine(raw);
	const b = normalizeLine(line);
	return a === b || a.includes(b) || b.includes(a);
}

/**
 * 确认窗口里的一行：一整行「职位：人名」，还带着自动识别的原文，
 * 用来判断这一行是不是被人改过（`auto` 为 null = 人工新增，天然算改动）。
 */
export interface CreditRow {
	/** 稳定 id，行被搬动/插入后仍能用来聚焦 DOM */
	id: number;
	/** 当前文本，一整行「职位：人名」 */
	text: string;
	/** 自动识别时的文本；人工新增行为 null */
	auto: string | null;
	/** 对应的歌词原文行（只用于歌词联动，改文本不动它）；人工新增行为 null */
	raw: string | null;
}

/** 一整行「职位：人名」→ 归一后的职位 ID + 人名（冒号前后都可留空） */
export function parseRow(text: string): { roleId: string; names: string[] } {
	const line = text.trim();
	const sep = line.search(/[：:]/);
	const label = (sep < 0 ? line : line.slice(0, sep)).trim();
	const rest = sep < 0 ? '' : line.slice(sep + 1);
	return {
		roleId: toRoleId(label),
		names: splitNames(rest).map(toChineseCreatorName)
	};
}

/** 这一行是不是被人改过（新增行、文本与自动识别不同，都算） */
export function rowChanged(row: CreditRow): boolean {
	return row.auto === null || row.text.trim() !== row.auto.trim();
}

/**
 * 行数组 → 待写入的 `credits`。
 *
 * 职位按下标里的规范顺序排（`orderedEntries`：作词→作曲→编曲→…，子职位跟着基础职位，
 * 自定义职位排最后），同一职位内人名保持填写顺序、同名去重；
 * 没填职位或没填人名的行不写入。
 */
export function creditsFromRows(rows: readonly CreditRow[]): Credits {
	const buckets: Credits = {};
	for (const row of rows) {
		const { roleId, names } = parseRow(row.text);
		if (!roleId || names.length === 0) continue;
		buckets[roleId] = Array.from(new Set([...(buckets[roleId] ?? []), ...names]));
	}

	const ordered: Credits = {};
	for (const [role, names] of orderedEntries(buckets)) ordered[role] = names;
	return ordered;
}