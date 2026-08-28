
export function lintActions(key: string) {
    return {
        ...(key in AUTOFIX_CONFIG ? { autofix: AUTOFIX_CONFIG[key] } : {}),
    }
}

export const AUTOFIX_CONFIG = ([
    [autofixDate, ['发售日期', '发行日期', '连载开始', '放送开始', '开始', '播放结束', '结束']],
] as [any, string[]][]).reduce((obj, [fn, keys]) => {
    keys.forEach((key) => obj[key] = fn);
    return obj;
}, {} as { [key: string]: (value: string) => string | void });


const RE_DATE = /(\d{4})\D+(\d+)\D+(\d+)/u;
// English month names / abbreviations, e.g. "Aug 29, 2026" or "August 29, 2026"
const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    january: 1, february: 2, march: 3, april: 4, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
};
const RE_EN_DATE = /([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,\s*(\d{4})/u;
const RE_EVENT = /[\(（](.*?)[\)）]\s*$/u;
function autofixDate(value: string): string | void {
    const event = RE_EVENT.exec(value);
    const eventName = event ? ` (${event[1].trim()})` : '';

    let y: number, m: number, d: number;
    const date = RE_DATE.exec(value);
    if (date) {
        [y, m, d] = date.slice(1).map((v) => parseInt(v));
        if (value.includes('年')) return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}${eventName}`;
    }
    const enDate = RE_EN_DATE.exec(value);
    if (enDate) {
        const month = MONTHS[enDate[1].toLowerCase()];
        if (!month) return;
        y = parseInt(enDate[3]);
        m = month;
        d = parseInt(enDate[2]);
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}${eventName}`;
    }
}