/**
 * 团体标注：`早餐 @A8RECORDS` / `早餐@A8RECORDS` / `kaztora (森羅万象)`。
 *
 * 两种写法语义相同：标注前面是人名（参与关联），后面是所属的团体 / 公司 /
 * 社团名（只作显示，不参与关联）。它们的显示策略不同：
 * - `@` 写法的团体名始终保留；
 * - 括号写法受「去除人名后括号内的社团名」开关影响：开着时解析期就会把括号
 *   部分去掉（这里看到的名字已经没有括号），关着时保留在名字里，由这里按
 *   「部分关联」处理——关联仍取括号前的人名。
 *
 * 名字本身就含 `@` / 括号、并不是「人物 + 团体」时，用书名号括起来当整体：
 * `《foo@bar》` / `《foo(bar)》`。这里跳过《》登记的名字，`nameEscape` 也会
 * 把它重新括回去，所以写出、再次导入都不会被误拆。
 *
 * 单独成模块的原因与 `starringCredit` 相同：`postprocess`（解析 + 关联）与
 * `trackInfoWriter`（写出）都要用它，放在任何一边都会让两个模块互相 import。
 */

import { isQuotedCreatorName } from './nameQuoting';

export type CircleSplitKind = 'at' | 'paren';

export interface CircleSplit {
	/** 标注左边的人名（已 trim） */
	name: string;
	/** 原样的团体标注，从标注前的空白开始（如 ` @A8RECORDS` / ` (森羅万象)`） */
	suffix: string;
	/** `at` = `@` 写法，`paren` = 括号写法 */
	kind: CircleSplitKind;
}

const OPEN_PARENS = '(（';
const CLOSE_PARENS = ')）';

/** 第一个不在括号内的 `@`（括号里的是别名注解，不参与判定） */
function findAtMark(text: string): number {
	let depth = 0;

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (OPEN_PARENS.includes(ch)) depth++;
		else if (CLOSE_PARENS.includes(ch)) depth = Math.max(0, depth - 1);
		else if (ch === '@' && depth === 0) return i;
	}

	return -1;
}

/** 尾部括号：`kaztora (森羅万象)` / `kaztora(森羅万象)` */
const RE_TRAILING_PAREN = /\s*[（(]([^()（）]*)[)）]\s*$/;

/** 曲目区间 / CV 标注之类的括号内容不是团体名 */
function isReservedParenContent(content: string): boolean {
	return (
		/^(?:tr|m)?\.?\s*\d[\d,.\-\s]*$/i.test(content) || /^(?:cv)(?:\s*[：:.．]|$)/i.test(content)
	);
}

/**
 * 团体标注和前面人名之间的空白只保留一个。
 * 没有空白时保持紧贴（`早餐@A8RECORDS` / `VeetaCrush(Dash Sound)`）。
 */
function normalizeLeadingSpace(suffix: string): string {
	return suffix.replace(/^\s+/, ' ');
}

/** 规范化后的包含判断：括号里是名字里已有的别名（`ぐぅせぇguse (ぐぅせぇ)`），不当团体 */
function containsNormalizedText(haystack: string, needle: string): boolean {
	if (needle.trim().length < 2) return false;

	const norm = (s: string) => s.normalize('NFKC').toLowerCase();
	return norm(haystack).includes(norm(needle.trim()));
}

function splitAtMark(text: string): CircleSplit | null {
	const at = findAtMark(text);
	if (at < 0) return null;

	// `@` 右边必须有团体名
	if (!text.slice(at + 1).trim()) return null;

	// `@` 前的空白也属于标注，原样保留，拼回去时显示不变
	let start = at;
	while (start > 0 && /\s/.test(text[start - 1])) start--;

	const head = text.slice(0, start).trim();
	if (!head) return null;

	return { name: head, suffix: normalizeLeadingSpace(text.slice(start)), kind: 'at' };
}

function splitTrailingParen(text: string): CircleSplit | null {
	const m = RE_TRAILING_PAREN.exec(text);
	if (!m || m.index == null) return null;

	const content = m[1].trim();
	if (!content || isReservedParenContent(content)) return null;

	const head = text.slice(0, m.index).trim();
	if (!head || containsNormalizedText(head, content)) return null;

	return { name: head, suffix: normalizeLeadingSpace(text.slice(m.index)), kind: 'paren' };
}

/**
 * `早餐 @A8RECORDS`   -> { name: '早餐', suffix: ' @A8RECORDS', kind: 'at' }
 * `早餐@A8RECORDS`    -> { name: '早餐', suffix: '@A8RECORDS', kind: 'at' }
 * `kaztora (森羅万象)` -> { name: 'kaztora', suffix: ' (森羅万象)', kind: 'paren' }
 *
 * 不满足「左边有人名 + 右边有团体名」时返回 null（整条按普通名字处理）。
 * 书名号引用（`《foo@bar》`）整段是一个名字，不拆。
 */
export function splitCircleCredit(name: string): CircleSplit | null {
	const text = String(name ?? '');
	if (!text.trim() || isQuotedCreatorName(text)) return null;

	return splitAtMark(text) ?? splitTrailingParen(text);
}

/**
 * 不看《》登记的原始形状判断。
 * `hasArtistJoinerSyntax` 用它回答「含团体标注的名字写出去要不要加书名号」。
 */
export function hasCircleSyntax(name: string): boolean {
	const text = String(name ?? '');
	if (!text.trim()) return false;

	const at = findAtMark(text);
	if (at > 0 && text.slice(0, at).trim() && text.slice(at + 1).trim()) return true;

	const m = RE_TRAILING_PAREN.exec(text);
	if (!m || m.index == null) return false;

	const content = m[1].trim();
	return Boolean(content && !isReservedParenContent(content) && text.slice(0, m.index).trim());
}

/** 碎片以 `@` 开头：`早餐 @A8RECORDS` 被语法层按空格切开时，用它把两段粘回去 */
export function isAtCircleFragment(v: string): boolean {
	return String(v ?? '')
		.trim()
		.startsWith('@');
}

/**
 * 收集所有团体标注写法里的人名（标注左边）。
 * 人名要进人物解析池、出现在关联概览里；团体名不收集，也不参与关联。
 */
export function circleHeadNames(credits: Record<string, Record<string, unknown>>): string[] {
	const names: string[] = [];

	Object.values(credits).forEach((creators) => {
		Object.keys(creators).forEach((creator) => {
			const split = splitCircleCredit(creator);
			if (split) names.push(split.name);
		});
	});

	return names;
}
