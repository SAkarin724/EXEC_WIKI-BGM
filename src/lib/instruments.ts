/**
 * 乐器名与子职位识别（单一数据源）。
 *
 * 项目里乐器写法的语法是 `乐器-<乐器名>`（见 postprocess 的 PREFIXABLE_ROLES）。
 * 这里的表同时供三处使用：
 *
 * - `lang-rkgk.ts`：生成 `乐器-` 系列补全项（boost 仍被压到最低，不干扰职位搜索）；
 * - `lint-rkgk.ts`：判断被当成职位写出来的乐器名（`Guitar：某人` → 建议改成 `乐器`）；
 * - `importSource/netease.ts`：把歌词头里的乐器标签（`巴扬 Bayan`）自动识别成子职位。
 *
 * 英文/日文表原样迁自 lang-rkgk（那是站点既有的写法），中文表按语义逐条配对，
 * 另外收了几个只在中文语境里出现的专名（巴扬、巴拉莱卡琴…）。两表只做精确匹配，
 * 不做任何模糊/翻译推断：命中才写 `乐器-<名>`，命中不了就交给人在确认窗口里判断。
 */

/** 英文/日文名 → 规范中文名，顺序即 lang-rkgk 补全项的原有顺序 */
const INSTRUMENT_PAIRS: [string, string][] = [
    ["Guitar", "吉他"],
    ["Acoustic Guitar", "木吉他"],
    ["Electric Guitar", "电吉他"],
    ["Gut Guitar", "肠弦吉他"],
    ["Classical Guitar", "古典吉他"],
    ["Bass", "贝斯"],
    ["Electric Bass", "电贝斯"],
    ["Drums", "鼓"],
    ["Synthesizer", "合成器"],
    ["Keyboard", "键盘"],
    ["Piano", "钢琴"],
    ["Electric Piano", "电钢琴"],
    ["Organ", "风琴"],
    ["Hammond Organ", "哈蒙德风琴"],
    ["Celesta", "钢片琴"],
    ["Strings", "弦乐"],
    ["Violin", "小提琴"],
    ["Viola", "中提琴"],
    ["Cello", "大提琴"],
    ["Contrabass", "低音提琴"],
    ["Harp", "竖琴"],
    ["Flute", "长笛"],
    ["Piccolo", "短笛"],
    ["Oboe", "双簧管"],
    ["Clarinet", "单簧管"],
    ["Bassoon", "大管"],
    ["Saxophone", "萨克斯"],
    ["Recorder", "竖笛"],
    ["Brass", "铜管"],
    ["Trumpet", "小号"],
    ["Trombone", "长号"],
    ["French Horn", "圆号"],
    ["Tuba", "大号"],
    ["Accordion", "手风琴"],
    ["Harmonica", "口琴"],
    ["Ukulele", "尤克里里"],
    ["Mandolin", "曼陀林"],
    ["Banjo", "班卓琴"],
    ["Timpani", "定音鼓"],
    ["Vibraphone", "颤音琴"],
    ["Marimba", "马林巴"],
    ["Glockenspiel", "钟琴"],
    ["Xylophone", "木琴"],
    ["Percussion", "打击乐"],
    ["Taiko", "太鼓"],
    ["Congas", "康加鼓"],
    ["Bongos", "邦戈鼓"],
    ["Tambourine", "铃鼓"],
    ["Shaker", "沙锤"],
    ["Erhu", "二胡"],
    ["Guzheng", "古筝"],
    ["Pipa", "琵琶"],
    ["Guqin", "古琴"],
    ["Yangqin", "扬琴"],
    ["Ruan", "阮"],
    ["Dizi", "笛子"],
    ["Xiao", "箫"],
    ["Suona", "唢呐"],
    ["Sheng", "笙"],
    ["Hulusi", "葫芦丝"],
    ["Shamisen", "三味线"],
    ["Koto", "日本筝"],
    ["Shakuhachi", "尺八"],
    ["Taishogoto", "大正琴"],
    ["Sitar", "西塔琴"],
    ["Domra", "多姆拉琴"],
    ["Bass Guitar", "贝斯吉他"],
    ["ベースギター", "贝斯吉他"],
    ["Keyboards", "键盘"],
    ["キーボード", "键盘"],
    ["Bells", "铃"],
    ["ベル", "铃"],
    ["Other Instruments", "其他乐器"],
    ["その他の楽器", "其他乐器"],
    ["ドラム", "鼓"],
    ["シンセサイザー", "合成器"],
    ["ピアノ", "钢琴"],
    ["フルート", "长笛"],
    ["バイオリン", "小提琴"],
    ["ヴィオラ", "中提琴"],
    ["パーカッション", "打击乐"],
];

/**
 * 只在中文里出现、英文表里没有对应的乐器（网易云的原神一类专辑常见）。
 *
 * 各专辑对同类乐器的写法并不统一，写法不同也未必是同一个乐器（`竹笛` 与 `笛子`、
 * `排箫` 与 `箫` 都各算一个名字），所以这里一律按原词条目单列，不做合并或别名映射。
 */
const EXTRA_ZH_NAMES = [
    "巴扬",
    "巴拉莱卡琴",
    "管钟",
    "排箫",
    "陶笛",
    "卡林巴",
    "竹笛",
];

/** 英文/日文乐器名：子职位写作 `乐器-<原名>`（如 `乐器-Guitar`、`乐器-ピアノ`） */
export const INSTRUMENT_NAMES_EN: readonly string[] = INSTRUMENT_PAIRS.map(([en]) => en);

/** 中文乐器名：子职位写作 `乐器-<中文名>`（如 `乐器-巴扬`） */
export const INSTRUMENT_NAMES_ZH: readonly string[] = Array.from(
    new Set([...INSTRUMENT_PAIRS.map(([, zh]) => zh), ...EXTRA_ZH_NAMES])
);

/**
 * 中文别名 / 常见异写 → 规范中文乐器名。
 * 只收「明确指向同一个乐器」的写法，单字、泛指（弦乐、打击乐之类）不入表。
 */
export const INSTRUMENT_ALIAS_ZH: Record<string, string> = {
    巴杨: "巴扬",
    巴扬琴: "巴扬",
    巴拉莱卡: "巴拉莱卡琴",
    多姆拉: "多姆拉琴",
    曼陀铃: "曼陀林",
    乌克丽丽: "尤克里里",
    尤克里里琴: "尤克里里",
    卡林巴琴: "卡林巴",
    拇指琴: "卡林巴",
    萨克斯管: "萨克斯",
    排萧: "排箫",
    键盘乐器: "键盘",
    电子合成器: "合成器",
};

/** 全部乐器名（中英日合并去重），供 lang-rkgk 补全与 lint-rkgk 判定 */
export const INSTRUMENT_NAMES: readonly string[] = Array.from(
    new Set([...INSTRUMENT_NAMES_EN, ...INSTRUMENT_NAMES_ZH])
);

/** 泛指类条目不参与自动识别（人工在窗口里仍可选） */
const GENERIC_NAMES = new Set(["Other Instruments", "その他の楽器", "其他乐器"]);

const EN_BY_LOWER = new Map(INSTRUMENT_NAMES_EN.map((name) => [name.toLowerCase(), name]));
const ZH_NAMES = new Set(INSTRUMENT_NAMES_ZH);

/**
 * 乐器标签 -> `乐器-<乐器名>`，识别不了返回 null。
 *
 * 中文优先：标签已经被 netease 归一成中文（`巴扬 Bayan` → `巴扬`），
 * 只有在纯英文/日文写法时才会落到英文表，输出站点既有的英文名（`乐器-Guitar`）。
 */
export function instrumentRole(label: string): string | null {
    const text = label.trim();
    if (!text) return null;

    const zh = INSTRUMENT_ALIAS_ZH[text] ?? (ZH_NAMES.has(text) ? text : null);
    if (zh && !GENERIC_NAMES.has(zh)) return `乐器-${zh}`;

    const en = EN_BY_LOWER.get(text.toLowerCase());
    if (en && !GENERIC_NAMES.has(en)) return `乐器-${en}`;

    return null;
}