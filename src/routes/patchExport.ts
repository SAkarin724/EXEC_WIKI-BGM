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
import { type Release, PREFIXABLE_ROLES, pagenoJoin, multiDiscPageNoJoin } from './postprocess';
import { Match, type ResolvedRelaMap } from './disambiguation';
import { orderedEntries } from '$lib/bangumiUtils';
import { type SubjectRelaPerson } from '$lib/client';

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
	aliasIndex: Map<number, Set<string>>
): boolean {
	// 1. Split roles are always exported.
	if (isSplitRole(roleID)) return true;

	const match = name2staff.get(name);
	// 2. Not in the relation DB (no person href) -> export.
	if (!match) return true;
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
): { relaData: SubjectRelaPerson[]; patchText: string } {
	const aliasIndex = buildAliasIndex(name2staff);
	const isMultiDisc = release.tracks.length > 1;

	// Collect (roleID, name) -> parts for every creator passing the filter.
	const kept: [string, { name: string; parts: number[][] }][] = [];
	Object.entries(release.credits).forEach(([roleID, creators]) => {
		Object.entries(creators).forEach(([name, pd]: [string, NameData]) => {
			if (removedRela?.has(name)) return;
			if (!full && !shouldExport(roleID, name, name2staff, aliasIndex)) return;
			kept.push([roleID, { name, parts: pd.parts }]);
		});
	});

	// relaData: group by staff.id (like intoCreatorSummary), dropping custom roles.
	const relaData = buildRelaData(kept, name2staff, isMultiDisc);

	// patchText: group by roleID, keep instrument roles separate (trackInfo style).
	const patchText = buildPatchText(kept, isMultiDisc, name2staff, release);

	return { relaData, patchText };
}

function buildRelaData(
	kept: [string, { name: string; parts: number[][] }][],
	name2staff: ResolvedRelaMap,
	isMultiDisc: boolean
): SubjectRelaPerson[] {
	const r = new Map<number, Map<string, string>>(); // staff.id -> relation -> eps
	const staffName = new Map<number, string>(); // staff.id -> primary display name
	for (const [roleID, { name, parts }] of kept) {
		const staff = name2staff.get(name)?.[0];
		if (!staff) continue; // skip unmatched for submit data
		let relation = PREFIXABLE_ROLES.find((base) => roleID.startsWith(base + '-')) ?? roleID;
		if (relation.startsWith("custom-")) continue; // custom roles are not in BGM rela
		const eps = parts.length === 0 ? "" : isMultiDisc ? multiDiscPageNoJoin(parts) : pagenoJoin(parts[0]);
		if (!staffName.has(staff.id)) staffName.set(staff.id, staff.name);
		const rtm = r.get(staff.id) ?? new Map<string, string>();
		rtm.set(relation, eps);
		r.set(staff.id, rtm);
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
			// resolve aliases: use the primary staff name, e.g. シロ (墨染サウンド)
			const staff = name2staff.get(name)?.[0];
			const display = staff ? release.formatCreator(name, staff.name) : name;
			const hasAnyTrack = parts.some((p) => p.length > 0);
			if (!hasAnyTrack) return display;
			const pn = isMultiDisc ? multiDiscPageNoJoin(parts) : pagenoJoin(parts[0] ?? []);
			return `${display}(${pn})`;
		});
        lines.push(`${roleID}：${chunks.join("、")}`);
	};

	// Ordered roles first, then any remaining (custom / instrument) roles.
	const ordered = orderedEntries(Object.fromEntries(bucket));
	for (const [roleID, _] of ordered) pushRole(roleID, bucket.get(roleID)!);
    return lines.join("\n");
}
