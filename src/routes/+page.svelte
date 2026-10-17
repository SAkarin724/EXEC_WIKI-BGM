<script lang="ts">
	import 'uno.css';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { onMount, untrack } from 'svelte';

	import TrackInfo from './TrackInfo.svelte';
	import InfoBox, * as infoBox from './InfoBox.svelte';
	import Preview from './Preview.svelte';
	import Gallery from './Gallery.svelte';
	import { type RawRelease } from './lang-rkgk.ts';
	import { Release, Role } from './postprocess.ts';
	import { resolveRelaMap } from './disambiguation.ts';
	import { buildSelectivePatch } from './patchExport.ts';

	import Header from '$lib/Header.svelte';
	import Settings, { defaultSettings } from './Settings.svelte';
	import Button from './Button.svelte';
	import LongpressButton from './LongpressButton.svelte';
	import Toast, { toast } from './Toast.svelte';
	import Scenario from '$lib/vn/Scenario.svelte';
	import ImportDialog from './ImportDialog.svelte';
	import SubmitDialog from './SubmitDialog.svelte';
	import ConfirmationDialog from '$lib/ConfirmationDialog.svelte';
	import Title from './Title.svelte';
	import Cover from './Cover.svelte';
	import { processCoverImage, type ProcessedCover } from './coverImage.ts';
	import { pushState, type ContentState } from './History.svelte';
	import { type BGMSession, refreshSession } from '$lib/bangumiSession';
	import { importPersonCreated, importRelaHistory, importPersonBatch } from './relaDB.ts';
	import { getUserNickname } from '$lib/client.ts';
	import { getRandomTip } from './dailyTips.ts';
	import {
		type Release as InfoRelease,
		writeTrackInfo,
		fromFormalRelease
	} from './trackInfoWriter.ts';
	import { localStorage$state } from './utils.svelte.ts';

	const associableFields = new Set(Object.values(Role).slice(1));
	const reactiveFields = new Set([...associableFields, '碟片数量']);

	let currentRawRelease: Readonly<RawRelease> = $state.raw({ credits: [], discs: [] });
	let currentRelease: Readonly<Release> = $state.raw(new Release());
	let dupResolution = $state(new SvelteMap<string, number>());
	let dupResolutionEntries = $derived(Array.from(dupResolution.entries()));
	// Creators whose bgm relation was manually removed (clicked away in the Gallery).
	// They are excluded from the resolved name2staff, so they no longer produce
	// submit data / patch entries, while their names stay in the infobox text.
	let removedRela = $state(new SvelteSet<string>());
	let filteredRelaMap = $derived(
		new Map(Array.from(currentRelease.relaMap.entries()).filter(([name]) => !removedRela.has(name)))
	);
	let name2staff = $derived(resolveRelaMap(filteredRelaMap, dupResolutionEntries));
	// Locate command sent to the track-info editor when a track title is clicked
	// in the preview. `seq` bumps so repeated clicks on the same line re-trigger.
	let trackLocate = $state<{ line: number; seq: number } | null>(null);
	function onTrackClick(disc: number, track: number) {
		const tr = currentRelease.tracks[disc]?.[track];
		if (!tr?.line) return;
		trackLocate = { line: tr.line, seq: (trackLocate?.seq ?? 0) + 1 };
	}
	// Display names of the custom roles currently synced into the infobox.
	// Used so that deleting / renaming a custom role only removes its own row
	// from the infobox while preserving every other (manually added) field.
	let syncedCustomRows = $state(new Set<string>());

	function clear() {
		pushState(
			$state.snapshot({
				sid: sidState.val,
				title: titleState.val,
				metaTags: metaTagsState.val,
				infoBox: infoBox.exportText(),
				trackInfo: trackInfoState.val,
				desc: descState.val
			})
		);
		setState();
		coverState = null;
		dupResolution.clear();
		removedRela.clear();
		setTimeout(() => {
			toast(`<b>嗯……？</b><br/>${getRandomTip()}`, { duration: 8000 });
		}, 400);
	}
	// `includeCover` 只有「极速打包带走」会传 true：普通打包与二连击是给已有条目
	// 编辑用的，不需要几 MB 的封面 base64 挤进剪贴板。
	function marshal(includeCover = true) {
		infoBox.storeRecentCombo(metaTagsState.val, metaTagsRecentCombosState);
		const trackList = currentRelease.tracks.map((disc) => disc.map((tr) => tr.title).join('\n'));
		const trackTable = currentRelease.tracks
			.flatMap((disc, i) => disc.map((tr, j) => `${i + 1}|${j + 1}|${tr.title}|${tr.comment}|`))
			.join('\n');
		const relaTable = currentRelease
			.intoCreatorSummary(name2staff)
			.map(([bid, rt]) => {
				// filted custom role from relaTable
				const filteredRt = rt.filter(([r]) => !r.startsWith('custom-'));
				if (filteredRt.length === 0) return null;
				return `https://bgm.tv/person/${bid}  ${filteredRt.map(([r, pn]) => (pn ? `${r}#${pn}` : r)).join('  ')}`;
			})
			.filter(line => line !== null)
			.join('\n');
		return {
			sid: sidState.val,
			title: titleState.val,
			infoBox: infoBox.exportText(),
			description: descState.val,
			metaTags: metaTagsState.val,
			trackList: trackList.length > 1 ? trackList : trackList[0],
			trackTable,
			relaTable,
			...(includeCover && coverState ? { cover: coverState.dataUrl } : {})
		};
	}
	async function pack() {
		// Snapshot the modifier-driven intent up front: the clipboard write is
		// awaited and the user may release the keys before it resolves.
		const relaOnly = shouldPackRelaOnly;
		const fastPack = shouldFastPack;
		const thenOpen = shouldPackThenOpen;
		// 只有「极速打包带走」带封面；普通打包与二连击不带，免得几 MB 的
		// 封面 base64 白占剪贴板（它们对应的是编辑已有条目的流程）。
		const data: Record<string, unknown> = marshal(fastPack);
		if (relaOnly) {
			await navigator.clipboard.writeText(data.relaTable as string);
		} else {
			// Ported from the userscript's `patchExportedJsonString`: attach the
			// computed patch + policy so the clipboard JSON can be applied directly.
			const useFullPatch = settingsState.val.defaultFullPatch;
			const { patchText, patchContent } = buildSelectivePatch(
				currentRelease,
				name2staff,
				useFullPatch,
				removedRela
			);
			if (patchText) {
				data.patch = patchText;
				data.patchPolicy = useFullPatch ? 'full' : 'selective';
				// 结构化 content：站内脚本可以直接把它提交给 repo，不必再解析 patch 文本。
				// patch / patchPolicy 依旧保留，方便回退与后续修改。
				// 新条目的 sid 是 0，这时不带 subjectId，交给站内脚本按实际条目补上。
				data.patch_content = { ...patchContent, subjectId: sidState.val || undefined };
			} else {
				data.patch = '';
				data.patchPolicy = 'none';
			}
			await navigator.clipboard.writeText(JSON.stringify(data));
		}
		toast('已复制到剪贴板');
		if (fastPack) {
			// "极速打包带走" (Ctrl+Shift): open the new-subject page right away
			// instead of taking the 700ms two-hit-combo pause.
			window.open('https://bgm.tv/new_subject/3');
		} else if (thenOpen) {
			setTimeout(() => window.open('https://bgm.tv/new_subject/3'), 700);
		}
	}
	// Copy a selective (or full, with Shift) patch generated from the current
	// Release, ported from the "Staff Tag Fix" userscript.
	async function copyPatch() {
		const { patchText } = buildSelectivePatch(currentRelease, name2staff, useShiftOnCopy, removedRela);
		if (!patchText) {
			toast('当前没有符合条件的 Patch', { alert: true });
			return;
		}
		await navigator.clipboard.writeText(patchText);
		toast(useShiftOnCopy ? '已复制全部 Patch' : '已复制 Patch 到剪贴板');
	}
	function setState(
		s: ContentState = {
			sid: 0,
			title: '',
			metaTags: '',
			infoBox: settingsState.val.newInfoBox,
			trackInfo: '',
			desc: ''
		}
	) {
		sidState.val = s.sid;
		titleState.val = s.title;
		// For a brand-new entry (no metaTags given), carry over the global default tags
		// configured in Settings so you don't have to re-pick them every time.
		metaTagsState.val = s.metaTags || settingsState.val.metaTags || '';
		trackInfoState.val = s.trackInfo;
		setTimeout(() => {
			// workaround: clear infobox after the infobox edit triggered by trackinfo clear
			infoBox.reset(s.infoBox);
		}, 10);
		descState.val = s.desc;
	}

	async function onUpdate(release: RawRelease) {
		currentRawRelease = release;
	}
	$effect(() => {
		// Update currentRelease (for Preview) whenever currentRawRelease or settingsState changes
		Release.fromRawRelease(currentRawRelease, settingsState.val).then((release) => {
			currentRelease = release;
		});
	});
	$effect(() => {
		// Update infoBoxState whenever currentRelease or dupResolution changes
		const summary: [string, string][] = currentRelease
			.intoRoleSummary(name2staff)
			.map(([roleID, creators]) => [roleID, creators.join('、')]);
		const nDiscs = currentRelease.tracks.length;
		if (nDiscs > 1) summary.push(['碟片数量', nDiscs.toString()]);
		const customNames = new Set(
			Object.keys(currentRelease.credits)
				.filter((r) => r.startsWith('custom-'))
				.map((r) => r.slice(7))
		);
		const previousCustomRows = untrack(() => syncedCustomRows);
		untrack(() => {
			infoBox.edit(summary, reactiveFields, previousCustomRows);
			syncedCustomRows = customNames;
		});
	});

	let settingsState = localStorage$state('settings', defaultSettings);
	let sidState = localStorage$state('sid', 0);
	let titleState = localStorage$state('title', '');
	let metaTagsState = localStorage$state('metaTags', '');
	// Shared "recently used tag combos" store, keyed by subject type.
	// Used by both the in-infobox MetaTag and the global one in Settings.
	let metaTagsRecentCombosState = localStorage$state(
		'metaTagsRecentCombos',
		{} as Record<string, string[][]>
	);
	let infoBoxState = localStorage$state(
		'infoBox',
		infoBox.toArrayWikiString(settingsState.val.newInfoBox)
	);
	let descState = localStorage$state('desc', '');
	let trackInfoState = localStorage$state('trackInfo', '');
	// Cover image for the entry being packed. Kept in memory only (it can be
	// several MB) and reset by "再来一张", so it never leaks into the next entry.
	let coverState = $state<ProcessedCover | null>(null);
	let session = localStorage$state<BGMSession>(
		'wiki-write-session',
		{ token: '', expiresAt: 0 },
		{ watch: true }
	);
	onMount(() => {
		infoBox.init(infoBoxState.val);
	});

	let showSettings = $state(false);
	let showRelaDB = $state(false);
	let showImportDialog = $state(false);
	let showSubmitDialog = $state(false);
	let showTour = $state(settingsState.val.bgmUID === '');

	let optMode = $state(false);
	let shiftMode = $state(false);
	let ctrlMode = $state(false);
	let hoverPackBtn = $state(false);
	let hoverCopyPatchBtn = $state(false);
	let shouldPackRelaOnly = $derived(hoverPackBtn && optMode);
	// "极速打包带走" (Ctrl+Shift while hovering the pack button): copy the full
	// payload and open the new-subject page immediately, without the 700ms wait.
	let shouldFastPack = $derived(hoverPackBtn && ctrlMode && shiftMode && !shouldPackRelaOnly);
	// "仅复制关联" must stay true to its label: never open the new-subject
	// page when the pack copies only the relation table.
	let shouldPackThenOpen = $derived(
		!shouldPackRelaOnly &&
			(hoverPackBtn && shiftMode) !== settingsState.val.defaultOpenBGMNewAfterPack
	);
	// Like the pack button, Shift only takes effect once the mouse is over
	// the "复制 Patch" button (hover), not from the bare key press alone.
	let useShiftOnCopy = $derived(hoverCopyPatchBtn && shiftMode);

	// Re-derive the modifier state from a live event instead of toggling it on
	// individual keyup/keydown. A swallowed keyup (Alt+Tab, IME input-mode
	// switch, window blur) used to leave the state stuck on, so merely
	// hovering the pack button wrongly showed "仅复制关联".
	function syncModifiers(e: KeyboardEvent | MouseEvent) {
		optMode = e.altKey;
		shiftMode = e.shiftKey;
		ctrlMode = e.ctrlKey || e.metaKey;
	}

	const editor = {
		associableFields,
		editTitleIntro: (title: string, intro: string) => {
			if (title) titleState.val = title;
			if (intro) descState.val = intro;
		},
		setTrackInfo: (info: InfoRelease, style: 'parts' | 'tracks' | 'default' = 'default') => {
			trackInfoState.val = writeTrackInfo(info, style);
		},
		setTrackInfoText: (text: string) => {
			trackInfoState.val = text;
		},
		setInfoBox: (content: string, override: boolean) => {
			if (override) {
				infoBox.reset(content);
				infoBox.merge('');
			} else {
				infoBox.merge(content);
			}
		},
		setInfoBoxField: (
			key: string,
			value: string | [string, string][],
			{ editOnly = false } = {}
		): boolean => {
			return infoBox.editField(key, value, { editOnly });
		},
		unlinkInfoBoxField: (key: string) => {
			infoBox.unlinkField(key);
		},
		setMetaTags: (tags: string[]) => {
			metaTagsState.val = tags.join(' ');
		},
		setCover: async (url: string) => {
			const res = await fetch(url, { mode: 'cors' });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const blob = await res.blob();
			if (!blob.type.startsWith('image/')) throw new Error('下载到的不是图片');
			const name = url.split('?')[0].split('/').pop() || 'cover';
			coverState = await processCoverImage(new File([blob], name, { type: blob.type }));
		},
		importRela: (pids: number[]) => {
			importPersonBatch(pids).then(() => {
				settingsState.val = { ...settingsState.val }; // trigger Gallery update
			});
		},
		setSID: (sid: number) => {
			sidState.val = sid;
		},
		pushWarning: (warning: string) => {
			toast(warning, { alert: true });
		},
		done: () => {
			showImportDialog = false;
		}
	};
</script>

<head>
	<title>EXEC_WIKI=BGM/.</title>
</head>

<svelte:window
	onblur={() => {
		// Alt+Tab and focusing the browser menu bar swallow keyup events;
		// clear the latched modifiers so they can't linger with no key held.
		optMode = false;
		shiftMode = false;
		ctrlMode = false;
	}}
/>
<svelte:body
	onkeydown={(e: KeyboardEvent) => {
		syncModifiers(e);
		if (e.key === 'p' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
			showSubmitDialog = true;
			(async () => {
				session.val = await refreshSession(session.val);
			})();
		}
	}}
	onkeyup={syncModifiers}
/>
<Header edgefade>
	<Gallery
		relaMap={currentRelease.relaMap}
		bind:dupResolution
		bind:removedRela
		bind:showRelaDB
		class="h-35"
	/>
</Header>
<main class="w-310 max-w-[95vw] lt-lg:w-200 lt-md:w-150 mx-auto my-4">
	<div class="flex flex-justify-between gap-5">
		<LongpressButton class="w-33 text-lg" onclick={clear}>长按<wbr />再来一张</LongpressButton>
		<Button class="w-20 text-lg" onclick={async () => (showImportDialog = true)}>导入…</Button>
		<div class="flex-grow-1 h-[1rem] mx-3 p-2"></div>
		<Button
			class="w-31 text-lg"
			onclick={copyPatch}
			onmouseenter={(e: MouseEvent) => {
				hoverCopyPatchBtn = true;
				syncModifiers(e);
			}}
			onmousemove={syncModifiers}
			onmouseleave={() => (hoverCopyPatchBtn = false)}
			title={useShiftOnCopy ? '复制全部 Patch 到剪贴板' : '只复制符合条件的 Patch 到剪贴板'}
		>
			{useShiftOnCopy ? '复制全部 Patch' : '复制 Patch'}
		</Button>
		<Cover bind:value={coverState} />
		<Button
			class="{!shouldPackRelaOnly && (shouldPackThenOpen || shouldFastPack) ? '' : 'w-31'} text-lg"
			onclick={pack}
			onmouseenter={(e: MouseEvent) => {
				hoverPackBtn = true;
				syncModifiers(e);
			}}
			onmousemove={syncModifiers}
			onmouseleave={() => (hoverPackBtn = false)}
		>
			{@html shouldPackRelaOnly
				? '仅复制<wbr/>关联'
				: shouldFastPack
					? '极速打包<wbr/>带走'
					: shouldPackThenOpen
						? '打包带走<wbr/>添加新音乐<wbr/>二连击'
						: '打包<wbr/>带走！'}
		</Button>
	</div>
	<div class="flex flex-wrap flex-justify-between h-66vh">
		<TrackInfo
			bind:value={trackInfoState.val}
			{onUpdate}
			writeTrackInfoFromRelease={(style: 'parts' | 'tracks') =>
				writeTrackInfo(fromFormalRelease(currentRelease), style)}
			locateCommand={trackLocate}
			class="flex-basis-[38%] flex-grow-4 h-full"
		/>
		<div
			class="flex-basis-[24%] flex-grow-3 h-full min-h-[30.5rem] mt-[0.8rem] flex flex-col flex-justify-between gap-row-xs"
		>
			<Title bind:value={titleState.val} {setState} {editor} class="flex-basis-[1rem]" />
			<InfoBox
				bind:value={infoBoxState.val}
				bind:valueMetaTags={metaTagsState.val}
				{reactiveFields}
				{metaTagsRecentCombosState}
				class="flex-basis-[67%] flex-grow-3"
			/>
			<textarea
				bind:value={descState.val}
				placeholder="简介"
				spellcheck="false"
				class="input-bgm text-sm w-[94%] flex-basis-[18%] flex-grow-2 p-[0.5rem]"
			></textarea>
		</div>
		<Preview
			release={currentRelease}
			{name2staff}
			onTrackClick={onTrackClick}
			class="flex-basis-[28%] flex-grow-4 h-full min-h-[30.5rem] overflow-auto"
		/>
	</div>
	<Settings
		bind:settings={settingsState.val}
		bind:showSettings
		bind:showRelaDB
		{metaTagsRecentCombosState}
	/>
	<Toast />
	<Scenario
		bind:show={showTour}
		fn={{
			toSettings: () => {
				setTimeout(() => (showSettings = true), 450);
				setTimeout(() => {
					document.getElementById('settings-import-backup')?.scrollIntoView({ behavior: 'smooth' });
				}, 600);
				setTimeout(() => toast('请导入你的配置备份文件'), 1200);
			},
			trySetBGMUID: async (url: string): Promise<string> => {
				const match = url.match(/bgm\.tv\/user\/(.+)/);
				const uid = match ? match[1] : '';
				if (!uid) {
					toast('唔……我看不太明白呢？你的链接大概应该长这样：https://bgm.tv/user/sai', {
						alert: true
					});
					return '';
				}
				settingsState.val = { ...settingsState.val, bgmUID: uid };
				return await getUserNickname(uid);
			},
			startImport: () => {
				Promise.allSettled([
					importPersonCreated(settingsState.val.bgmUID, 10),
					importRelaHistory(settingsState.val.bgmUID, 10)
				]).then(() => {
					toast('导入完成！记得常备份你的关联库哦～');
				});
			},
			exit: () => {
				showTour = false;
			}
		}}
	/>
	<ImportDialog bind:show={showImportDialog} {editor} />
	<SubmitDialog
		bind:show={showSubmitDialog}
		getSubjectData={marshal}
		getTrackData={() => [
			fromFormalRelease(currentRelease, name2staff),
			currentRelease
				.intoCreatorSummary(name2staff)
				.flatMap(([bid, rt]) => rt.map(([r, pn]) => ({ id: bid, relation: r, eps: pn })))
		]}
		session={session.val}
	/>
	<ConfirmationDialog />
</main>
