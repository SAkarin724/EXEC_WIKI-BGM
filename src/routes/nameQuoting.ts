/**
 * 书名号引用（`《A & B》`）的名字登记处。
 *
 * 语法层：`《` / `》` 是独立 token，中间整段文本是一个 `creator` 节点
 * （见 tree-sitter-rkgk 的 `_quotable_creator_name`）。解析层
 * （`postprocess.parseSongCredit`）认出这对 token 后把名字登记到这里；
 * 连接词 / 角色曲那几层（`artistJoiner`、`starringCredit`）据此判定
 * 「这个名字是一个整体，不许再拆」。
 *
 * 语义与维基端 `isExplicitLiteralWrappedText`（《》里的内容固定为整体）、
 * 以及 docs「曲目名/人名里有关键字/分隔符 → 用书名号把曲目名/人名括起来」
 * 完全一致：括起来的是一个完整曲目名，或者是「因某些原因被错误分开、
 * 需要重新放回一块当作一个人」的名字。
 *
 * 单独成模块的原因：`artistJoiner` 与 `starringCredit` 都要读它，
 * 放在任何一边都会造成两者互相 import（starringCredit 已被 artistJoiner import）。
 *
 * 每次解析（`Release.fromRawRelease`）都会整体刷新，所以它始终对应当前
 * 编辑器里的内容——编辑器里不再写《》的名字会自然失效。
 */
let quotedNames = new Set<string>();

export function setQuotedCreatorNames(names: Iterable<string>): void {
	quotedNames = new Set(names);
}

/**
 * 开始一次解析：清空登记表。
 * `parseSongCredit` 是同步的、一次解析里的全部调用都在同一个 tick 内完成，
 * 所以在真正解析之前调用一次即可，不必担心中间被别的解析穿插。
 */
export function beginQuotedCreatorNames(): void {
	quotedNames = new Set();
}

/** 解析时登记一个被《》括起来的名字 */
export function markQuotedCreatorName(name: string): void {
	const text = String(name ?? '').trim();
	if (!text) return;

	quotedNames.add(text);
}

export function isQuotedCreatorName(name: string): boolean {
	return quotedNames.has(String(name ?? '').trim());
}
