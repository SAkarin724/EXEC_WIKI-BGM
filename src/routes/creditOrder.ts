/**
 * 记录 credit 行里的成员顺序。
 *
 * `Release.credits` 是跨曲目合并后的全局对象：同一个名字只在第一次出现的位置插入。
 * 每首曲目的 Preview / trackCredits 需要的是「该曲目自己的填写顺序」，
 * 所以在解析时把每首曲目的 `(roleID, name)` 顺序记下来，渲染前按它稳定排序。
 */

export interface CreditRef {
	roleID: string;
	name: string;
}

/** trackKey（`disc.track`，均从 1 开始）-> 该曲目 credit 行的顺序 */
export type TrackCreatorOrder = Map<string, CreditRef[]>;

/**
 * 按 `refs` 里首次出现的顺序稳定排序。
 * `refs` 里没有的名字保持原相对顺序，排在已出现名字之后
 * （例如 autofill 补出来的编曲者）。
 */
export function sortByCreditOrder<T>(
	items: readonly T[],
	getName: (item: T) => string,
	refs: readonly CreditRef[] | undefined
): T[] {
	if (items.length < 2 || !refs?.length) return [...items];

	const rank = new Map<string, number>();
	refs.forEach((ref, index) => {
		if (!rank.has(ref.name)) rank.set(ref.name, index);
	});

	return items
		.map((item, index) => ({
			item,
			index,
			rank: rank.get(getName(item)) ?? Number.MAX_SAFE_INTEGER
		}))
		.sort((a, b) => a.rank - b.rank || a.index - b.index)
		.map((entry) => entry.item);
}
