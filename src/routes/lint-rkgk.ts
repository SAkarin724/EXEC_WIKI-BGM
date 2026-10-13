import { Role, ROLE_MAP } from "./postprocess";
import { INSTRUMENT_NAMES } from "./lang-rkgk";

import { syntaxTree } from "@codemirror/language";
import { type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { linter, type Action, type Diagnostic } from "@codemirror/lint";
import * as lezer from "@lezer/common";

const PAN_VOCAL = new Set(Object.entries(ROLE_MAP).filter(([_, v]) => v[0] === Role.V || v[0] === Role.FV).map(([k, _]) => k));

const INSTRUMENT_NAMES_LOWER = new Set(INSTRUMENT_NAMES.map((name) => name.toLowerCase()));

// 行首形如「职位名 + 分隔符」的写法，如 `Guitar：某人`、`Mix：某人`
const RE_ROLE_HEAD = /^[ 　\t]*([^：:・]+?)[ 　\t]*[：:・]/;

interface RoleHead {
    from: number;
    to: number;
    name: string;
}

/**
 * 找出被当成曲名吞进标题里的行首职位名。
 * 像 `Guitar：某人`、`Mix：某人` 都不是解析器认识的职位写法，
 * 于是整行会成为 song_title 的一部分，这里把它们逐行捞出来。
 */
function scanRoleHeads(text: string, offset: number): RoleHead[] {
    const heads: RoleHead[] = [];
    let lineStart = 0;
    text.split("\n").forEach((line) => {
        const m = RE_ROLE_HEAD.exec(line);
        if (m) {
            const from = offset + lineStart + line.indexOf(m[1]);
            heads.push({ from, to: from + m[1].length, name: m[1] });
        }
        lineStart += line.length + 1;
    });
    return heads;
}

export function getLinter(): Extension {
    return linter((view: EditorView): readonly Diagnostic[] => {
        function getText(node: lezer.SyntaxNodeRef) {
            return view.state.sliceDoc(node.from, node.to);
        }
        interface LintTrack {
            node: lezer.SyntaxNode;
            featStart: number;
            lineEnd: number;
            hasVocal: boolean;
            startsWith歌: boolean;
            roleHeads: RoleHead[];
        }
        let trs: LintTrack[] = [];
        syntaxTree(view.state).cursor().iterate((node) => {
            switch (node.name) {
                case "heading": // title
                    const title = getText(node);
                    trs.push({
                        node: node.node, featStart: title.indexOf("feat."),
                        lineEnd: node.to, hasVocal: false,
                        startsWith歌: /^歌[：:・ ]/.test(title),
                        roleHeads: scanRoleHeads(title, node.from),
                    });
                    return;
                case "comment":
                    trs[trs.length - 1].lineEnd = node.to;
                    return;
                case "typeName": // role
                    if (!trs.length || trs[trs.length - 1].featStart === -1) return;
                    const role = getText(node);
                    if (PAN_VOCAL.has(role.toLowerCase())) {
                        trs[trs.length - 1].hasVocal = true;
                    }
                    return;
            }
        });

        let diagnostics: Diagnostic[] = [];
        let featEdits: { from: number, insert: string }[] = [];
        const featActions: Action[] = [
            {
                name: "客串", apply(view) {
                    const c = featEdits.map(({ from, insert }) => ({ from, insert: `\nGuest Vocal: ${insert}` }));
                    view.dispatch({ changes: c });
                }
            },
            {
                name: "艺术家", apply(view) {
                    const c = featEdits.map(({ from, insert }) => ({ from, insert: `\nVocal: ${insert}` }));
                    view.dispatch({ changes: c });
                }
            }
        ];
        let 歌Edits: { from: number, to: number }[] = [];
        const 歌Actions: Action[] = [
            {
                name: "替换“歌”为“歌唱”", apply(view) {
                    const c = 歌Edits.map(({ from, to }) => ({ from, to, insert: "歌唱" }));
                    view.dispatch({ changes: c });
                }
            }
        ];
        let mixEdits: { from: number, to: number }[] = [];
        const mixActions: Action[] = [
            {
                name: "替换“Mix”为“Mixing”", apply(view) {
                    const c = mixEdits.map(({ from, to }) => ({ from, to, insert: "Mixing" }));
                    view.dispatch({ changes: c });
                }
            }
        ];
        let 乐器Edits: { from: number }[] = [];
        const 乐器Actions: Action[] = [
            {
                name: "加“乐器-”前缀", apply(view) {
                    const c = 乐器Edits.map(({ from }) => ({ from, insert: "乐器-" }));
                    view.dispatch({ changes: c });
                }
            }
        ];
        trs.forEach(({ node, featStart, lineEnd, hasVocal, startsWith歌, roleHeads }) => {
            if (featStart !== -1 && !hasVocal) {
                const feat = view.state.sliceDoc(node.from + featStart + 5, node.to).trim().replace(/[\)）]$/, "");
                featEdits.push({ from: lineEnd, insert: feat });
                diagnostics.push({
                    from: node.from + featStart,
                    to: node.to,
                    message: "提取所有 feat. 为…",
                    severity: "warning",
                    actions: featActions,
                });
            } else if (startsWith歌) {
                歌Edits.push({ from: node.from, to: node.from + 1 });
                diagnostics.push({
                    from: node.from,
                    to: node.to,
                    message: "这位是不是「艺术家」？",
                    severity: "warning",
                    actions: 歌Actions,
                });
            }
            roleHeads.forEach(({ from, to, name }) => {
                if (name.toLowerCase() === "mix") {
                    mixEdits.push({ from, to });
                    diagnostics.push({
                        from, to,
                        message: "这个职位是不是「Mixing」？",
                        severity: "warning",
                        actions: mixActions,
                    });
                } else if (INSTRUMENT_NAMES_LOWER.has(name.toLowerCase())) {
                    乐器Edits.push({ from });
                    diagnostics.push({
                        from, to,
                        message: "这个职位是不是「乐器」？",
                        severity: "warning",
                        actions: 乐器Actions,
                    });
                }
            });
        });
        return diagnostics;
    });
}