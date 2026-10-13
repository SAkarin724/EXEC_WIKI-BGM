<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';

	// 长按触发时间，同时也是进度条填满的动画时长，两者必须一致
	const HOLD_DURATION = 550;

	interface ButtonProps extends HTMLButtonAttributes {
		class?: string;
		onclick: () => any;
		children: () => any;
	}
	let { class: class_ = '', onclick, children, ...rest }: ButtonProps = $props();
	let fill = $state(0);
	let duration = $state(HOLD_DURATION);
	let holdTimer: NodeJS.Timeout;

	function hold(event: MouseEvent) {
		event.preventDefault();
		fill = 1;
		duration = HOLD_DURATION;
		holdTimer = setTimeout(() => {
			fill = 0;
			duration = 250;
			onclick();
		}, HOLD_DURATION);
	}
	function release(event: MouseEvent) {
		event.preventDefault();
		fill = 0;
		duration = 250;
		clearTimeout(holdTimer);
	}
</script>

<button
	{...rest}
	class={class_ +
		' relative bg-bgm-lightgrey text-[#434c5e] px-2 py-1 drop-shadow-md hover:drop-shadow-sm transition-drop-shadow duration-250 border-0 rounded-md cursor-pointer'}
	onmousedown={hold}
	onmouseup={release}
	onmouseleave={release}
>
	<div
		class="absolute z--1 inset-0 bg-faint-skyish rounded-md transition-width transition-ease-out"
		style="width: {fill * 100}%; transition-duration: {duration}ms;"
	></div>
	{@render children()}
</button>
