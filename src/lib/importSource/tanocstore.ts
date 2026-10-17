import type { AutoEditor, Credits, Disc, ImportSource } from "./common";
import { CORS_ENDPOINT } from "../client";

/**
 * TANO*C STORE 商品页导入。
 *
 * 页面是 EUC-JP，且「红色字标题 / 简介 / TRACKLIST / 每碟一张 table」都混在
 * div.detailf 里，所以抓取与解析都放在 cors/worker.js 的 /tanoc/* 路由
 * （worker 里的 parseTanocStore），这里只负责把结果填进编辑器。
 * 曲目表每行是「曲目号 / 艺术家 / 时长(多为 -) / 曲名」；单碟不标 Disc 1。
 */
interface PageTrack {
    title: string;
    artist: string;
}

interface PageDisc {
    tracks: PageTrack[];
}

interface PageInfo {
    /** 页面自身的链接，导入时写进「链接」字段 */
    url: string;
    title: string;
    summary: string;
    label: string;
    serial: string;
    /** 纯数字，单位在这里补 */
    price: string;
    /** worker 上的封面图代理路径（相对） */
    coverPath: string;
    youtube: string;
    website: string;
    discs: PageDisc[];
}

export class TanocStore implements ImportSource {
    name = "TANO*C STORE";
    match = /^https?:\/\/(?:www\.)?tanocstore\.net(\/.*)$/;
    warning = "";
    options = [
        { id: "trackListCredits", text: "曲目列表与制作人员", default: true },
        { id: "titleIntro", text: "标题与简介", default: true },
        { id: "labelSerial", text: "厂牌与编号/品番", default: true },
        { id: "price", text: "价格", default: true },
        { id: "website", text: "官方网站", default: true },
        { id: "links", text: "页面链接与试听", default: true },
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
            const credits: Credits = {};
            if (opts.labelSerial && page.label) {
                credits["厂牌"] = [page.label];
            }

            const discs: Disc[] = page.discs.map((disc) => ({
                tracks: disc.tracks.map((track) => {
                    const trackCredits: Credits = track.artist ? { "艺术家": [track.artist] } : {};
                    return { title: track.title, comment: "", credits: trackCredits };
                }),
            }));
            if (discs.length === 0) {
                editor.pushWarning("这个页面里没有找到曲目表");
            } else {
                editor.setTrackInfo({ credits, discs });
            }
        }

        if (opts.titleIntro) {
            editor.editTitleIntro(page.title, page.summary);
        }

        if (opts.labelSerial && page.serial) {
            if (!editor.setInfoBoxField("品番", page.serial, { editOnly: true })) {
                editor.setInfoBoxField("编号", page.serial);
            }
        }

        if (opts.price && page.price) {
            editor.setInfoBoxField("价格", `${page.price} JPY`);
        }

        if (opts.website && page.website) {
            editor.setInfoBoxField("官方网站", page.website);
        }

        if (opts.links) {
            const links: [string, string][] = [];
            if (page.youtube) links.push(["试听", page.youtube]);
            links.push([this.name, page.url]);
            editor.setInfoBoxField("链接", links);
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
    const res = await fetch(`${CORS_ENDPOINT}/tanoc${path}`, { mode: "cors" });
    const text = await res.text();

    let data: any = null;
    try {
        data = JSON.parse(text);
    } catch {
        // 不是 JSON：多半是 worker 还没部署 /tanoc 路由
    }
    if (!res.ok || data === null || data.error) {
        throw new Error(data?.error ?? `HTTP ${res.status}`);
    }
    return data as PageInfo;
}

function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
