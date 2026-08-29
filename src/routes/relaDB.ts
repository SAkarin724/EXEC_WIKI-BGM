import {
    getPerson,
    getWikiHistoryPersonPIDList,
    getWikiHistorySubjectPersonRelaSIDList,
    getSubjectType,
    getSubjectRelaPIDList
} from '$lib/client';
import { db, type Staff } from '$lib/db';
import { toast, type ToastItemProps } from './Toast.svelte';

export async function importPersonCreated(bgmUID: string, tillPage: number = 10) {
    const pids = await gatherEntries(getWikiHistoryPersonPIDList, bgmUID, tillPage);
    let { tp, rfn } = toast('正在导入最近创建人物...', { progress: true });
    await __importPersonBatch(pids, tp, rfn);
}

export async function importRelaHistory(bgmUID: string, tillPage: number = 10) {
    let sids = await gatherEntries(getWikiHistorySubjectPersonRelaSIDList, bgmUID, tillPage);
    let { tp: tp1, rfn: rfn1 } = toast('正在收集最近关联条目...', { progress: true });
    tp1.nTotal = sids.length;
    const results = await Promise.allSettled(
        sids.map(async (sid) => {
            if ((await getSubjectType(sid)) !== 3) {
                // 不是音乐条目
                tp1.nDone++;
                return null;
            }
            const pids = await getSubjectRelaPIDList(sid);
            tp1.nDone++;
            return pids;
        })
    );
    const pids = results
        .map((r) => (r.status === 'fulfilled' ? r.value : null))
        .filter((p) => p !== null)
        .flat() as number[];
    const upids = Array.from(new Set(pids));
    rfn1();

    let { tp: tp2, rfn: rfn2 } = toast('正在导入最近关联人物...', { progress: true });
    await __importPersonBatch(upids, tp2, rfn2);
}

async function gatherEntries(
    fn: (username: string, page: number) => Promise<{ ids: number[]; maxPage: number }>,
    bgmUID: string,
    tillPage: number
): Promise<number[]> {
    let { tp, rfn } = toast('正在收集编辑历史...', { progress: true });
    const { ids, maxPage } = await fn(bgmUID, 1);
    tillPage = Math.min(tillPage, maxPage);
    tp.nTotal = tillPage;
    let allIDs = [...ids];
    for (let i = 2; i <= tillPage; i++) {
        const { ids } = await fn(bgmUID, i);
        allIDs.push(...ids);
        tp.nDone = i;
    }
    rfn();
    return Array.from(new Set(allIDs));
}

export async function importPersonBatch(pids: number[]) {
    let { tp, rfn } = toast('正在导入关联人物...', { progress: true });
    await __importPersonBatch(pids, tp, rfn, false);
}

// 模块级互斥锁:同一时间只允许一个写入流程,
// 避免并发同步(如 startImport 的两路、连点按钮、编辑器导入)相互覆盖/冲突。
let importQueue: Promise<unknown> = Promise.resolve();

function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = importQueue.then(fn, fn);
    importQueue = next.catch(() => undefined);
    return next;
}

async function __importPersonBatch(pids: number[], tp: ToastItemProps, rfn: () => void, artistOnly: boolean = true) {
    try {
        await runExclusive(async () => {
            // 过滤无效 id(wiki 历史解析异常可能产生 NaN,会令 IndexedDB 查询抛 DataError)
            pids = pids.filter((pid) => Number.isInteger(pid) && pid > 0);
            // 用 bulkGet 逐主键查重,绕开 anyOf 在大量 key 下范围扫描可能漏查的问题
            // (漏查会把库中已存在的人物误判为新人物,进而被下面的写入流程覆盖/删除)
            const existingRec = await db.staff.bulkGet(pids);
            const existing = new Set(existingRec.filter((s): s is Staff => s !== undefined).map((s) => s.id));
            const fresh = pids.filter((pid) => !existing.has(pid));

            tp.nTotal = fresh.length;
            const results = await Promise.allSettled(
                fresh.map(async (pid) => {
                    let s: Staff, isA: boolean;
                    try {
                        [s, isA] = await getPerson(pid);
                    } finally {
                        tp.nDone++;
                    }
                    return !artistOnly || isA ? s : null;
                })
            );
            const staffs = results
                .map((r) => (r.status === 'fulfilled' ? r.value : null))
                .filter((s) => s !== null) as Staff[];

            // 原子 upsert:存在则更新、不存在则新增。
            // 不再使用 bulkDelete + bulkAdd(两者是两个独立事务,
            // 在并发交错或 bulkAdd 失败时会删除已有人物且无法恢复)。
            // 分批写入,降低单事务规模与存储配额失败的风险。
            const BATCH = 100;
            try {
                for (let i = 0; i < staffs.length; i += BATCH) {
                    await db.staff.bulkPut(staffs.slice(i, i + BATCH));
                }
            } catch (e) {
                toast('写入关联库失败,存储空间可能不足,请尽快导出备份!');
                throw e;
            }
        });
    } finally {
        rfn();
    }
}
