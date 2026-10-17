import type { AutoEditor, Credits, Disc, ImportSource } from "./common";
import { CORS_ENDPOINT } from "../client";

/**
 * DIVERSE DIRECT 商品页导入。
 *
 * 页面由 cors/worker.js 的 /diverse/* 路由抓取并解析成 JSON
 * （worker 里的 parseDiverseDirect），这里只负责把结果填进编辑器。
 * 曲目表每行是「曲目号 / 曲名 / 艺术家」，插图/设计/母带/制作人 由右栏的 dl 提供。
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
    releaseDate: string;
    /** worker 上的封面图代理路径（相对） */
    coverPath: string;
    youtube: string;
    website: string;
    /** 职位 -> 名字 */
    credits: Record<string, string[]>;
    discs: PageDisc[];
}

export class DiverseDirect implements ImportSource {
    name = "DIVERSE DIRECT";
    match = /^https?:\/\/(?:www\.)?diverse\.direct(\/.*)$/;
    warning = "";
    options = [
        { id: "trackListCredits", text: "曲目列表与制作人员", default: true },
        { id: "titleIntro", text: "标题与简介", default: true },
        { id: "labelSerial", text: "厂牌与编号/品番", default: true },
        { id: "price", text: "价格", default: true },
        { id: "releaseDate", text: "发售日期", default: true },
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
            Object.entries(page.credits).forEach(([role, names]) => {
                if (names.length > 0) credits[role] = [...names];
            });
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

        if (opts.releaseDate && page.releaseDate) {
            editor.setInfoBoxField("发售日期", page.releaseDate);
        }

        if (opts.website && page.website) {
            editor.setInfoBoxField("官方网站", page.website);
        }

        if (opts.links) {
            const links: [string, string][] = [[this.name, page.url]];
            if (page.youtube) links.push(["试听", page.youtube]);
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
    const res = await fetch(`${CORS_ENDPOINT}/diverse${path}`, { mode: "cors" });
    const text = await res.text();

    let data: any = null;
    try {
        data = JSON.parse(text);
    } catch {
        // 不是 JSON：多半是 worker 还没部署 /diverse 路由
    }
    if (!res.ok || data === null || data.error) {
        throw new Error(data?.error ?? `HTTP ${res.status}`);
    }
    return data as PageInfo;
}

function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
