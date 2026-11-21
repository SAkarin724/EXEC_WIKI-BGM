<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Dialog from '$lib/Dialog.svelte';
	import type {
		CreditCandidateFlag,
		CreditLineCandidate,
		CreditReviewData,
		CreditReviewDecision
	} from '$lib/importSource';
	import {
		creditsFromRows,
		lyricLines,
		parseRow,
		rowChanged,
		rowMatchesLyric,
		type CreditRow
	} from '$lib/importSource/creditText';
	import { orderedEntries } from '$lib/bangumiUtils';
	import { SONG_PAGE } from '$lib/importSource/netease';
	import Button from './Button.svelte';
	import { nameEscape } from './trackInfoWriter';

	/**
	 * 歌词头 credits 的人工确认窗口（主从分屏：左侧找曲目，右侧按行改「职位：人名」）。
	 *
	 * 右栏有编辑与预览两种状态：编辑态每行一个输入框（回车插行、空行退格删行、
	 * 整段粘贴自动拆行、改动行标黄），点歌词里的职位行能定位到对应行；
	 * 预览态与落盘同源：`creditsFromRows` 按 `orderedEntries` 排好职位与人名，
	 * 再用导入共用的 `nameEscape` 渲染，所以预览行序 = 曲目信息里的行序。
	 * 录入仍走 `toRoleId`（`竹笛` → `乐器-竹笛`、`人声` → `声乐-人声`），
	 * 与自动识别共用同一套职位映射。
	 */
	interface DeletedRow {
		id: number;
		text: string;
		raw: string | null;
		/** 删除时所在的位置，恢复时放回原处 */
		pos: number;
		flag?: CreditCandidateFlag | null;
	}

	interface Section {
		songId: number;
		title: string;
		lyric: string;
		rows: CreditRow[];
		/** 自动识别结果快照，点「恢复识别」时还原 */
		autoRows: { text: string; raw: string | null; flag?: CreditCandidateFlag | null }[];
		/** 从行列表里删掉的自动行，歌词区可以点回来 */
		deleted: DeletedRow[];
	}

	interface SectionInfo {
		lines: { row: CreditRow; roleId: string; names: string[] }[];
		/** 改动行数（含被删掉的行） */
		changed: number;
		/** 真正会写进 credits 的行数 */
		written: number;
		/** 缺人名（不会写入）的行数 */
		nameless: number;
		/** 自定义职位行数 */
		custom: number;
		/** 自动识别里需要人工复核的行数 */
		flagged: number;
	}

	interface LyricState {
		tone: 'plain' | 'pink' | 'amber' | 'deleted';
		rowId: number | null;
		entry?: DeletedRow;
	}

	interface Props {
		data: CreditReviewData;
		onconfirm: (decisions: CreditReviewDecision[]) => void;
		oncancel: () => void;
	}
	let { data, onconfirm, oncancel }: Props = $props();

	let show = $state(true);
	let settled = $state(false);

	/** 编辑 / 预览 */
	let mode = $state<'edit' | 'preview'>('edit');
	let currentIndex = $state(0);
	let query = $state('');
	let onlyPending = $state(false);
	let showLyric = $state(true);
	/** 窄屏时左栏收成抽屉，避免曲目清单把输入区挤没 */
	let compact = $state(false);
	let listOpen = $state(false);

	onMount(() => {
		const mq = window.matchMedia('(max-width: 47rem)');
		compact = mq.matches;
		const apply = () => {
			compact = mq.matches;
			if (!compact) listOpen = false;
		};
		mq.addEventListener('change', apply);
		return () => mq.removeEventListener('change', apply);
	});

	let nextRowId = 0;
	/** 一次性闪烁：跳到某行时用 */
	let flashId = $state<number | null>(null);
	let flashTimer: ReturnType<typeof setTimeout> | undefined;
	/** 行列表容器，定位输入框时按 `data-row-id` 找 */
	let listEl = $state<HTMLDivElement | undefined>();
	/** 当前聚焦的行（歌词区同步用黄色提示） */
	let focusId = $state<number | null>(null);

	/** 一条候选写入编辑器的形态：认得出职位就写标准 ID，认不出写原标签 */
	function rowText(line: CreditLineCandidate): string {
		return `${line.role ?? line.label}：${line.names.join('、')}`;
	}

	// 只在打开时从入参取一次初值，之后以窗口里的编辑为准
	// svelte-ignore state_referenced_locally
	let sections: Section[] = $state(
		data.tracks.map((track) => {
			const autoRows = track.lines.map((line) => ({
				text: rowText(line),
				raw: line.raw,
				flag: line.flag ?? null
			}));
			return {
				songId: track.songId,
				title: track.title,
				lyric: track.lyric ?? '',
				rows: autoRows.map((auto) => ({
					id: nextRowId++,
					text: auto.text,
					auto: auto.text,
					raw: auto.raw,
					flag: auto.flag
				})),
				autoRows,
				deleted: []
			};
		})
	);

	/** 每曲的行解析结果与徽标数字；只随行文本变化重算 */
	const sectionInfo = $derived(
		sections.map((section): SectionInfo => {
			const lines = section.rows.map((row) => ({ row, ...parseRow(row.text) }));
			return {
				lines,
				changed: section.rows.filter(rowChanged).length + section.deleted.length,
				written: lines.filter((line) => line.roleId && line.names.length > 0).length,
				nameless: lines.filter((line) => line.names.length === 0).length,
				custom: lines.filter((line) => line.roleId.startsWith('custom-')).length,
				// 只需复核还保留自动识别标记、且没被改过的行（改过就算人已经看过了）
				flagged: section.rows.filter((row) => row.flag && !rowChanged(row)).length
			};
		})
	);

	const totals = $derived(
		sectionInfo.reduce(
			(sum, info) => ({
				written: sum.written + info.written,
				custom: sum.custom + info.custom,
				changed: sum.changed + info.changed,
				flagged: sum.flagged + info.flagged
			}),
			{ written: 0, custom: 0, changed: 0, flagged: 0 }
		)
	);

	/** 需要人看一眼的曲目：一条行都没有、有行没填人名，或者有需要复核的自动识别行 */
	function pending(info: SectionInfo): boolean {
		return info.lines.length === 0 || info.nameless > 0 || info.flagged > 0;
	}

	const current = $derived(sections[currentIndex] ?? sections[0]);
	const currentInfo = $derived<SectionInfo | undefined>(sectionInfo[currentIndex] ?? sectionInfo[0]);
	const lines = $derived(current ? lyricLines(current.lyric) : []);

	const visible = $derived(
		sections
			.map((section, index) => ({ section, index, info: sectionInfo[index] }))
			.filter(({ section, index, info }) => {
				if (onlyPending && !pending(info)) return false;
				const q = query.trim().toLowerCase();
				if (!q) return true;
				const order = String(index + 1);
				return (
					section.title.toLowerCase().includes(q) ||
					order.includes(q) ||
					order.padStart(2, '0').includes(q)
				);
			})
	);

	/**
	 * 预览：按 `formatCreditsInputOrder` 的同一套构造写出本曲的职位行
	 * （`orderedEntries` 排序 + `nameEscape` 转义），与落盘文本逐字节一致。
	 * 时长、注释、艺术家这些由导入流程另补，不在本窗口的可编辑范围内。
	 */
	const previewLines = $derived(
		orderedEntries(creditsFromRows(current?.rows ?? [])).map(([role, names]) => ({
			role,
			text: names.map(nameEscape).join('、')
		}))
	);

	const previewSummary = $derived.by(() => {
		const credits = creditsFromRows(current?.rows ?? []);
		const names = Object.values(credits).reduce((sum, list) => sum + list.length, 0);
		return { roles: Object.keys(credits).length, names };
	});

	// 点遮罩关闭 / 取消：整次导入中止，条目一点都不会被改
	$effect(() => {
		if (!show && !settled) {
			settled = true;
			oncancel();
		}
	});

	function scrollToRow(id: number, flash = true) {
		const el = listEl?.querySelector<HTMLInputElement>(`input[data-row-id="${id}"]`);
		if (!el) return;
		el.scrollIntoView({ block: 'nearest' });
		el.focus();
		el.setSelectionRange(el.value.length, el.value.length);
		if (!flash) return;
		flashId = id;
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => (flashId = null), 650);
	}

	/** 在 `row` 之后插入若干行（`row` 为 null 时追加到末尾），聚焦最后一行 */
	function insertAfter(section: Section, row: CreditRow | null, texts: string[]) {
		const at = row ? section.rows.indexOf(row) + 1 : section.rows.length;
		const added: CreditRow[] = texts.map((text) => ({
			id: nextRowId++,
			text,
			auto: null,
			raw: null,
			flag: null
		}));
		section.rows.splice(at, 0, ...added);
		const last = added[added.length - 1];
		if (last) void tick().then(() => scrollToRow(last.id));
	}

	function removeRow(section: Section, row: CreditRow, index?: number) {
		const at = index ?? section.rows.indexOf(row);
		if (at < 0) return;
		section.rows.splice(at, 1);
		if (row.raw) {
			section.deleted.push({
				id: nextRowId++,
				text: row.text,
				raw: row.raw,
				pos: at,
				flag: row.flag
			});
		}
		const next = section.rows[Math.min(at, section.rows.length - 1)];
		if (next) void tick().then(() => scrollToRow(next.id, false));
	}

	function restoreDeleted(section: Section, entry: DeletedRow) {
		const at = Math.min(entry.pos, section.rows.length);
		section.rows.splice(at, 0, {
			id: nextRowId++,
			text: entry.text,
			auto: entry.text,
			raw: entry.raw,
			flag: entry.flag ?? null
		});
		section.deleted = section.deleted.filter((item) => item.id !== entry.id);
	}

	function restoreSection(section: Section) {
		section.rows = section.autoRows.map((auto) => ({
			id: nextRowId++,
			text: auto.text,
			auto: auto.text,
			raw: auto.raw,
			flag: auto.flag ?? null
		}));
		section.deleted = [];
		focusId = null;
	}

	function selectSong(index: number) {
		currentIndex = index;
		focusId = null;
		showLyric = true;
		listOpen = false;
	}

	/** 一行歌词对应到哪：命中行、已改行（琥珀）、已删除行（划线可恢复） */
	function lyricState(section: Section, line: string): LyricState {
		const hit = section.rows.find((row) => rowMatchesLyric(row.raw, line));
		if (hit) {
			const tone = rowChanged(hit) || focusId === hit.id ? 'amber' : 'pink';
			return { tone, rowId: hit.id };
		}
		const gone = section.deleted.find((entry) => rowMatchesLyric(entry.raw, line));
		if (gone) return { tone: 'deleted', rowId: null, entry: gone };
		return { tone: 'plain', rowId: null };
	}

	function jumpToLyric(section: Section, state: LyricState) {
		if (state.rowId !== null) scrollToRow(state.rowId);
		else if (state.entry) restoreDeleted(section, state.entry);
	}

	/**
	 * 歌词行的三态着色。琥珀态的底色不能写在 `bg-transparent` 之旁，
	 * 否则 UnoCSS 会按生成顺序让 transparent 覆盖掉 `bg-[#FEF3C7]`。
	 */
	function lyricClass(tone: LyricState['tone']): string {
		const base =
			'block w-full text-left text-[0.7rem] leading-5 border-0 cursor-pointer pl-1.5 -ml-1.5 transition-colors border-l-2';
		if (tone === 'amber')
			return `${base} border-l-[#E5A93C] bg-[#FEF3C7] text-[#8A5A12] rounded-r`;
		if (tone === 'deleted')
			return `${base} bg-transparent border-l-bgm-grey/40 border-dashed text-bgm-grey/70 line-through`;
		return `${base} bg-transparent border-l-bgm-pink text-bgm-darkgrey`;
	}

	function handleKeydown(event: KeyboardEvent, section: Section, row: CreditRow, index: number) {
		if (event.key === 'Enter') {
			event.preventDefault();
			insertAfter(section, row, ['']);
			return;
		}
		if (event.key === 'Backspace' && !row.text) {
			event.preventDefault();
			removeRow(section, row, index);
		}
	}

	/** 整段粘贴自动拆行：当前行空着就先填第一行，其余插到后面 */
	function handlePaste(event: ClipboardEvent, section: Section, row: CreditRow) {
		const text = event.clipboardData?.getData('text') ?? '';
		if (!/[\r\n]/.test(text)) return;
		const pasted = text
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
		if (pasted.length === 0) return;
		event.preventDefault();
		if (!row.text.trim()) row.text = pasted.shift() as string;
		if (pasted.length > 0) insertAfter(section, row, pasted);
	}

	function cancel() {
		settled = true;
		show = false;
		oncancel();
	}

	function confirm() {
		const decisions: CreditReviewDecision[] = sections.map((section) => ({
			songId: section.songId,
			credits: creditsFromRows(section.rows)
		}));
		settled = true;
		show = false;
		onconfirm(decisions);
	}
</script>

<Dialog
	bind:show
	class="w-[62rem] max-w-[94vw] h-[80vh] max-h-[48rem] min-h-[26rem] !p-0 overflow-hidden flex flex-col"
>
	<!-- 顶栏：说明 + 编辑/预览切换 + 全局统计 -->
	<header class="flex items-center gap-2 flex-wrap px-4 py-2.5 border-b border-bgm-grey/20 flex-shrink-0">
		{#if compact}
		<button
			class="flex-shrink-0 rounded-md border border-bgm-grey/25 bg-white px-2 py-0.5 text-[0.7rem] text-bgm-darkgrey cursor-pointer hover:border-bgm-pink"
			onclick={() => (listOpen = !listOpen)}
			aria-expanded={listOpen}>曲目 {currentIndex + 1}/{sections.length}</button
		>
	{/if}
	<h2 class="text-bgm-pink text-lg flex-shrink-0">歌词里的词曲信息</h2>
		<p class="text-[0.7rem] text-bgm-grey min-w-0 flex-1 truncate">
			黄色是本曲改动 · 点歌词里的职位行可跳到对应行 · 站内没有的职位写成 custom-中文职位
		</p>
		<div class="inline-flex items-center rounded-full bg-bgm-grey/12 p-0.5 text-[0.72rem] flex-shrink-0">
			<button
				class="px-2.5 py-0.5 rounded-full border-0 cursor-pointer transition-colors {mode === 'edit'
					? 'bg-white text-bgm-pink font-medium shadow-sm'
					: 'bg-transparent text-bgm-grey hover:text-bgm-darkgrey'}"
				onclick={() => (mode = 'edit')}>编辑</button
			>
			<button
				class="px-2.5 py-0.5 rounded-full border-0 cursor-pointer transition-colors {mode === 'preview'
					? 'bg-white text-bgm-pink font-medium shadow-sm'
					: 'bg-transparent text-bgm-grey hover:text-bgm-darkgrey'}"
				onclick={() => (mode = 'preview')}>预览</button
			>
		</div>
		<div class="flex items-center gap-1.5 text-[0.72rem] text-bgm-grey tabular-nums flex-shrink-0">
			<span>{sections.length} 曲</span>
			<span class="text-bgm-grey/40">·</span>
			<span>{totals.written} 条</span>
			{#if totals.changed > 0}
				<span class="text-bgm-grey/40">·</span>
				<span class="text-[#8A5A12]">{totals.changed} 处改动</span>
			{/if}
			{#if totals.custom > 0}
				<span class="text-bgm-grey/40">·</span>
				<span>{totals.custom} 条自定义职位</span>
			{/if}
			{#if totals.flagged > 0}
				<span class="text-bgm-grey/40">·</span>
				<span class="text-[#8A5A12]">{totals.flagged} 行需核对</span>
			{/if}
		</div>
	</header>

	<div class="relative flex flex-1 min-h-0">
		{#if compact && listOpen}
			<button
				class="absolute inset-0 z-10 border-0 bg-black/10 cursor-default"
				aria-label="收起曲目清单"
				onclick={() => (listOpen = false)}
			></button>
		{/if}
		<!-- 左栏：曲目清单 -->
		<aside
			class="w-[13rem] flex-shrink-0 flex flex-col border-r border-bgm-grey/20 min-h-0 {compact
				? `absolute inset-y-0 left-0 z-20 bg-white shadow-lg transition-transform duration-200 ${listOpen
						? 'translate-x-0'
						: '-translate-x-full'}`
				: 'bg-bgm-lightgrey/40'}"
		>
			<div class="p-2 border-b border-bgm-grey/15">
				<input
					type="search"
					class="w-full rounded-md border border-bgm-grey/25 bg-white px-2 py-1 text-[0.72rem] focus:outline-none focus:border-bgm-pink"
					placeholder="搜曲名或序号"
					aria-label="搜曲名或序号"
					bind:value={query}
				/>
			</div>
			<label
				class="flex items-center gap-1.5 px-2.5 py-1.5 text-[0.68rem] text-bgm-grey cursor-pointer border-b border-bgm-grey/15 select-none"
			>
				<input type="checkbox" class="accent-bgm-pink" bind:checked={onlyPending} />
				只看待处理
			</label>
			<ul class="flex-1 min-h-0 overflow-y-auto py-1">
				{#each visible as { section, index, info } (section.songId)}
					{@const active = index === currentIndex}
					<li class="group flex items-start">
						<button
							class="flex-1 min-w-0 text-left px-2 py-1.5 border-0 cursor-pointer bg-transparent transition-colors border-l-[3px] {active
								? 'bg-bgm-pink/10 border-l-bgm-pink'
								: 'border-l-transparent hover:bg-bgm-grey/8'}"
							onclick={() => selectSong(index)}
						>
							<span class="flex items-baseline gap-1">
								<span class="text-[0.62rem] text-bgm-grey tabular-nums"
									>{String(index + 1).padStart(2, '0')}</span
								>
								<span
									class="text-[0.74rem] truncate {active
										? 'text-bgm-darkgrey'
										: 'text-bgm-darkgrey/80'}">{section.title}</span
								>
							</span>
							<span class="mt-0.5 flex items-center gap-1 text-[0.6rem] flex-wrap">
								<span class="text-bgm-grey tabular-nums">{info.written} 条</span>
								{#if info.changed > 0}
									<span class="rounded px-1 bg-[#FEF3C7] text-[#8A5A12]">改 {info.changed}</span>
								{/if}
								{#if info.nameless > 0}
									<span class="rounded px-1 bg-bgm-grey/15 text-bgm-grey">缺人名</span>
								{/if}
								{#if info.flagged > 0}
									<span
										class="rounded px-1 bg-[#FEF3C7] text-[#8A5A12]"
										title="自动识别里有需要复核的写法（如一行叠写两个职位）">核对 {info.flagged}</span
									>
								{/if}
								{#if info.lines.length === 0}
									<span class="rounded px-1 bg-[#FDECEC] text-[#B32424]">无行</span>
								{/if}
							</span>
						</button>
						<a
							class="flex-shrink-0 px-1 pt-1.5 text-[0.68rem] text-bgm-teal no-underline opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
							href={SONG_PAGE + section.songId}
							target="_blank"
							rel="noopener noreferrer"
							title="在网易云打开这首曲目"
							aria-label="在网易云打开这首曲目">↗</a
						>
					</li>
				{/each}
				{#if visible.length === 0}
					<li class="px-2.5 py-2 text-[0.68rem] text-bgm-grey">没有匹配的曲目</li>
				{/if}
			</ul>
			<div class="px-2 py-1.5 text-[0.65rem] text-bgm-grey border-t border-bgm-grey/15">
				{visible.length} / {sections.length} 曲
			</div>
		</aside>

		<!-- 右栏 -->
		<section class="flex-1 min-w-0 min-h-0 flex flex-col">
			{#if current && currentInfo}
				<!-- 曲目头部：序号 + 曲名 + 网易云 + 恢复识别 -->
				<header class="px-3 py-2 border-b border-bgm-grey/15 flex items-center gap-2 flex-shrink-0">
					<span class="text-[0.7rem] text-bgm-grey tabular-nums flex-shrink-0"
						>第 {String(currentIndex + 1).padStart(2, '0')} 曲</span
					>
					<h3 class="text-sm font-medium text-bgm-darkgrey truncate min-w-0">{current.title}</h3>
					<a
						class="text-[0.7rem] text-bgm-teal no-underline hover:underline whitespace-nowrap flex-shrink-0"
						href={SONG_PAGE + current.songId}
						target="_blank"
						rel="noopener noreferrer"
						title="在网易云打开这首曲目">网易云 ↗</a
					>
					<div class="ml-auto flex items-center gap-3 text-[0.7rem] flex-shrink-0">
						{#if currentInfo.changed > 0}
							<button
								class="bg-transparent border-0 p-0 cursor-pointer text-bgm-teal hover:underline"
								onclick={() => restoreSection(current)}>恢复识别</button
							>
						{/if}
						{#if mode === 'edit' && current.lyric}
							<button
								class="bg-transparent border-0 p-0 cursor-pointer text-bgm-teal hover:underline"
								onclick={() => (showLyric = !showLyric)}
								>{showLyric ? '收起歌词' : '看歌词'}</button
							>
						{/if}
					</div>
				</header>

				{#if mode === 'edit'}
					<div class="flex-1 min-h-0 flex flex-col">
						{#if showLyric}
							<div
								class="mx-3 mt-2 flex-shrink-0 rounded-md border border-bgm-grey/20 bg-bgm-lightgrey/60 px-2 py-1.5 max-h-[10rem] overflow-y-auto"
							>
								{#if lines.length === 0}
									<p class="text-[0.7rem] text-bgm-grey">这首没有歌词文本，只能手填。</p>
								{:else}
									{#each lines as line}
										{@const state = lyricState(current, line)}
										{#if state.tone === 'plain'}
											<p class="text-[0.7rem] leading-5 text-bgm-grey/85">{line}</p>
										{:else}
											<button
												class={lyricClass(state.tone)}
												title={state.tone === 'deleted'
													? '这一行对应的职位行已删除，点一下恢复'
													: '跳到对应的职位行'}
												onclick={() => jumpToLyric(current, state)}>{line}</button
											>
										{/if}
									{/each}
								{/if}
							</div>
						{/if}
						<div class="flex-1 min-h-0 flex flex-col px-3 pt-1.5 pb-1">
							<div bind:this={listEl} class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 pr-0.5">
								{#each currentInfo.lines as info, i (info.row.id)}
									{@const row = info.row}
									{@const changed = rowChanged(row)}
									<div
										class="group flex items-start gap-1.5 rounded-md border pl-1 pr-0.5 transition-all duration-150 {changed
											? 'bg-[#FFF7E0] border-[#E5A93C]/60'
											: 'bg-white border-bgm-grey/20'} {flashId === row.id
											? 'ring-2 ring-bgm-pink/60'
											: ''} {focusId === row.id ? 'ring-1 ring-bgm-pink/35' : ''}"
									>
										<span
											class="w-4 pt-1.5 text-[0.62rem] text-bgm-grey/80 tabular-nums select-none flex-shrink-0"
											>{String(i + 1).padStart(2, '0')}</span
										>
										<input
											data-row-id={row.id}
											class="flex-1 min-w-0 bg-transparent border-0 px-0.5 py-1 text-[0.78rem] leading-5 focus:outline-none placeholder:text-bgm-grey/50 {changed
												? 'text-[#8A5A12]'
												: 'text-[#333]'}"
											placeholder="职位：人名"
											spellcheck="false"
											aria-label="职位：人名"
											bind:value={row.text}
											onfocus={() => (focusId = row.id)}
											onblur={() => {
												if (focusId === row.id) focusId = null;
											}}
											onkeydown={(event) => handleKeydown(event, current, row, i)}
											onpaste={(event) => handlePaste(event, current, row)}
										/>
										{#if row.flag === 'nested-role' && !changed}
											<span
												class="mt-1 flex-shrink-0 rounded bg-[#FEF3C7] px-1 text-[0.58rem] leading-4 text-[#8A5A12] select-none"
												title="歌词这一行叠写了两个职位（基础职位 + 子职位），已合并成「基础职位-子职位」；写法极少见，请核对拆分是否正确"
												>两级</span
											>
										{/if}
										{#if info.names.length === 0}
											<span class="pt-1.5 text-[0.6rem] text-bgm-grey flex-shrink-0 select-none"
												>不写入</span
											>
										{:else if info.roleId.startsWith('custom-')}
											<span
												class="pt-1.5 text-[0.6rem] text-bgm-grey/70 flex-shrink-0 select-none"
												>自定义</span
											>
										{/if}
										<button
											class="mt-0.5 flex-shrink-0 w-5 h-6 border-0 bg-transparent rounded text-bgm-grey cursor-pointer opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-[#B32424] hover:bg-bgm-grey/10 transition-opacity"
											title="删除这一行"
											aria-label="删除这一行"
											onclick={() => removeRow(current, row)}>×</button
										>
									</div>
								{/each}
								<button
									class="mt-0.5 border border-dashed border-bgm-grey/30 bg-transparent rounded-md py-1 text-[0.68rem] text-bgm-grey cursor-pointer hover:text-bgm-teal hover:border-bgm-teal/50"
									onclick={() => insertAfter(current, null, [''])}>＋ 加一行</button
								>
							</div>
						</div>
					</div>
				{:else}
					<div class="flex-1 min-h-0 flex flex-col">
						<p class="mx-3 mt-2 text-[0.68rem] text-bgm-grey flex-shrink-0">
							以下职位行连同顺序会原样写进本曲的曲目信息；时长、注释、艺术家由导入流程另补
						</p>
						<div
							class="flex-1 min-h-0 mx-3 mb-2 mt-1 overflow-y-auto rounded-md border border-bgm-grey/25 bg-white px-2.5 py-2"
						>
							{#if previewLines.length === 0}
								<p class="text-[0.74rem] text-bgm-grey">这首还没有任何职位行。</p>
							{/if}
							{#each previewLines as line}
								<p class="text-[0.78rem] leading-6">
									<span class="text-bgm-pink">{line.role}</span><span class="text-bgm-grey">：</span
									><span class="text-[#333]">{line.text}</span>
								</p>
							{/each}
						</div>
						<div class="mx-3 mb-2 flex items-center gap-2 text-[0.65rem] text-bgm-grey flex-shrink-0">
							<span class="tabular-nums"
								>{previewSummary.roles} 个职位 / {previewSummary.names} 人</span
							>
							{#if currentInfo.nameless > 0}
								<span class="text-bgm-grey/40">·</span>
								<span>{currentInfo.nameless} 行缺人名，不会写入</span>
							{/if}
						</div>
					</div>
				{/if}

				<footer
					class="px-3 py-1.5 border-t border-bgm-grey/15 flex items-center gap-2 text-[0.65rem] text-bgm-grey flex-wrap flex-shrink-0"
				>
					<span class="tabular-nums">本曲写入 {currentInfo.written} 条</span>
					{#if currentInfo.custom > 0}
						<span class="text-bgm-grey/40">·</span>
						<span class="tabular-nums">{currentInfo.custom} 条自定义职位</span>
					{/if}
					{#if currentInfo.nameless > 0}
						<span class="text-bgm-grey/40">·</span>
						<span class="tabular-nums">{currentInfo.nameless} 行缺人名</span>
					{/if}
					{#if currentInfo.flagged > 0}
						<span class="text-bgm-grey/40">·</span>
						<span class="tabular-nums text-[#8A5A12]">{currentInfo.flagged} 行需核对</span>
					{/if}
					{#if currentInfo.changed > 0}
						<span class="text-bgm-grey/40">·</span>
						<span class="tabular-nums text-[#8A5A12]">{currentInfo.changed} 处改动</span>
					{/if}
					<span class="ml-auto">
						{#if currentInfo.flagged > 0}
							<span class="text-[#8A5A12]">「两级」= 歌词里叠写了两个职位，已合并成「基础-子」</span>
							<span class="text-bgm-grey/40">· </span>
						{/if}
						一行一条「职位：人名」· 回车插行 · 空行退格删行 · 可整段粘贴
					</span>
				</footer>
			{/if}
		</section>
	</div>

	<!-- 底部：整次导入的取舍 -->
	<footer class="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-bgm-grey/20 flex-shrink-0">
		<p class="mr-auto text-[0.65rem] text-bgm-grey">取消 = 整次导入中止，条目不会被改动</p>
		<Button onclick={async () => cancel()}>取消导入</Button>
		<Button onclick={async () => confirm()} class="!bg-bgm-pink !text-white">采用并继续</Button>
	</footer>
</Dialog>