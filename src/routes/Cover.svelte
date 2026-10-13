<script lang="ts">
	import { onMount } from 'svelte';
	import { tooltip } from '$lib/Tooltip.svelte';
	import { ctrlOrCmd } from '$lib/utils';
	import { toast } from './Toast.svelte';
	import { formatBytes, processCoverImage, type ProcessedCover } from './coverImage.ts';

	interface CoverProps {
		value?: ProcessedCover | null;
	}
	let { value = $bindable(null) }: CoverProps = $props();

	let processing = $state(false);
	let draggingOver = $state(false);
	let fileInput: HTMLInputElement | undefined;

	function pickFile() {
		if (processing) return;
		fileInput?.click();
	}

	async function acceptFile(file: File | null | undefined) {
		if (!file || processing) return;
		if (file.type && !file.type.startsWith('image/')) {
			toast('请选择图片文件', { alert: true });
			return;
		}
		processing = true;
		try {
			const result = await processCoverImage(file);
			value = result;
			toast(
				result.compressed
					? `封面已压缩：${formatBytes(result.originalSize)} → ${formatBytes(result.finalSize)}`
					: `封面已就绪：${formatBytes(result.finalSize)}`
			);
		} catch (err) {
			toast(`封面处理失败：${err instanceof Error ? err.message : err}`, { alert: true });
		} finally {
			processing = false;
		}
	}

	// Ctrl+V anywhere on the page sets the cover, unless focus is inside an
	// editor (there the paste belongs to the field itself).
	function onPaste(e: ClipboardEvent) {
		if (processing) return;
		const active = document.activeElement as HTMLElement | null;
		if (
			active &&
			(active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
		) {
			return;
		}
		const items = e.clipboardData?.items;
		if (!items) return;
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (!item.type.startsWith('image/')) continue;
			const file = item.getAsFile();
			if (file) {
				e.preventDefault();
				acceptFile(file);
			}
			return;
		}
	}

	onMount(() => {
		document.addEventListener('paste', onPaste);
		return () => document.removeEventListener('paste', onPaste);
	});

	const escapeHtml = (s: string) =>
		s.replace(
			/[&<>"']/g,
			(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
		);

	const tooltipHtml = $derived.by(() => {
		if (processing) return '正在处理封面图片…';
		if (!value) {
			return `点击选择封面图片<br>也可以直接粘贴（${ctrlOrCmd}+V）或拖入图片`;
		}
		const note = value.compressed
			? `已压缩：${formatBytes(value.originalSize)} → ${formatBytes(value.finalSize)}`
			: '未压缩';
		return (
			`<img src="${value.dataUrl}" alt="" style="display:block;width:220px;border-radius:0.5rem;background:#f8f8f8">` +
			`<div style="margin-top:0.5rem;font-size:0.8em;line-height:1.6;color:#666">` +
			`${escapeHtml(value.name)} · ${formatBytes(value.finalSize)}<br>${note}</div>`
		);
	});
</script>

<div class="relative flex items-center group">
	<input
		bind:this={fileInput}
		type="file"
		accept="image/*"
		class="hidden"
		onchange={(e) => {
			const input = e.currentTarget;
			const file = input.files?.[0] ?? null;
			input.value = '';
			acceptFile(file);
		}}
	/>
	<button
		type="button"
		class="h-9 w-9 p-0 border-0 rounded-md bg-bgm-lightgrey drop-shadow-md hover:drop-shadow-sm transition-drop-shadow duration-250 cursor-pointer flex items-center justify-center overflow-hidden {draggingOver
			? 'outline outline-2 outline-bgm-pink'
			: ''}"
		onclick={pickFile}
		ondragover={(e) => {
			e.preventDefault();
			draggingOver = true;
		}}
		ondragleave={(e) => {
			if (!e.currentTarget.contains(e.relatedTarget as Node | null)) draggingOver = false;
		}}
		ondrop={(e) => {
			e.preventDefault();
			draggingOver = false;
			acceptFile(e.dataTransfer?.files?.[0]);
		}}
		use:tooltip={{ title: tooltipHtml, safeHTML: true, attachment: 'bottom' }}
	>
		{#if processing}
			<img src="/loading.gif" class="w-4 opacity-60" alt="处理中" />
		{:else if value}
			<img src={value.dataUrl} class="h-full w-full object-cover" alt="封面" />
		{:else}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="text-bgm-grey"
			>
				<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
				<circle cx="8.5" cy="8.5" r="1.5"></circle>
				<polyline points="21 15 16 10 5 21"></polyline>
			</svg>
		{/if}
	</button>
	{#if value && !processing}
		<button
			type="button"
			class="absolute -top-1.5 -right-1.5 hidden group-hover:flex h-4 w-4 p-0 border-0 rounded-full bg-bgm-pink text-white text-[10px] leading-none items-center justify-center cursor-pointer"
			onclick={() => (value = null)}
			aria-label="移除封面"
		>
			×
		</button>
	{/if}
</div>
