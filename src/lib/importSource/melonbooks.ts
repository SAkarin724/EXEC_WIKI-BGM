import type { AutoEditor, ImportSource } from "./common";
import { CORS_ENDPOINT } from "../client";

/**
 * Melonbooks 商品页导入。
 *
 * 页面由 cors/worker.js 的 /melon/* 路由抓取并解析成 JSON
 * （worker 里的 parseMelonbooks），这里只负责把结果填进编辑器。
 *
 * 曲目表按需求原样塞进「曲目列表」输入框，不做曲目/艺术家解析；
 * 发售日期由 worker 拼好场贩后缀，例如 `2026-10-25 (M3-58)`。
 */
// 厂牌名里带 `&`、`/`、`,` 这类分隔符时，必须用书名号括起来当一个整体，
// 否则写进曲目列表后会被拆成多个制作人员（与 trackInfoWriter.nameEscape 的规则一致）。
const RE_SEP = /[ 　\t&＆:：\/・、；,]/;
const RE_LATIN_SPACE = /[A-Za-z] [A-Za-z]/;

function quoteLabel(name: string): string {
    return RE_SEP.test(name) && !RE_LATIN_SPACE.test(name) ? `《${name}》` : name;
}

interface PageInfo {
    /** 页面自身的链接，导入时写进「链接」字段 */
    url: string;
    title: string;
    summary: string;
    /** サークル名 */
    label: string;
    /** 纯数字，单位在这里补 */
    price: string;
    /** 已带场贩后缀的日期 */
    releaseDate: string;
    /** 版型・メディア */
    media: string;
    /** worker 上的封面图代理路径（相对） */
    coverPath: string;
    /** トラックリスト 原文 */
    tracklistText: string;
}

export class Melonbooks implements ImportSource {
    name = "Melonbooks";
    match = /^https?:\/\/(?:www\.)?melonbooks\.co\.jp(\/.*)$/;
    warning = "";
    options = [
        { id: "trackListText", text: "曲目列表（页面原文）", default: true },
        { id: "titleIntro", text: "标题与简介", default: true },
        { id: "label", text: "厂牌（サークル名）", default: true },
        { id: "price", text: "价格", default: true },
        { id: "releaseDate", text: "发售日期（含场贩）", default: true },
        { id: "media", text: "版本特性（版型・メディア）", default: true },
        { id: "links", text: "页面链接", default: true },
        { id: "cover", text: "封面图", default: true },
    ];

    private pageInfo: Promise<PageInfo> | null = null;

    async load(url: string): Promise<string> {
        this.pageInfo = fetchPage(this.match.exec(url)![1]);
        return (await this.pageInfo).title;
    }

    async apply(opts: { [key: string]: any }, editor: AutoEditor): Promise<void> {
        let page: PageInfo;
        try {
            page = await this.pageInfo!;
        } catch (e) {
            editor.pushWarning(`导入失败：${messageOf(e)}`);
            editor.done();
            return;
        }

        if (opts.trackListText) {
            // 和其它网店源一致：厂牌写成「厂牌：…」的职员行放在曲目列表最前面，
            // infobox 的 厂牌 由曲目列表联动填，不单独去写（会被联动覆盖）。
            const parts: string[] = [];
            if (opts.label && page.label) parts.push(`厂牌：${quoteLabel(page.label)}`);
            if (page.tracklistText) parts.push(page.tracklistText);

            if (parts.length > 0) {
                editor.setTrackInfoText(parts.join("\n\n"));
            }
            if (!page.tracklistText) {
                editor.pushWarning("这个页面里没有找到曲目表");
            }
        }

        if (opts.titleIntro) {
            editor.editTitleIntro(page.title, page.summary);
        }

        if (opts.price && page.price) {
            editor.setInfoBoxField("价格", `${page.price} JPY`);
        }

        if (opts.releaseDate && page.releaseDate) {
            editor.setInfoBoxField("发售日期", page.releaseDate);
        }

        if (opts.media && page.media) {
            editor.setInfoBoxField("版本特性", page.media);
        }

        if (opts.links) {
            editor.setInfoBoxField("链接", [[this.name, page.url]]);
        }

        if (opts.cover && page.coverPath) {
            try {
                await editor.setCover(`${CORS_ENDPOINT}${page.coverPath}`);
            } catch (e) {
                editor.pushWarning(`封面导入失败：${messageOf(e)}`);
            }
        }

        editor.done();
    }
}

async function fetchPage(path: string): Promise<PageInfo> {
    const res = await fetch(`${CORS_ENDPOINT}/melon${path}`, { mode: "cors" });
    const text = await res.text();

    let data: any = null;
    try {
        data = JSON.parse(text);
    } catch {
        // 不是 JSON：多半是 worker 还没部署 /melon 路由
    }
    if (!res.ok || data === null || data.error) {
        throw new Error(data?.error ?? `HTTP ${res.status}`);
    }
    return data as PageInfo;
}

function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
