import { durationToSeconds, type Release, type Track } from './common';

export interface TrackListParseOptions {
	/** true = `艺术家 - 曲目名`；false（默认）= `曲目名 - 艺术家` */
	artistFirst?: boolean;
}

interface ParsedRow {
	disc: number;
	track: number;
	title: string;
	comment: string;
	artist: string;
	duration: number | null;
}

function parseLine(
	line: string,
	fallbackTrack: number,
	options: TrackListParseOptions,
	/** Bandcamp 两行格式固定为「艺术家 - 曲目名」，忽略界面上的顺序选项 */
	forceArtistFirst = false
): ParsedRow | null {
	// 站内 pipe：光盘编号|曲目编号|原文标题|简体中文标题|时长
	if (line.includes('|')) {
		const parts = line.split('|').map((p) => p.trim());
		if (parts.length >= 3) {
			const disc = parseInt(parts[0], 10) || 1;
			const track = parseInt(parts[1], 10) || fallbackTrack;
			const title = parts[2];
			const comment = parts[3] ?? '';
			const duration = parts[4] ? durationToSeconds(parts[4]) : null;
			if (title) return { disc, track, title, comment, artist: '', duration };
		}
	}

	// TSV：编号<TAB>曲目名<TAB>时长（也兼容多一列注释）
	if (line.includes('\t')) {
		const parts = line.split('\t').map((p) => p.trim());
		if (parts.length >= 3) {
			const track = parseInt(parts[0], 10) || fallbackTrack;
			const title = parts[1];
			const last = parts[parts.length - 1];
			const duration = durationToSeconds(last);
			const comment = parts.length >= 4 && duration !== null ? parts[2] : '';
			if (title) return { disc: 1, track, title, comment, artist: '', duration };
		}
	}

	// 无分隔符的编号 + 标题 + 时长：01 Defectus(Intro) 1:39
	const m2 = line.match(/^\s*(\d+)\s+(.+?)\s+(\d{1,3}:\d{2}(?::\d{2})?)\s*$/);
	if (m2) {
		const track = parseInt(m2[1], 10);
		const title = m2[2].trim();
		const duration = durationToSeconds(m2[3]);
		if (title) return { disc: 1, track, title, comment: '', artist: '', duration };
	}

	// 格式 1：1. 曲目名 - 艺术家 (01:38)
	const m = line.match(/^\s*(\d+)\s*[.、)]\s*(.+)$/);

	// Bandcamp 单行（两行格式被合并后，或整行未带编号）：艺术家 - 曲目名 02:50
	if (!m) {
		const bm = line.match(/^(.+?)\s+(\d{1,3}:\d{2}(?::\d{2})?)\s*$/);
		if (!bm || !/\s+-\s+/.test(bm[1])) return null;

		const rest = bm[1].trim();
		const duration = durationToSeconds(bm[2]);
		const parts = rest
			.split(/\s+-\s+/)
			.map((p) => p.trim())
			.filter(Boolean);
		if (parts.length < 2) return null;

		const artist = forceArtistFirst || options.artistFirst ? parts[0] : parts[parts.length - 1];
		const title =
			forceArtistFirst || options.artistFirst
				? parts.slice(1).join(' - ')
				: parts.slice(0, -1).join(' - ');
		if (!title) return null;
		return { disc: 1, track: fallbackTrack, title, comment: '', artist, duration };
	}

	const track = parseInt(m[1], 10);
	let rest = m[2].trim();
	let duration: number | null = null;
	const dm = rest.match(/^(.*?)\s*\((\d{1,3}:\d{2}(?::\d{2})?)\)\s*$/);
	if (dm) {
		duration = durationToSeconds(dm[2]);
		rest = dm[1].trim();
	} else {
		const dm2 = rest.match(/^(.*?)\s+(\d{1,3}:\d{2}(?::\d{2})?)\s*$/);
		if (dm2) {
			duration = durationToSeconds(dm2[2]);
			rest = dm2[1].trim();
		}
	}

	const parts = rest
		.split(/\s+-\s+/)
		.map((p) => p.trim())
		.filter(Boolean);
	let title = rest;
	let artist = '';
	if (parts.length >= 2) {
		if (forceArtistFirst || options.artistFirst) {
			artist = parts[0];
			title = parts.slice(1).join(' - ');
		} else {
			artist = parts[parts.length - 1];
			title = parts.slice(0, -1).join(' - ');
		}
	}

	if (!title) return null;
	return { disc: 1, track, title, comment: '', artist, duration };
}

/**
 * 艺术家字段里的多名并列（Bandcamp 的合作曲写作 `兎角菫, irukanotane`）：
 * 逗号/顿号分隔的是多个人，不能整体当一个名字（否则写出去会变成 `《兎角菫, irukanotane》`）。
 */
const ARTIST_NAME_SEP_RE = /[,，、]/;

function splitArtistNames(raw: string): string[] {
	return String(raw ?? '')
		.split(ARTIST_NAME_SEP_RE)
		.map((n) => n.trim())
		.filter(Boolean);
}

const BARE_NUMBER_RE = /^(\d+)\s*[.、)．]?$/;
const BARE_DURATION_RE = /^(\d{1,3}:\d{2}(?::\d{2})?)$/;

/**
 * Bandcamp 复制出来的是两行一组：
 * ```
 * 1.
 * samebeam - do you understand how i feel? 02:50
 * ```
 * 这里把「纯编号行 + 下一行内容」拼成一行，交给 parseLine 处理。
 * 时长可能被单独放在第三行（`1.` / `艺术家 - 曲目名` / `02:50`），一并合并。
 */
function joinBandcampRows(lines: string[]): { text: string; bandcamp: boolean }[] {
	const result: { text: string; bandcamp: boolean }[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const num = line.match(BARE_NUMBER_RE);
		const next = lines[i + 1];
		if (!num || !next || BARE_NUMBER_RE.test(next)) {
			result.push({ text: line, bandcamp: false });
			continue;
		}

		let content = next;
		let consumed = 1;
		const afterNext = lines[i + 2];
		if (afterNext && BARE_DURATION_RE.test(afterNext) && !BARE_DURATION_RE.test(next)) {
			content = `${next} ${afterNext}`;
			consumed = 2;
		}

		result.push({ text: `${num[1]}. ${content}`, bandcamp: true });
		i += consumed;
	}

	return result;
}

/**
 * 解析曲目表文本，支持：
 * - `1. 后空 - 神遛儿 (01:38)`
 * - `01 曲目名 1:39`
 * - `01\tDefectus(Intro)\t1:39`
 * - `1|1|原文标题|简体中文标题|01:38`
 * - Bandcamp 两行：`1.` 换行 `samebeam - do you understand how i feel? 02:50`
 */
export function parseTrackList(text: string, options: TrackListParseOptions = {}): Release {
	const rows: ParsedRow[] = [];
	const lines = joinBandcampRows(
		String(text ?? '')
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean)
	);

	for (const { text: line, bandcamp } of lines) {
		const row = parseLine(line, rows.length + 1, options, bandcamp);
		if (row) rows.push(row);
	}

	if (!rows.length) throw new Error('没有识别到曲目');

	const byDisc = new Map<number, ParsedRow[]>();
	for (const row of rows) {
		const disc = row.disc > 0 ? row.disc : 1;
		const list = byDisc.get(disc) ?? [];
		list.push(row);
		byDisc.set(disc, list);
	}

	const discs = Array.from(byDisc.keys())
		.sort((a, b) => a - b)
		.map((disc) => {
			const list = (byDisc.get(disc) ?? []).sort((a, b) => a.track - b.track);
			const tracks: Track[] = list.map((row) => {
				const track: Track = {
					title: row.title,
					comment: row.comment,
					credits: {}
				};
				const artistNames = splitArtistNames(row.artist);
				if (artistNames.length) track.credits['艺术家'] = artistNames;
				if (row.duration !== null && row.duration > 0) track.duration = row.duration;
				return track;
			});
			return { tracks };
		});

	return { credits: {}, discs };
}

function normalizeTrackTitle(title: string): string {
	return String(title ?? '')
		.normalize('NFKC')
		.toLowerCase()
		.replace(/^\s*\d+\s*[.、)．]?\s*/, '')
		.trim();
}

/**
 * 按标题把 incoming 的时长 / 空字段合并进 existing。
 * - 只补时长、空 comment、空 credit，不覆盖已有的艺术家/注释；
 * - incoming 中找不到的标题直接跳过，不删除/不重排 existing 的曲目；
 * - existing 为空时由调用方直接使用 incoming（新建）。
 */
export function mergeTrackList(existing: Release, incoming: Release): Release {
	const byTitle = new Map<string, { track: Track; used: boolean }[]>();

	for (const disc of existing.discs) {
		for (const track of disc.tracks) {
			const key = normalizeTrackTitle(track.title);
			if (!key) continue;
			const list = byTitle.get(key) ?? [];
			list.push({ track, used: false });
			byTitle.set(key, list);
		}
	}

	for (const disc of incoming.discs) {
		for (const track of disc.tracks) {
			const key = normalizeTrackTitle(track.title);
			const list = byTitle.get(key);
			const entry = list?.find((item) => !item.used) ?? list?.[0];
			if (!entry) continue;
			entry.used = true;

			if (typeof track.duration === 'number' && track.duration > 0) {
				entry.track.duration = track.duration;
			}
			if (!entry.track.comment && track.comment) {
				entry.track.comment = track.comment;
			}
			for (const [role, names] of Object.entries(track.credits)) {
				if (!entry.track.credits[role]?.length) {
					entry.track.credits[role] = [...names];
				}
			}
		}
	}

	return existing;
}
