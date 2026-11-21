<script lang="ts">
	import Dialog from '$lib/Dialog.svelte';
	import type { AutoEditor } from '$lib/importSource';
	import { parseTrackList, mergeTrackList } from '$lib/importSource/tracklist';
	import { discSecondsOf, applyDurationField } from '$lib/importSource/common';
	import type { Release as FormalRelease } from './postprocess';
	import { fromFormalRelease } from './trackInfoWriter';
	import Button from './Button.svelte';
	import CodeMirror from './CodeMirror.svelte';

	interface Props {
		editor: AutoEditor;
		currentRelease: Readonly<FormalRelease>;
	}
	let { editor, currentRelease }: Props = $props();

	let show = $state(false);
	let text = $state('');
	let artistFirst = $state(false);

	const lineCount = $derived(text.split(/\r?\n/).filter((l) => l.trim()).length);
	const hint =
		'把曲目表粘贴到这里，例如：\n01 Defectus(Intro) 1:39\n02 曲目名 3:05';

	function filterPaste(value: string) {
		return value.replace(/\s+$/g, '').normalize('NFC');
	}

	async function fill() {
		try {
			const incoming = parseTrackList(text, { artistFirst });
			const existing = fromFormalRelease(currentRelease);
			const hasExisting = existing.discs.some((disc) => disc.tracks.length > 0);
			const merged = hasExisting ? mergeTrackList(existing, incoming) : incoming;
			editor.setTrackInfo(merged, 'import');

			// 逐碟判断：只补了部分碟的曲目表也能把该碟的时长写进 Infobox
			const discSeconds = discSecondsOf(merged.discs);
			const total = discSeconds.reduce<number>((sum, s) => sum + (s ?? 0), 0);
			applyDurationField(editor, discSeconds, total);

			show = false;
		} catch (e) {
			editor.pushWarning(`曲目表解析失败：${e instanceof Error ? e.message : String(e)}`);
		}
	}
</script>

<Button class="text-lg whitespace-nowrap" onclick={async () => { show = true; }}>曲目表识别</Button>

<Dialog bind:show class="w-140 max-w-[92vw]">
	<header class="flex items-baseline justify-between gap-3">
		<h2 class="text-bgm-pink m-0">粘贴曲目表</h2>
		<span class="text-xs color-bgm-grey whitespace-nowrap">已有内容会按标题合并</span>
	</header>

	<div class="mt-3 px-3.5 py-3 rounded-md bg-bgm-lightgrey border border-solid border-[#ECECEC]">
		<div class="text-xs color-bgm-darkgrey font-medium mb-2">支持的格式</div>
		<dl class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 m-0 text-xs">
			<dt class="color-bgm-grey whitespace-nowrap m-0">序号线</dt>
			<dd class="m-0 min-w-0"><code class="fmt">1. 曲目名 - 艺术家 (01:38)</code></dd>
			<dt class="color-bgm-grey whitespace-nowrap m-0">空格分隔</dt>
			<dd class="m-0 min-w-0"><code class="fmt">01 曲目名 1:39</code></dd>
			<dt class="color-bgm-grey whitespace-nowrap m-0">制表符分隔</dt>
			<dd class="m-0 min-w-0"><code class="fmt">01 &lt;TAB&gt; 曲目名 &lt;TAB&gt; 1:39</code></dd>
			<dt class="color-bgm-grey whitespace-nowrap m-0">管道表格</dt>
			<dd class="m-0 min-w-0"><code class="fmt">光盘|曲目|原文标题|简体中文标题|时长</code></dd>
			<dt class="color-bgm-grey whitespace-nowrap m-0">Bandcamp</dt>
			<dd class="m-0 min-w-0">
				<code class="fmt fmt-block">1.<br />艺术家 - 曲目名 02:50</code>
			</dd>
		</dl>
		<p class="mt-2.5 mb-0 text-xs color-bgm-grey leading-relaxed">
			已有曲目时只补时长与空字段，不删改其他曲目；编辑器为空时作为新建。<br />
			Bandcamp 的两行格式固定按「艺术家 - 曲目名」识别，与下方的顺序选项无关。
		</p>
	</div>

	<div class="mt-3 h-60">
		<CodeMirror
			class="text-sm h-full"
			styles={{
				'&': { height: '100%', border: '1px solid lightgray', borderRadius: '0.25rem' },
				'&.cm-focused': { outline: 'none' }
			}}
			placeholder={hint}
			lineWrapping
			{filterPaste}
			bind:value={text}
		/>
		<div class="flex items-center justify-between gap-2 mt-1.5 text-xs color-bgm-grey">
			<span>{lineCount} 行</span>
			<button
				type="button"
				class="px-2 py-0.5 border-0 rounded bg-transparent color-bgm-grey cursor-pointer hover:color-[#434c5e] hover:bg-bgm-lightgrey transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
				disabled={!text}
				onclick={() => { text = ''; }}
			>
				清空
			</button>
		</div>
	</div>

	<div class="flex items-center justify-between gap-3 mt-3">
		<div class="inline-flex p-0.5 rounded-md bg-bgm-lightgrey text-xs">
			<label
				class="px-2.5 py-1 rounded cursor-pointer transition-all focus-within:ring-2 focus-within:ring-bgm-pink/30 {!artistFirst
					? 'bg-white color-[#434c5e] shadow-sm'
					: 'color-bgm-grey hover:color-[#434c5e]'}"
			>
				<input class="sr-only" type="radio" bind:group={artistFirst} value={false} />曲目名在前
			</label>
			<label
				class="px-2.5 py-1 rounded cursor-pointer transition-all focus-within:ring-2 focus-within:ring-bgm-pink/30 {artistFirst
					? 'bg-white color-[#434c5e] shadow-sm'
					: 'color-bgm-grey hover:color-[#434c5e]'}"
			>
				<input class="sr-only" type="radio" bind:group={artistFirst} value={true} />艺术家在前
			</label>
		</div>
		<div class="flex gap-2">
			<Button onclick={async () => { show = false; }}>取消</Button>
			<Button onclick={fill}>填入</Button>
		</div>
	</div>
</Dialog>

<style>
	.fmt {
		display: inline-block;
		max-width: 100%;
		padding: 0.1rem 0.4rem;
		border: 1px solid #e6e6e6;
		border-radius: 4px;
		background: #fff;
		color: #434c5e;
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.72rem;
		line-height: 1.5;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		vertical-align: middle;
	}

	.fmt-block {
		white-space: normal;
	}
</style>
