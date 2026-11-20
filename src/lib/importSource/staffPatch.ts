import type { Release, Credits } from "./common";

/**
 * 读取 `bangumi-wiki-staff-display-fix` 仓库中的 staff 修复数据。
 *
 * 数据以条目 id 存储为 `data/{subjectId}.json`（例如
 * https://bgm.tv/subject/711584 -> data/711584.json）。
 *
 * 读取方式与《音乐条目显示各曲目参与制作人员信息 ++ 维基端》的“人员修复”
 * 一致：优先走 Cloudflare Worker（@bgm-music-wiki-staff-patch-worker 的
 * `/subject-content`），失败时回退到仓库镜像（raw.githubusercontent /
 * jsDelivr），后者对任意源开放 CORS。
 */

export const STAFF_PATCH_WORKER_URL = "https://worker.sakarin724.top";

const MIRROR_URL_BUILDERS: ((subjectId: number | string) => string)[] = [
	(subjectId) =>
		`https://raw.githubusercontent.com/nightStarLights/bangumi-wiki-staff-display-fix/main/data/${subjectId}.json`,
	(subjectId) =>
		`https://cdn.jsdelivr.net/gh/nightStarLights/bangumi-wiki-staff-display-fix@main/data/${subjectId}.json`,
];

interface StaffPatchEntity {
	ref?: string | null;
	text?: string | null;
}

export interface StaffPatchItem {
	ref?: string | null;
	text?: string | null;
	type?: string | null;
	person?: StaffPatchEntity | null;
	alias?: StaffPatchEntity | null;
	cv?: StaffPatchEntity | null;
	inst?: string | null;
	character?: string | null;
	parts?: (string | StaffPatchEntity)[];
	[key: string]: unknown;
}

export interface StaffPatchContent {
	subjectId?: number;
	/** trackKey（"disc.track"，均从 1 开始）-> roleKey -> items */
	trackCredits?: Record<string, Record<string, StaffPatchItem[]>>;
	/** 条目级信息：roleKey -> items */
	epinfo?: Record<string, StaffPatchItem[]>;
	/** 人员修复输入区的原始文本（形如 `角色：名字(1,3-5)、...`） */
	rawPatches?: { editor?: string } & Record<string, string>;
	[key: string]: unknown;
}

export async function fetchStaffPatch(subjectId: number): Promise<StaffPatchContent | null> {
	// 1) 优先走 Worker（其 `/subject-content` 通过 GitHub API 读取主分支文件）
	const workerRes = await fetchFromWorker(subjectId);
	if (workerRes) return workerRes;

	// 2) Worker 不通时，回退到仓库镜像
	for (const build of MIRROR_URL_BUILDERS) {
		const url = build(subjectId);
		try {
			const res = await fetch(url, { method: "GET", mode: "cors", cache: "no-store" });
			if (res.ok) {
				const data = (await res.json()) as StaffPatchContent;
				if (data && typeof data === "object") return data;
			}
			if (res.status === 404) break; // 仓库里没有该条目
		} catch {
			// 尝试下一个镜像
		}
	}

	return null;
}

async function fetchFromWorker(subjectId: number): Promise<StaffPatchContent | null> {
	const url = `${STAFF_PATCH_WORKER_URL}/subject-content?subjectId=${encodeURIComponent(subjectId)}`;
	try {
		const res = await fetch(url, { method: "GET", mode: "cors", cache: "no-store" });
		if (!res.ok) return null;
		const data = (await res.json()) as {
			ok?: boolean;
			found?: boolean;
			content?: StaffPatchContent | null;
		};
		if (!data?.ok || !data?.found) return null;
		return data.content ?? null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// 从结构化 trackCredits / epinfo 还原 Credits
// ---------------------------------------------------------------------------

interface ParsedCredits {
	epinfo: Credits;
	tracks: Record<string, Credits>;
}

/** roleKey -> BGM 职位名。写入侧（生成 patch_content）用它的反查表。 */
export const PATCH_ROLE_TO_BGM: Record<string, string> = {
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

function itemDisplayName(item: StaffPatchItem): string {
	const person = item.person?.text?.trim() ?? "";
	const alias = item.alias?.text?.trim() ?? "";
	const cv = item.cv?.text?.trim() ?? "";
	const character = item.character?.trim() ?? "";

	switch (item.type) {
		case "alias_person":
			return alias && person ? `${alias} (${person})` : person || alias;
		case "instrument_credit":
		case "alias_instrument_credit":
			// 乐器名会并入职位（乐器-xxx），这里只保留人名
			return alias && person ? `${alias} (${person})` : person || alias;
		case "cv_credit":
			return character ? `${character}(CV:${cv})` : cv;
		default:
			break;
	}

	if (Array.isArray(item.parts)) {
		return item.parts
			.map((p) => (typeof p === "string" ? p : p?.text ?? ""))
			.join("")
			.trim();
	}

	return person || (item.text ?? "").trim();
}

function patchRoleToBgm(roleKey: string): string {
	return PATCH_ROLE_TO_BGM[roleKey] ?? roleKey;
}

/** 把一组 item 写入目标 credits；instrument 会按每个 item 的 inst 拆成 乐器-xxx */
function appendItems(target: Credits, roleKey: string, items: unknown): void {
	if (!Array.isArray(items)) return;
	if (roleKey === "instrument") {
		for (const it of items as StaffPatchItem[]) {
			const name = itemDisplayName(it);
			if (!name) continue;
			const inst = it?.inst?.trim();
			const role = inst ? `乐器-${inst}` : "乐器";
			(target[role] ??= []).push(name);
		}
		return;
	}
	const names = (items as StaffPatchItem[])
		.map((it) => itemDisplayName(it))
		.filter((name) => name.length > 0);
	if (names.length) target[patchRoleToBgm(roleKey)] = names;
}

function trackCreditsToMaps(patch: StaffPatchContent): ParsedCredits {
	const epinfo: Credits = {};
	const tracks: Record<string, Credits> = {};

	for (const [roleKey, items] of Object.entries(patch.epinfo ?? {})) {
		appendItems(epinfo, roleKey, items);
	}

	for (const [trackKey, roleMap] of Object.entries(patch.trackCredits ?? {})) {
		const target = (tracks[trackKey] ??= {});
		for (const [roleKey, items] of Object.entries(roleMap ?? {})) {
			appendItems(target, roleKey, items);
		}
	}

	return { epinfo, tracks };
}

// ---------------------------------------------------------------------------
// 解析：直接读每首曲目的结构化 trackCredits / epinfo 重建。
//
// 不使用 rawPatches.editor：它只是展示文本，重新解析会丢掉团体标注、别名写法和
// 原始空格。结构化的 trackCredits / epinfo 才是导入的权威数据。
// ---------------------------------------------------------------------------

function parsePatchCredits(patch: StaffPatchContent): ParsedCredits {
	return trackCreditsToMaps(patch);
}

// ---------------------------------------------------------------------------
// 应用：Patch 独占
//
// 命中 Patch（从结构化 trackCredits / epinfo 重建）时，条目级与曲目级的制作人员信息完全以
// Patch 为准，不再并入默认导入（页面 infobox / 关联人物）的残留。
// 否则页面上的 `乐器：Guitar：ケンシロー`、`编曲：Orchestral Arrangement：…`
// 这类无法解析的 infobox 片段会把 Patch 结果污染，并和 Patch 的逐曲目信息重复。
//
// 曲目结构（碟号 / 曲名 / 备注）仍沿用默认导入的结果，只替换 credits。
// ---------------------------------------------------------------------------

export function applyStaffPatchToRelease(
	patch: StaffPatchContent,
	base: Release
): Release {
	const parsed = parsePatchCredits(patch);

	// Patch 里解析不出任何信息时保持默认导入的结果不变
	if (Object.keys(parsed.epinfo).length === 0 && Object.keys(parsed.tracks).length === 0) {
		return base;
	}

	// 条目级信息：只取 Patch
	const credits: Credits = {};
	for (const [role, names] of Object.entries(parsed.epinfo)) {
		if (names.length) credits[role] = names;
	}

	// 逐曲目信息：只取 Patch（保留默认导入的曲名 / 备注）
	const discs = base.discs.map((disc) => ({
		tracks: disc.tracks.map((track) => ({
			title: track.title,
			comment: track.comment,
			credits: {} as Credits,
		})),
	}));

	for (const [trackKey, roleMap] of Object.entries(parsed.tracks)) {
		const m = /^(\d+)\.(\d+)$/.exec(trackKey);
		if (!m) continue;
		const discIdx = Number(m[1]) - 1;
		const trackIdx = Number(m[2]) - 1;
		const target = discs[discIdx]?.tracks?.[trackIdx];
		if (!target) continue;

		for (const [role, names] of Object.entries(roleMap)) {
			if (names.length) target.credits[role] = names;
		}
	}

	return { credits, discs };
}
