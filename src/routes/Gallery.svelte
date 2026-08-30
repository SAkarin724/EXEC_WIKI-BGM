<script lang="ts">
	import { slide } from 'svelte/transition';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { type Staff } from '$lib/db';
	import { resolveRelaMap, Match } from './disambiguation';
	import { tooltip } from '$lib/Tooltip.svelte';

	interface GalleryProps {
		relaMap: Map<string, Staff[]>;
		dupResolution: SvelteMap<string, number>;
		removedRela: SvelteSet<string>;
		showRelaDB: boolean;
		class?: string;
	}
	let {
		relaMap,
		dupResolution = $bindable(),
		removedRela = $bindable(),
		showRelaDB = $bindable(),
		class: class_ = ''
	}: GalleryProps = $props();
	let name2staff = $derived(resolveRelaMap(relaMap, Array.from(dupResolution.entries())));

	let relaEntries = $derived(
		Array.from(relaMap.keys()).map((name) => {
			if (removedRela.has(name)) {
				const firstCodepoint = name[Symbol.iterator]().next().value ?? '';
				return { name, m: 'removed', pfp: placeHolderSVG(firstCodepoint) };
			}
			const [staff, m] = name2staff.get(name)!;
			if (m === Match.None) {
				const firstCodepoint = name[Symbol.iterator]().next().value ?? '';
				return { name, m, pfp: placeHolderSVG(firstCodepoint) };
			} else if (m === Match.Conflict) {
				return { name, m, pfp: ambiguitySVG };
			}
			return { name, m, pfp: staff.pfp || 'https://lain.bgm.tv/img/no_icon_subject.png' };
		})
	);

	function placeHolderSVG(text: string): string {
		return (
			'data:image/svg+xml;utf8,' +
			encodeURIComponent(`
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
				<rect x="0.5" y="0.5" width="23" height="23" rx="5"></rect>
				<text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-size="13" fill="#555">${text}</text>
			</svg>`)
		);
	}
	const ambiguitySVG =
		'data:image/svg+xml;utf8,' +
		encodeURIComponent(`
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
			<rect x="0.5" y="0.5" width="23" height="23" rx="5"></rect>
			<path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"></path>
			<circle cx="9.5" cy="8.5" r="4"></circle>
			<line x1="19" y1="8" x2="19" y2="14"></line>
			<line x1="22" y1="11" x2="16" y2="11"></line>
		</svg>`);

	async function callSearch(name: string) {
		showRelaDB = true;
		await sleep(100);
		(document.getElementById('search-bgm') as HTMLInputElement).value = name;
		(document.getElementById('search-bgm-btn') as HTMLButtonElement).click();
	}
	async function sleep(ms: number) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	let currentDisambiguation: string | undefined = $state();
	let menuTop = $state(0);
	let menuRight = $state(0);
</script>

<div
	class="{class_} w-full flex flex-col flex-wrap-reverse flex-justify-start flex-content-start overflow-auto pl-5"
	style="scrollbar-width: thin;"
>
	{#each relaEntries as { name, m, pfp } (name)}
		{@const title =
			m === 'removed'
				? `「${name}」，已去除关联`
				: m === Match.None
					? `搜索「${name}」`
					: m !== Match.OK
						? `「${name}」，有重名`
						: name}
		<div class="static">
			<button
				aria-label={title}
				class={'p-0 border-none bg-transparent text-size-base ' +
					(m === Match.None
						? 'cursor-copy'
						: m !== Match.OK
							? 'cursor-context-menu'
							: 'cursor-pointer')}
				onclick={m === Match.None
					? () => callSearch(name)
					: (ev) => {
							currentDisambiguation = currentDisambiguation === name ? undefined : name;
							const pos = (ev.target as HTMLElement).getBoundingClientRect();
							menuTop = pos.bottom + 5;
							menuRight = window.innerWidth - pos.right - 7;
						}}
			>
				<img
					src={pfp}
					alt={name}
					use:tooltip={{ attachment: 'bottom', title }}
					class={'execwb-prevent-click-outside rounded-xl w-13 h-13 mx-1.2 my-0.8 object-cover ' +
						(m !== Match.OK && m !== 'removed' ? 'drop-shadow-color-bgm-pink ' : ' ') +
						(m === Match.Conflict || m === Match.ConflictResolved
							? 'drop-shadow-md'
							: 'drop-shadow-sm')}
				/>
			</button>
			<!-- 关联菜单：去除关联（上方） / 选择人物 -->
			{#if currentDisambiguation === name}
				<div
					class="absolute z-1 bg-faint-orangish/75 rounded-lg backdrop-blur-md shadow-lg"
					transition:slide={{ duration: 200 }}
					style="top: {menuTop}px; right: {menuRight}px;"
				>
					{#if m !== 'removed'}
						<div class="p-2 border-b border-[#ffffff66]">
							<button
								class="w-full text-center border-none bg-transparent cursor-pointer text-sm text-red-600 hover:text-red-800 px-3 py-1"
								onclick={() => {
									removedRela.add(name);
									currentDisambiguation = undefined;
								}}
							>
								去除关联
							</button>
						</div>
					{/if}
					{#each relaMap.get(name)! as staff, i}
						<div class="p-2">
							<div class="flex items-center flex-justify-end">
								<a
									href={`https://bgm.tv/person/${staff.id}`}
									target="_blank"
									rel="noopener"
									class="mx-2 text-sm">{staff.name}</a
								>
								<button
									aria-label={staff.name}
									class="p-0 border-none bg-transparent cursor-pointer"
									onclick={() => {
										removedRela.delete(name);
										dupResolution.set(name, i);
										currentDisambiguation = undefined;
									}}
								>
									<img
										src={staff.pfp || 'https://lain.bgm.tv/img/no_icon_subject.png'}
										alt={staff.name}
										class="rounded-xl w-13 h-13 object-cover"
									/>
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/each}
</div>
