import type { AutoEditor, Credits, Disc, ImportSource } from "./common";
import { CORS_ENDPOINT } from "../client";

/**
 * LinkCore（TuneCore Japan 的专辑分享页 linkco.re）导入。
 *
 * 页面没有 CORS 头，且同一张专辑有 ja / en 两个语言版本，所以抓取与解析都放在
 * cors/worker.js 的 /linkcore/<code> 路由（worker 里的 parseLinkCore）：
 * 同时抓两个语言页，人名与简介取 ja、职位取 en，逐曲合并成课目列表的职员。
 * 这里只负责把结果填进编辑器。
 */
interface PageInfo {
    /** 页面自身的链接，导入时写进「链接」字段 */
    url: string;
    title: string;
    artist: string;
    summary: string;
    /** `YYYY-MM-DD` */
    releaseDate: string;
    /** worker 上的封面图代理路径（相对） */
    coverPath: string;
    /** 条目级职员 */
    credits: Credits;
    discs: { tracks: { title: string; credits: Credits }[] }[];
    /** 解析时遇到的问题（未识别的职位等） */
    warnings: string[];
}

export class LinkCore implements ImportSource {
    name = "LinkCore";
    match = /^https?:\/\/(?:[a-z0-9-]+\.)?linkco\.re\/([A-Za-z0-9_-]+)/i;
    warning = "";
    options = [
        { id: "trackListCredits", text: "曲目列表与制作人员", default: true },
        { id: "titleIntro", text: "标题与简介", default: true },
        { id: "releaseDate", text: "发售日期", default: true },
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

        if (opts.trackListCredits) {
            // 逐曲写入，保留「哪首由谁演奏」；职位顺序按页面上的顺序
            const discs: Disc[] = page.discs.map((disc) => ({
                tracks: disc.tracks.map((track) => ({
                    title: track.title,
                    comment: "",
                    credits: track.credits,
                })),
            }));
            if (discs.length === 0) {
                editor.pushWarning("这个页面里没有找到曲目表");
            } else {
                editor.setTrackInfo({ credits: page.credits ?? {}, discs }, "import");
            }
        }

        if (opts.titleIntro) {
            editor.editTitleIntro(page.title, page.summary);
        }

        if (opts.releaseDate && page.releaseDate) {
            editor.setInfoBoxField("发售日期", page.releaseDate);
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

        for (const warning of page.warnings ?? []) {
            editor.pushWarning(warning);
        }

        editor.done();
    }
}

async function fetchPage(code: string): Promise<PageInfo> {
    const res = await fetch(`${CORS_ENDPOINT}/linkcore/${code}`, { mode: "cors" });
    const text = await res.text();

    let data: any = null;
    try {
        data = JSON.parse(text);
    } catch {
        // 不是 JSON：多半是 worker 还没部署 /linkcore 路由
    }
    if (!res.ok || data === null || data.error) {
        const fallback = data === null
            ? `HTTP ${res.status}（cors worker 可能还没部署 /linkcore 路由）`
            : `HTTP ${res.status}`;
        throw new Error(data?.error ?? fallback);
    }
    return data as PageInfo;
}

function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}