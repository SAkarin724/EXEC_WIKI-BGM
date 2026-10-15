/**
 * 艺术家写法里的连接词：`A feat. B` / `A ft. B` / `A × B` / `A & B` …
 *
 * 与《音乐条目显示各曲目参与制作人员信息 ++ 维基端》的 `ARTIST_JOINERS` 对齐
 * （维基端的 `tryParseJoinedArtistItem` 挂在通用 item 解析器上），
 * 唯一的例外是 `starring`：它是「角色 + 声优」的老写法，语义上等于
 * `角色(CV.声优)` 但显示形式不同，按普通连接词拆会让角色名也进解析池、
 * 被当作人物关联上。所以它不走这里，改由 trackInfoWriter 按写法原样处理。
 *
 * 拆分只影响「解析」这一层：每个单元各自去关联人物、各自产出 parts 片段；
 * Infobox / patch 文本 / 曲目列表仍旧保留完整写法（`A feat. B`）。
 */
import { type Staff } from '$lib/db';
import { type ResolvedRelaMap } from './disambiguation';
import { STARRING_WORD, splitStarringCredit } from './starringCredit';

export const ARTIST_JOINERS = ['feat.', 'ft', 'fw', 'vs', '+', 'with', '&', '×'];

/**
 * 词形连接词：允许 `A(B)feat.C` 这种紧跟右括号、后面不空格的写法。
 */
const WORD_JOINERS = ['feat.', 'ft', 'fw', 'vs', 'with'];

/**
 * 单字符/符号连接词：只在「两侧都有空格」时才算连接词。
 * 否则 `A Xylophone` 这种名字会被 `x` 误切（维基端的正则在这里偏激进）。
 */
const TIGHT_JOINERS = ['+', '&', '×'];

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const WORD_BODY = WORD_JOINERS.map(escapeRe).join('|');
const TIGHT_BODY = TIGHT_JOINERS.map(escapeRe).join('|');
/** 角色曲写法的角色名/声优名里又混进连接词时，`starring` 也当词形连接词一起拆 */
const WORD_BODY_WITH_STARRING = `${WORD_BODY}|${escapeRe(STARRING_WORD)}`;

/** ` feat.` -> 捕获 `feat.`，允许结尾带点 */
const RE_WORD_SPACED = new RegExp(`^\\s+((?:${WORD_BODY})\\.?)\\s*`, 'i');
/** `feat.C`（紧跟右括号） */
const RE_WORD_AFTER_PAREN = new RegExp(`^((?:${WORD_BODY})\\.?)\\s*`, 'i');
/** ` x ` / ` & ` / ` × ` / ` + `：两侧都要空格 */
const RE_TIGHT_SPACED = new RegExp(`^\\s+((?:${TIGHT_BODY})\\.?)\\s+`, 'i');

const RE_WORD_SPACED_STARRING = new RegExp(`^\\s+((?:${WORD_BODY_WITH_STARRING})\\.?)\\s*`, 'i');
const RE_WORD_AFTER_PAREN_STARRING = new RegExp(`^((?:${WORD_BODY_WITH_STARRING})\\.?)\\s*`, 'i');

/**
 * 「不启用艺术家专用连接词」时使用（非 `Role.V` 职位、或艺术家开关关掉）：
 * `feat. / ft / fw / vs / with` 一律不当连接词，只保留 `& / × / +` 这类通用分隔。
 * 用永不匹配的正则把它摘掉，其余流程不动。
 */
const RE_NEVER = /(?!)/;
/** 只认 `starring` 的变体（角色曲老写法在非艺术家职位上仍然要拆） */
const RE_STARRING_SPACED = new RegExp(`^\\s+(${escapeRe(STARRING_WORD)})\\s*`, 'i');
const RE_STARRING_AFTER_PAREN = new RegExp(`^(${escapeRe(STARRING_WORD)})\\s*`, 'i');

export interface ArtistUnit {
	/** 该单元前面的连接词，归一为 ` xxx ` 形式；第一个单元为空串 */
	joiner: string;
	/** 单元文本 */
	text: string;
}

export interface ResolvedArtistUnit extends ArtistUnit {
	staff?: Staff;
}

/**
 * 把 `ELFENSJóN feat. 花たん` 拆成
 * `[{joiner:"", text:"ELFENSJóN"}, {joiner:" feat. ", text:"花たん"}]`。
 * 不含连接词时返回 null。
 *
 * `includeStarring` 为 true 时把 `starring` 也当词形连接词一起拆
 * （只用于角色曲写法里混进连接词的罕见情况，见 `shouldJoinStarring`）。
 *
 * `includeArtistOnly` 为 false 时只按通用分隔符（`& / × / +`）拆，
 * `feat. / ft / fw / vs / with` 一律不当连接词——用于非 `Role.V` 职位、
 * 或艺术家开关关掉时（`starring` 仍按 `includeStarring` 生效）。
 */
export function splitArtistUnits(
	raw: string,
	includeStarring = false,
	includeArtistOnly = true
): ArtistUnit[] | null {
	const text = String(raw || '');
	if (!text.trim()) return null;

	const reWordSpaced = includeArtistOnly
		? includeStarring
			? RE_WORD_SPACED_STARRING
			: RE_WORD_SPACED
		: includeStarring
			? RE_STARRING_SPACED
			: RE_NEVER;
	const reWordAfterParen = includeArtistOnly
		? includeStarring
			? RE_WORD_AFTER_PAREN_STARRING
			: RE_WORD_AFTER_PAREN
		: includeStarring
			? RE_STARRING_AFTER_PAREN
			: RE_NEVER;

	const units: ArtistUnit[] = [];
	let buf = '';
	let depth = 0;
	let foundJoiner = false;
	let i = 0;
	/** 刚扫到的连接词属于它**后面**那个单元（第一个单元为空串） */
	let nextJoiner = '';

	const flush = (): void => {
		const t = buf.trim();
		buf = '';
		if (!t) return;

		units.push({ joiner: nextJoiner, text: t });
		nextJoiner = '';
	};

	while (i < text.length) {
		const ch = text[i];

		if (ch === '(' || ch === '（') depth++;
		else if (ch === ')' || ch === '）') depth = Math.max(0, depth - 1);

		// 括号里的是 CV / 别名注解，里面的连接词不拆
		if (depth === 0) {
			const rest = text.slice(i);
			let m = rest.match(reWordSpaced) || rest.match(RE_TIGHT_SPACED);

			// `A(B)feat.C`：连接词紧跟右括号
			if (!m && /[)）]\s*$/.test(buf)) m = rest.match(reWordAfterParen);

			if (m && buf.trim()) {
				// 先落掉当前单元（连接词为空），连接词记给下一个单元
				flush();
				nextJoiner = ` ${m[1]} `;
				foundJoiner = true;
				i += m[0].length;
				continue;
			}
		}

		buf += ch;
		i++;
	}

	if (!foundJoiner) return null;

	flush();

	return units.length > 1 ? units : null;
}

/** 拆分并解析各单元对应的人物 */
export function resolveArtistUnits(
	name: string,
	name2staff: ResolvedRelaMap,
	includeStarring = false,
	includeArtistOnly = true
): ResolvedArtistUnit[] | null {
	const units = splitArtistUnits(name, includeStarring, includeArtistOnly);
	if (!units) return null;

	return units.map((u) => ({ ...u, staff: name2staff.get(u.text)?.[0] }));
}

/**
 * 整体匹配不到人物时，逐个单元去匹配。
 * 返回 null 表示这个名字里没有连接词（按整体处理即可）。
 */
export function matchCreatorUnits(
	name: string,
	name2staff: ResolvedRelaMap,
	includeStarring = false,
	includeArtistOnly = true
): [string, Staff | undefined][] | null {
	const units = splitArtistUnits(name, includeStarring, includeArtistOnly);
	if (!units) return null;

	return units.map((u) => [u.text, name2staff.get(u.text)?.[0]]);
}

/**
 * 角色曲写法（`角色 starring 声优`）两侧都是普通名字时，返回拆分结果。
 *
 * 任一侧本身就是连接词写法（`A & B starring C`，罕见）时返回 null：这时应当把
 * `starring` 当普通连接词一起拆，否则整段角色名会被当成一个对不上的名字，
 * 里面能匹配上的人物全部拿不到关联。
 */
export function resolvePlainStarring(name: string): { character: string; cv: string } | null {
	const starring = splitStarringCredit(name);
	if (!starring) return null;

	if (splitArtistUnits(starring.character) || splitArtistUnits(starring.cv)) return null;

	return starring;
}

/** 需要把 `starring` 当普通连接词一起拆吗（角色曲写法里混进了连接词时） */
export function shouldJoinStarring(name: string): boolean {
	return !!splitStarringCredit(name) && !resolvePlainStarring(name);
}

/**
 * 这个名字是「由多个名字拼成的写法」吗（连接词写法 / 角色曲写法）。
 * 这种整体名字不可能对应到某个人物，界面上不应作为单个可搜索条目出现
 * ——它的各个单元会各自成为条目。
 */
export function isComposedName(name: string): boolean {
	return Boolean(resolvePlainStarring(name) || splitArtistUnits(name, shouldJoinStarring(name)));
}

/* ------------------------------------------------------------------
 * 解析期用：creator 碎片粘连判断
 *
 * 语法层（tree-sitter-rkgk 的 `creator_name`）是按分隔符切开的字符序列，
 * 空格本身就是分隔符，所以 `中川かのん starring 東山奈央` 到这一层是三个
 * creator 碎片；`ELFENSJóN feat. 花たん` 会裂成 `ELFENSJóN feat.` 与 `花たん`。
 * 这里提供判断，让 postprocess 在合并碎片时把连接词两侧粘回去，
 * 还原出完整写法后再交给 splitArtistUnits / splitStarringCredit 处理。
 *
 * `starring` 也要参与粘连（它同样会被切开），虽然它不是关联意义上的连接词。
 * ------------------------------------------------------------------ */
const GLUE_JOINERS = [...ARTIST_JOINERS, STARRING_WORD];
const GLUE_BODY = GLUE_JOINERS.map(escapeRe).join('|');

const RE_GLUE_EXACT = new RegExp(`^(?:${GLUE_BODY})\\.?$`, 'i');
const RE_GLUE_TAIL = new RegExp(`(?:^|\\s)(?:${GLUE_BODY})\\.?$`, 'i');
/** 后面不能紧跟拉丁字母，否则 `Xylophone` 会被当成 `x` 连接词 */
const RE_GLUE_HEAD = new RegExp(`^(?:${GLUE_BODY})(?![a-zA-Z])`, 'i');

/** 碎片本身就是连接词：`feat.` / `×` / `starring` */
export function isJoinerFragment(v: string): boolean {
	return RE_GLUE_EXACT.test(String(v || '').trim());
}

/** 碎片以连接词结尾：`A feat.` */
export function endsWithJoinerFragment(v: string): boolean {
	return RE_GLUE_TAIL.test(String(v || '').trim());
}

/** 碎片以连接词开头：`feat.花たん` */
export function startsWithJoinerFragment(v: string): boolean {
	return RE_GLUE_HEAD.test(String(v || '').trim());
}

/**
 * 收集连接词写法需要单独解析的单元。
 *
 * 传了 `opts.artistRole`（艺术家职位名）时按职位分流：该职位看 `opts.useArtistJoiners`
 * —— 关掉就不收集它的单元；其余职位只按通用分隔符（`& / × / +`）拆。
 * 不传 `opts` 时保持旧行为（所有职位都按完整连接词表拆）。
 */
export function creatorUnitNames(
	credits: Record<string, Record<string, unknown>>,
	opts?: { artistRole?: string; useArtistJoiners?: boolean }
): string[] {
	const names: string[] = [];

	Object.entries(credits).forEach(([role, creators]) => {
		const isArtist = opts?.artistRole !== undefined && role === opts.artistRole;
		// 艺术家开关关掉时只是不再认艺术家专用连接词（仍按 `& / × / +` 拆，单元照样进池）
		const includeArtistOnly =
			opts?.artistRole === undefined ? true : isArtist && (opts.useArtistJoiners ?? true);

		Object.keys(creators).forEach((creator) => {
			splitArtistUnits(creator, shouldJoinStarring(creator), includeArtistOnly)?.forEach((u) =>
				names.push(u.text)
			);
		});
	});

	return names;
}
