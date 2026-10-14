/**
 * 角色曲的老写法：`中川かのん starring 東山奈央`。
 *
 * 语义上和 `中川かのん(CV.東山奈央)` 相同（A 是角色、B 是声优），但**显示形式不同**，
 * 不能当成 CV 形式写出去：只按写法原样处理，角色名绝不作为人物参与关联。
 *
 * 单独成模块的原因：`postprocess`（解析池 + 关联）与 `trackInfoWriter`（写出）
 * 都要用它，放在任何一边都会让两个模块互相 import。
 */

export const STARRING_WORD = 'starring';

/** `中川かのん starring 東山奈央` -> { character: '中川かのん', cv: '東山奈央' } */
export function splitStarringCredit(name: string): { character: string; cv: string } | null {
	const m = String(name || '').match(/^(.+?)\s+starring\s+(.+)$/i);
	if (!m) return null;

	const character = m[1].trim();
	const cv = m[2].trim();
	if (!character || !cv) return null;

	return { character, cv };
}

/**
 * 收集所有 `角色 starring 声优` 写法里的声优名。
 * 声优要像 `角色(CV.声优)` 那样建立关联，就得先进人物解析池；
 * 角色名不收集——它是角色，不进人物关联。
 */
export function starringCvNames(credits: Record<string, Record<string, unknown>>): string[] {
	const names: string[] = [];

	Object.values(credits).forEach((creators) => {
		Object.keys(creators).forEach((creator) => {
			const starring = splitStarringCredit(creator);
			if (starring) names.push(starring.cv);
		});
	});

	return names;
}
