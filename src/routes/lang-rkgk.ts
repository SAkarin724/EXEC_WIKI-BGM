import { TreeSitterParser, type NodeInfo } from "./treeSitterParser";
import { durationToSeconds } from "$lib/importSource/common";
import { INSTRUMENT_NAMES } from "$lib/instruments";

import { Parser, Language as TreeSitterLanguage } from "web-tree-sitter";
import { LanguageSupport, Language, defineLanguageFacet, languageDataProp } from "@codemirror/language";
import { completeFromList, insertCompletionText, type Completion } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { type Facet } from "@codemirror/state";
import * as lezer from "@lezer/common";
import { tags as highlightTags, styleTags } from "@lezer/highlight";

interface TypeCompletion {
    label: string;
    displayLabel?: string;
    boost?: number;
}

/** `乐器-<乐器名>` 补全项，乐器名以 `$lib/instruments.ts` 为单一数据源 */
const INSTRUMENT_COMPLETIONS: TypeCompletion[] = INSTRUMENT_NAMES.map((name) => ({
    displayLabel: `乐器-${name}`,
    label: name,
}));

const TYPE_COMPLETIONS: TypeCompletion[] = [
    { label: "Music" },
    { label: "Compose" },
    { label: "Lyrics" },
    { label: "Arrangement" },
    { label: "Vocal", boost: 1 },
    { label: "Featured" },
    { label: "Illustration" },
    { label: "Label" },
    { label: "Producer" },
    { label: "Recording" },
    { label: "Guest vocal" },
    { label: "Mixing" },
    { label: "Mastering" },
    { label: "Chorus" },
    { label: "Choir" },
    { label: "Narration" },
    { label: "Vocal Edition" },
    { label: "Vocal Direction" },
    { label: "Sound Direction" },
    { label: "Design" },
    { label: "custom-" },
    { label: "custom-Programming", boost: -99 },
    { label: "custom-编程", boost: -99 },
    { displayLabel: "作詞作編曲", label: "zuocizuobianqu" },
    { displayLabel: "作詞作曲", label: "zuocizuoqu" },
    { displayLabel: "作編曲", label: "zuobianqu" },
    { displayLabel: "作曲", label: "zuoqu" },
    { displayLabel: "作曲-", label: "zuoqu", boost: -99 },
    { displayLabel: "編曲", label: "bianqu" },
    { displayLabel: "编曲-", label: "bianqu", boost: -99 },
    { displayLabel: "作詞", label: "zuoci" },
    { displayLabel: "作词-", label: "zuoci", boost: -99 },
    { displayLabel: "厂牌", label: "changpai" },
    { displayLabel: "脚本", label: "jiaoben" },
    { displayLabel: "插图", label: "chatu" },
    { displayLabel: "插图-", label: "chatu-", boost: -99 },
    { displayLabel: "制作人", label: "zhizuoren" },
    { displayLabel: "出版方", label: "chubanfang" },
    { displayLabel: "录音", label: "luyin" },
    { displayLabel: "录音-", label: "luyin", boost: -99 },
    { displayLabel: "原作", label: "yuanzuo" },
    { displayLabel: "声乐", label: "shengyue" },
    { displayLabel: "声乐-", label: "shengyue", boost: -99 },
    { displayLabel: "声乐-Background Vocals", label: "Background Vocals", boost: -99 },
    { displayLabel: "声乐-バックグラウンドボーカル", label: "バックグラウンドボーカル", boost: -99 },
    { displayLabel: "乐器", label: "yueqi" },
    { displayLabel: "混音", label: "hunyin" },
    { displayLabel: "母带制作", label: "mudaizhizuo" },
    { displayLabel: "和声", label: "hesheng" },
    { displayLabel: "合唱", label: "hechang" },
    { displayLabel: "混音-", label: "hunyin", boost: -99 },
    { displayLabel: "母带制作-", label: "mudaizhizuo", boost: -99 },
    { displayLabel: "和声-", label: "hesheng", boost: -99 },
    { displayLabel: "合唱-", label: "hechang", boost: -99 },
    { displayLabel: "念白", label: "nianbai" },
    { displayLabel: "旁白", label: "pangbai" },
    { displayLabel: "人声编辑", label: "renshengbianji" },
    { displayLabel: "人声指导", label: "renshengzhidao" },
    { displayLabel: "音响监督", label: "yinxiangjiandu" },
    { displayLabel: "设计", label: "sheji" },
    { displayLabel: "设计-", label: "sheji-", boost: -99 },
    { displayLabel: "设计-Graphic Design", label: "Graphic Design", boost: -99 },
    { displayLabel: "设计-グラフィックデザイン", label: "グラフィックデザイン", boost: -99 },
    { displayLabel: "设计-平面设计", label: "平面设计", boost: -99 },
    { displayLabel: "客串", label: "kechuan" },
    { displayLabel: "乐器-", label: "yueqi-"},
    ...INSTRUMENT_COMPLETIONS,
];

/**
 * 乐器名列表，来自 `$lib/instruments.ts`（单一数据源）。写法为 `乐器-<乐器名>`。
 * lint-rkgk 用它判断被当成职位写出来的乐器名（如 `Guitar：某人`）。
 */
export { INSTRUMENT_NAMES };

function applyTypeCompletion(view: EditorView, completion: Completion, from: number, to: number) {
    const base = completion.displayLabel || completion.label;
    // 尾部带 "-" 的条目（如「插图-」「声乐-」）确认时不再追加 "・"
    const comp = base.endsWith("-") ? base : `${base}・`;
    view.dispatch(insertCompletionText(view.state, comp, from, to));
}

// Create a set of node types from lezer's default highlight tags
// 节点名同时被当作「节点类型」用（如 `partsTracksConverter` 靠名字找 `annotation`），
// 所以借某个 tag 的颜色不代表能共用它的名字。
const NODE_TYPE_SPECS: [string, any][] = [
    ["", (highlightTags as any)[""]],
    ...Object.keys(highlightTags).map((name) => [name, (highlightTags as any)[name]] as [string, any]),
    // 曲目时长借 annotation 的颜色，但节点名必须独立：`parts`（参与曲目标记 `(1,2)`）
    // 也映射到 annotation，两者共名时就分不出谱面用的是哪种写法，切换参与标记会失效。
    ["duration", highlightTags.annotation],
];
const NODE_TYPES = Object.fromEntries(
    NODE_TYPE_SPECS.map(([name, tag], i) => [name,
        lezer.NodeType.define({
            id: i,
            name,
            props: [styleTags({ [name]: tag })],
        })])
);

const FIELD2NODETYPE: { [name: string]: lezer.NodeType } = {
    "": NODE_TYPES[""],
    "role": NODE_TYPES.typeName,
    "creator": NODE_TYPES.literal,
    "cv_conj": NODE_TYPES.modifier,
    "parts": NODE_TYPES.annotation,
    "《": NODE_TYPES.keyword,
    "》": NODE_TYPES.keyword,
    "title": NODE_TYPES.heading,
    "duration": NODE_TYPES.duration,
    "//": NODE_TYPES.comment,
    "comment": NODE_TYPES.comment,
    "DISC": NODE_TYPES.keyword,
    "ERROR": NODE_TYPES.invalid,
}

const SEMANTIC_TYPES = [
    "role",
    "creator",
    "creatorSeparator",
    "cv_conj",
    "parts",
    "title",
    "duration",
    "comment",
    // 书名号：语法层始终成对出现（`《` + creator + `》`），中间整段是一个整体名字。
    // 不带下来就无从判断一个名字是「被括起来、不许拆」还是普通的连接词写法。
    "《",
    "》",
];

export interface CreditField {
    /** `《` / `》` = 书名号引用的开闭标记（中间整段是一个不可拆的名字） */
    type: "role" | "creator" | "creatorSeparator" | "cv_conj" | "parts" | "《" | "》";
    value: string;
}

export class RawTrack {
    title: string = "";
    comment: string = "";
    /** 曲目时长（秒）；null = 没有写 */
    duration: number | null = null;
    credits: CreditField[] = [];
    line: number = 0;
}

interface RawDisc {
    tracks: RawTrack[];
}

export interface RawRelease {
    credits: CreditField[];
    discs: RawDisc[];
}

function intoRawRelease(root: NodeInfo): RawRelease {
    const release: RawRelease = { credits: [], discs: [] };
    if (root.children.length > 0 && root.children[0].type === "credit_block") {
        release.credits = intoCredits(root.children.shift()!.children);
    }
    if (root.children.length > 0 && root.children[0].type === "disc") {
        for (let child of root.children) {
            if (child.type !== "disc") {
                console.warn(`Unknown node type at ${root.type} level: ${child.type}`);
                continue;
            }
            release.discs.push(intoRawDisc(child));
        }
    } else {
        release.discs.push(intoRawDisc(root));
    }
    return release;
}

function intoRawDisc(root: NodeInfo): RawDisc {
    const disc: RawDisc = { tracks: [] };
    for (let child of root.children) {
        if (child.type !== "song") {
            console.warn(`Unknown node type at ${root.type} level: ${child.type}`);
            continue;
        }
        disc.tracks.push(intoRawTrack(child));
    }
    return disc;
}

function intoRawTrack(node: NodeInfo): RawTrack {
    const track: RawTrack = new RawTrack();
    track.line = node.startRow + 1; // 1-based line number for editor locating
    // 逐个子节点判类型，不假设顺序：书名号引用（`《曲目名》`）会让 `title` 前多出 `《`/`》` 标记
    const rest: NodeInfo[] = [];
    for (const child of node.children) {
        if (child.type === "title" && !track.title) {
            track.title = child.text;
        } else if (child.type === "comment" && !track.comment) {
            track.comment = child.text.trim();
        } else if (child.type === "duration") {
            // duration 节点会带上标题后的空格：` (01:38)`，先 trim 再剥括号。
            const sec = durationToSeconds(child.text.trim().replace(/^[(（]|[)）]$/g, '').trim());
            if (sec !== null) track.duration = sec;
        } else if (child.type === "credit_block") {
            track.credits.push(...intoCredits(child.children));
        } else if (child.type !== "《" && child.type !== "》") {
            rest.push(child);
        }
    }
    // 书名号标题（《曲目 (01:38)》）里的时长会被并进 title；这里兜底拆出。
    if (track.title && track.duration === null) {
        const m = track.title.match(/^(.*?)\s*\((\d{1,3}:\d{2}(?::\d{2})?)\)\s*$/);
        if (m) {
            const sec = durationToSeconds(m[2]);
            if (sec !== null) {
                track.title = m[1].trim();
                track.duration = sec;
            }
        }
    }
    if (!track.title) {
        console.warn(`Track node does not have title: ${node.type} ${node.text}`);
    }
    if (rest.length > 0) {
        console.warn(`Track node has unknown children: ${rest.map((c) => `${c.type} ${c.text}`).join(" | ")}`);
    }
    return track;
}

function intoCredits(nodes: NodeInfo[]): CreditField[] {
    return nodes.flatMap(node => node.children.map(child => { return { type: child.type as CreditField["type"], value: child.text } }));
}

async function initTreeSitterParser() {
    await Parser.init();
    const parser = new Parser();
    const rkgk = await TreeSitterLanguage.load("tree-sitter-rkgk.wasm");
    parser.setLanguage(rkgk);
    return parser;
}

export async function rkgk(onUpdate: (disc: RawRelease) => void) {
    const tsp = await initTreeSitterParser();
    const langData = defineLanguageFacet({
        autocomplete: completeFromList([
            ...TYPE_COMPLETIONS.map(tp => ({
                ...tp,
                // 将乐器相关条目（displayLabel 以“乐器”开头）优先级压至最低，避免干扰其他职位搜索
                boost: tp.displayLabel?.startsWith("乐器") ? -99 : tp.boost,
                type: "type",
                apply: applyTypeCompletion,
            })),
        ]),
        closeBrackets: { brackets: ["《", "("] },
    });
    const _onUpdate = (root: NodeInfo) => onUpdate(intoRawRelease(root));
    const parser = new TreeSitterParser(tsp, docID(langData), FIELD2NODETYPE, SEMANTIC_TYPES, _onUpdate);
    const lang = new Language(langData, parser, [], "rkgk");
    return { lang: new LanguageSupport(lang) };
}

function docID(data: Facet<{ [name: string]: any }>) {
    return lezer.NodeType.define({ id: Object.keys(NODE_TYPES).length, name: "Document", props: [languageDataProp.add(() => data)], top: true })
}