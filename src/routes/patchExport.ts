/**
 * Selective patch generation, ported from the "Staff Tag Fix" userscript.
 *
 * Given the current Release + resolved name2staff map, decide which creators
 * should be included in a "selective" patch (as opposed to a full dump):
 *   1. Split roles (乐器-* / 设计-* / 插图-*) are always exported.
 *   2. Names that did not resolve (Match.None) or are ambiguous (Match.Conflict)
 *      are always exported.
 *   3. Aliases (the same staff.id appearing under >= 2 different display names)
 *      are always exported.
 *   4. Everything else (matched to a single, unambiguous display name) is skipped.
 *
 * Output:
 *   - relaData:   filtered SubjectRelaPerson[] (usable as submit data).
 *   - patchText:  copyable patch text in the `角色：名字(1,3-5)、...` style.
 */
import {
	containsNormalizedName,
	type Release,
	PREFIXABLE_ROLES,
	Role,
	pagenoJoin,
	multiDiscPageNoJoin,
	stripRedundantAlias
} from './postprocess';
import { Match, type ResolvedRelaMap } from './disambiguation';
import { type Staff } from '$lib/db';
import { orderedEntries } from '$lib/bangumiUtils';
import { type SubjectRelaPerson } from '$lib/client';
import { nameEscape } from './trackInfoWriter';
import {
	type StaffPatchContent,
	type StaffPatchItem,
	PATCH_ROLE_TO_BGM
} from '$lib/importSource/staffPatch';
import {
	matchCreatorUnits,
	resolveArtistUnits,
	resolvePlainStarring,
	shouldJoinStarring,
	type ResolvedArtistUnit
} from './artistJoiner';

type NameData = { parts: number[][] };

/**
 * Build the set of display names that are aliases of the same staff person.
 * key = staff.id, value = set of distinct display names used for that staff.
 */
function buildAliasIndex(name2staff: ResolvedRelaMap): Map<number, Set<string>> {
	const index = new Map<number, Set<string>>();
	for (const [name, match] of name2staff) {
		const [staff, m] = match;
		if (!staff) continue; // Match.None / Match.Conflict -> no id
		if (m !== Match.OK && m !== Match.ConflictResolved) continue;
		let s = index.get(staff.id);
		if (!s) index.set(staff.id, (s = new Set()));
		s.add(name);
	}
	return index;
}

function isSplitRole(roleID: string): boolean {
	return PREFIXABLE_ROLES.some((base) => roleID === base || roleID.startsWith(base + '-'));
}

/**
 * Decide whether a creator/role pair should be exported in selective mode.
 * Mirrors the userscript's `shouldExportPreviewEntry`.
 */
function shouldExport(
	roleID: string,
	name: string,
	name2staff: ResolvedRelaMap,
	aliasIndex: Map<number, Set<string>>,
	useArtistJoiner = true
): boolean {
	// 1. Split roles are always exported.
	if (isSplitRole(roleID)) return true;

	const match = name2staff.get(name);
	// 2. Not in the relation DB (no person href) -> export.
	// 连接词 / 角色写法（`A feat. B` / `A & B` / `角色 starring 声优`）整体查不到，
	// 但它们本来就是一个名字下的多个单元，按单元判断：全都已明确匹配就与
	// 单个名字同一口径地跳过，否则照旧导出。
	if (!match) {
		const starring = resolvePlainStarring(name);
		// 艺术家职位才认艺术家专用连接词（受开关控制）
		const units = starring
			? [{ text: starring.cv }]
			: resolveArtistUnits(
					name,
					name2staff,
					shouldJoinStarring(name),
					roleID === Role.V && useArtistJoiner
				);
		if (!units) return true;

		return units.some((unit) => {
			const hit = name2staff.get(unit.text);
			const staff = hit?.[0];
			const m: Match = hit?.[1] ?? Match.None;
			if (!staff || m === Match.None || m === Match.Conflict) return true;
			return (aliasIndex.get(staff.id)?.size ?? 0) > 1;
		});
	}
	const [staff, m] = match;
	if (m === Match.None || m === Match.Conflict) return true;
	// 3. Aliases: the same person used >= 2 distinct display names -> export.
	if (staff && aliasIndex.get(staff.id)?.size! > 1) return true;
	// 4. Matched to a single, unambiguous display name -> skip.
	return false;
}

/**
 * Filter the Release credits through the selective rules (or keep everything
 * when `full` is set) and produce both submit-ready rela data and a copyable
 * patch text.
 */
export function buildSelectivePatch(
	release: Readonly<Release>,
	name2staff: ResolvedRelaMap,
	full = false,
	removedRela?: ReadonlySet<string>
): { relaData: SubjectRelaPerson[]; patchText: string; patchContent: StaffPatchContent } {
	const aliasIndex = buildAliasIndex(name2staff);
	const isMultiDisc = release.tracks.length > 1;

	// Collect (roleID, name) -> parts for every creator passing the filter.
	const kept: [string, { name: string; parts: number[][] }][] = [];
	Object.entries(release.credits).forEach(([roleID, creators]) => {
		Object.entries(creators).forEach(([name, pd]: [string, NameData]) => {
			if (removedRela?.has(name)) return;
			if (!full && !shouldExport(roleID, name, name2staff, aliasIndex, release.useArtistJoiner)) return;
			kept.push([roleID, { name, parts: pd.parts }]);
		});
	});

	// relaData: group by staff.id (like intoCreatorSummary), dropping custom roles.
	const relaData = buildRelaData(kept, name2staff, isMultiDisc, release.useArtistJoiner);

	// patchText: group by roleID, keep instrument roles separate (trackInfo style).
	const patchText = buildPatchText(kept, isMultiDisc, name2staff, release);

	// patchContent: 同一批 kept 数据的结构化形态（repo 的 content）。
	// 与 patchText 同源、同过滤规则，所以两者不会出现「一个全量一个子集」的分歧；
	// rawPatches.editor 放的就是 patchText，仓库既有读取方（优先读 editor）行为不变。
	const patchContent = buildPatchContent(kept, name2staff, release, patchText);

	return { relaData, patchText, patchContent };
}

// ---------------------------------------------------------------------------
// 结构化 content：对齐仓库 data/{sid}.json 的形态
//   { trackCredits: { "1.1": { composer: [item] } }, epinfo: { artist: [item] },
//     rawPatches: { editor } }
// item 形态（与仓库数据一致）：
//   1. 完整匹配到人物              -> { type: "person", person: { ref: "p:123", text } }
//   2. 名字里含本人名（圈名拼接）  -> { parts: [{ ref, text: 本人名 }, 其余纯文本] }
//   3. 没解析到人物                -> { type: "person", person: { ref: null, text } }
//   4. 角色CV                      -> { type: "cv_credit", character, cv: { ref, text } }
//   5. 乐器子职位                  -> { type: "instrument_credit", person, inst }
// ---------------------------------------------------------------------------

/** roleKey -> 中文职位名 */
const ROLE_LABEL_TO_KEY: Record<string, string> = Object.fromEntries(
	Object.entries(PATCH_ROLE_TO_BGM).map(([key, label]) => [label, key])
);

/**
 * `乐器-Guitar` -> { key: "instrument", qualifier: "Guitar" }
 * 只有 PREFIXABLE_ROLES 里的职位支持 `职位-子职位`；
 * `custom-Teaser movie` 这类自定义职位整段当 key，不拆连字符。
 */
function splitRoleLabel(roleID: string): { key: string; qualifier: string } {
	const dash = roleID.indexOf('-');
	const base = dash >= 0 ? roleID.slice(0, dash) : roleID;

	if (dash < 0 || !(PREFIXABLE_ROLES as readonly string[]).includes(base)) {
		return { key: ROLE_LABEL_TO_KEY[roleID] ?? roleID, qualifier: '' };
	}

	return {
		key: ROLE_LABEL_TO_KEY[base] ?? base,
		qualifier: roleID.slice(dash + 1).trim()
	};
}

type PatchPart = string | { ref: string | null; text: string };

/**
 * 名字里带着本人名、且另有文字时拆成片段：
 * `ぐぅせぇguse` -> ["guse" 之外的 {ref, text:"ぐぅせぇ"} + "guse"]、
 * `Masahiro "Godspeed" Aoki` -> ["Masahiro \"", {ref, text:"Godspeed"}, "\" Aoki"]。
 * 名字与本人名完全一致（或没解析到人物）时返回 null —— 这时用 person 形态。
 */
function nameSegments(rawName: string, staff: Staff | undefined, ref: string | null): PatchPart[] | null {
	// 去掉名字里冗余的别名标注（与 Infobox / 预览同一套规则）
	const display = stripRedundantAlias(rawName);

	if (!staff || !containsNormalizedName(display, staff.name)) return null;

	const at = display.toLowerCase().indexOf(staff.name.toLowerCase());
	if (at < 0) return null;

	const before = display.slice(0, at);
	const after = display.slice(at + staff.name.length);
	if (!before && !after) return null;

	const parts: PatchPart[] = [];
	if (before) parts.push(before);
	parts.push({ ref, text: display.slice(at, at + staff.name.length) });
	if (after) parts.push(after);

	return parts;
}

function unitSegments(unit: ResolvedArtistUnit): PatchPart[] {
	const ref = unit.staff ? `p:${unit.staff.id}` : null;

	return nameSegments(unit.text, unit.staff, ref) ?? [
		{ ref, text: stripRedundantAlias(unit.text) }
	];
}

/** `A feat. B` -> [{ref,text:"A"}, " feat. ", {ref,text:"B"}] */
function buildUnitParts(units: ResolvedArtistUnit[]): PatchPart[] {
	const parts: PatchPart[] = [];

	units.forEach((unit, i) => {
		if (i > 0) parts.push(unit.joiner);
		parts.push(...unitSegments(unit));
	});

	return parts;
}

function buildCreditItem(
	name: string,
	name2staff: ResolvedRelaMap,
	release: Readonly<Release>,
	allowComposed = true
): StaffPatchItem {
	// 角色曲老写法（`角色 starring 声优`）：显示形式原样保留，
	// 声优带 ref、角色不带（角色不是人物，不该被关联）
	const starring = resolvePlainStarring(name);
	if (starring) {
		const cvStaff = name2staff.get(starring.cv)?.[0];

		return {
			parts: [
				{ ref: null, text: starring.character },
				' starring ',
				{ ref: cvStaff ? `p:${cvStaff.id}` : null, text: starring.cv }
			]
		};
	}

	// 连接词写法：拆成「实体 + 连接词 + 实体」，每个单元带自己的 ref
	// （角色名里混进连接词的角色曲写法，也在这里按单元拆）
	// 关掉艺术家开关时只认通用分隔（`& / × / +`），即回退成普通多名并列
	const units = resolveArtistUnits(name, name2staff, shouldJoinStarring(name), allowComposed);
	if (units) return { parts: buildUnitParts(units) };

	const staff = name2staff.get(name)?.[0];
	const display = stripRedundantAlias(name);
	const ref = staff ? `p:${staff.id}` : null;

	// 角色CV：仓库用 cv_credit 表示「角色(CV声优)」
	const character = release.name2character.get(name);
	if (character) {
		return {
			type: 'cv_credit',
			character: character[1],
			cv: { ref, text: display }
		};
	}

	const segments = nameSegments(name, staff, ref);
	if (segments) return { parts: segments };

	if (!staff) {
		return { type: 'person', person: { ref: null, text: display } };
	}

	return { type: 'person', person: { ref, text: display } };
}

/** 子职位注解（作词-英訳 / 编曲-Drums Arrangement）在仓库里是挂在名字后的文本片段 */
function withRoleQualifier(item: StaffPatchItem, qualifier: string): StaffPatchItem {
	if (!qualifier) return item;

	if (Array.isArray(item.parts)) {
		return { parts: [...item.parts, ` (${qualifier})`] };
	}

	if (item.type === 'cv_credit') {
		return { ...item, character: `${item.character ?? ''} (${qualifier})` };
	}

	const entity = (item.person ?? item) as { ref?: string | null; text?: string | null };

	return {
		parts: [
			{ ref: entity.ref ?? null, text: String(entity.text ?? '') },
			` (${qualifier})`
		]
	};
}

function buildContentItem(
	roleID: string,
	name: string,
	name2staff: ResolvedRelaMap,
	release: Readonly<Release>
): { roleKey: string; item: StaffPatchItem } {
	const { key, qualifier } = splitRoleLabel(roleID);
	const built = buildCreditItem(name, name2staff, release, roleID === Role.V ? release.useArtistJoiner : true);

	// 乐器：子职位即乐器名
	if (key === 'instrument' && qualifier) {
		// 多段写法（连接词 / 别名拆分）：乐器名接在末尾，仓库数据就是这么存的
		if (Array.isArray(built.parts)) {
			return { roleKey: key, item: { parts: [...built.parts, ` (${qualifier})`] } };
		}

		const entity = (built.person ?? built) as { ref?: string | null; text?: string | null };

		return {
			roleKey: key,
			item: {
				type: 'instrument_credit',
				person: { ref: entity?.ref ?? null, text: String(entity?.text ?? '') },
				inst: qualifier
			}
		};
	}

	return { roleKey: key, item: withRoleQualifier(built, qualifier) };
}

export function buildPatchContent(
	kept: [string, { name: string; parts: number[][] }][],
	name2staff: ResolvedRelaMap,
	release: Readonly<Release>,
	editor: string
): StaffPatchContent {
	const trackCredits: Record<string, Record<string, StaffPatchItem[]>> = {};
	const epinfo: Record<string, StaffPatchItem[]> = {};

	for (const [roleID, { name, parts }] of kept) {
		const { roleKey, item } = buildContentItem(roleID, name, name2staff, release);

		// parts 为空 = 参与全部曲目 -> 条目级 epinfo
		if (parts.length === 0 || parts.every((discParts) => discParts.length === 0)) {
			const bucket = (epinfo[roleKey] ??= []);
			if (!bucket.some((it) => JSON.stringify(it) === JSON.stringify(item))) bucket.push(item);
			continue;
		}

		parts.forEach((discParts, discIndex) => {
			discParts.forEach((trackNo) => {
				const roleMap = (trackCredits[`${discIndex + 1}.${trackNo}`] ??= {});
				const bucket = (roleMap[roleKey] ??= []);
				if (!bucket.some((it) => JSON.stringify(it) === JSON.stringify(item))) bucket.push(item);
			});
		});
	}

	return {
		trackCredits,
		epinfo,
		rawPatches: { editor }
	};
}

function buildRelaData(
	kept: [string, { name: string; parts: number[][] }][],
	name2staff: ResolvedRelaMap,
	isMultiDisc: boolean,
	useArtistJoiner: boolean
): SubjectRelaPerson[] {
	const r = new Map<number, Map<string, string>>(); // staff.id -> relation -> eps
	const staffName = new Map<number, string>(); // staff.id -> primary display name
	for (const [roleID, { name, parts }] of kept) {
		const relation = PREFIXABLE_ROLES.find((base) => roleID.startsWith(base + '-')) ?? roleID;
		if (relation.startsWith("custom-")) continue; // custom roles are not in BGM rela
		const eps = parts.length === 0 ? "" : isMultiDisc ? multiDiscPageNoJoin(parts) : pagenoJoin(parts[0]);

		// 角色曲老写法（`角色 starring 声优`）：只有声优参与关联
		const starring = resolvePlainStarring(name);
		// 连接词写法（`A feat. B`）：艺术家职位才认艺术家专用连接词（受开关控制）；
		// 关掉时回退成通用分隔（`& / × / +`），其他职位同样只认通用分隔
		const targets: [string, Staff | undefined][] = starring
			? [[starring.cv, name2staff.get(starring.cv)?.[0]]]
			: (matchCreatorUnits(
					name,
					name2staff,
					shouldJoinStarring(name),
					relation === Role.V && useArtistJoiner
				) ?? [[name, name2staff.get(name)?.[0]]]);

		targets.forEach(([, staff]) => {
			if (!staff) return; // skip unmatched for submit data
			if (!staffName.has(staff.id)) staffName.set(staff.id, staff.name);
			const rtm = r.get(staff.id) ?? new Map<string, string>();
			rtm.set(relation, eps);
			r.set(staff.id, rtm);
		});
	}
	return Array.from(r.entries()).flatMap(([id, rtm]) =>
		Array.from(rtm.entries()).map(([relation, eps]) => ({
			id,
            name: staffName.get(id) ?? "",
			relation,
			eps,
		}))
	);
}

function buildPatchText(
	kept: [string, { name: string; parts: number[][] }][],
	isMultiDisc: boolean,
	name2staff: ResolvedRelaMap,
	release: Readonly<Release>
): string {
	// bucket: roleID -> Map<name, parts>
	const bucket = new Map<string, Map<string, number[][]>>();
	for (const [roleID, { name, parts }] of kept) {
		let m = bucket.get(roleID);
		if (!m) bucket.set(roleID, (m = new Map()));
		// merge duplicate names under the same role
		if (m.has(name)) {
			const existing = m.get(name)!;
            m.set(name, existing.map((a, i) => Array.from(new Set([...a, ...(parts[i] ?? [])]))));
		} else {
			m.set(name, parts);
		}
	}

	const lines: string[] = [];
	const pushRole = (roleID: string, nameMap: Map<string, number[][]>) => {
		if (!nameMap.size) return;
		const chunks = Array.from(nameMap.entries()).map(([name, parts]) => {
			const hasAnyTrack = parts.some((p) => p.length > 0);
			const pn = isMultiDisc ? multiDiscPageNoJoin(parts) : pagenoJoin(parts[0] ?? []);
			const withPageNo = (display: string) => (hasAnyTrack ? `${display}(${pn})` : display);

			// 艺术家开关关掉：回退成普通多名并列（每个单元各自带参与曲目）
			const units =
				roleID === Role.V && !release.useArtistJoiner
					? resolveArtistUnits(name, name2staff, shouldJoinStarring(name))
					: null;
			if (units) {
				return units
					.map((u) => withPageNo(nameEscape(release.formatCreator(u.text, u.staff?.name, name2staff))))
					.join('、');
			}

			// 其余情况（含非艺术家职位的宽松模式）：整条名字，复合写法即使整条匹配不到人物，
			// 也逐单元补 `别名 (现名)`（与预览/Infobox 一致）
			return withPageNo(
				nameEscape(release.formatCreator(name, name2staff.get(name)?.[0]?.name, name2staff))
			);
		});
        lines.push(`${roleID}：${chunks.join("、")}`);
	};

	// Ordered roles first, then any remaining (custom / instrument) roles.
	const ordered = orderedEntries(Object.fromEntries(bucket));
	for (const [roleID, _] of ordered) pushRole(roleID, bucket.get(roleID)!);
    return lines.join("\n");
}
