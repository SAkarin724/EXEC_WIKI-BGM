// ==UserScript==
// @name         Bangumi 音乐条目 Disc 信息增强
// @namespace    org.sakarin.bgm.music.disc.meta.badges
// @version      0.0.5
// @author       SilenceAkarin, ChatGPT
// @description  在 Bangumi 音乐条目页中为 Disc 标题追加 [品番] [时长]，并将 Infobox 中的多 Disc 播放时长/品番改为摘要 + 悬浮详情
// @match        https://bgm.tv/subject/*
// @match        https://chii.in/subject/*
// @match        https://bangumi.tv/subject/*
// @grant        none
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const STYLE_ID = 'bgm-disc-meta-badges-style-v2';

    const DURATION_CLASS = 'bgm-ep-duration';

    const CATALOG_LABELS = ['品番', '商品番号', '商品编号', '编号', 'Catalog', 'Catalog Number'];

    function normalizeWhitespace(text) {
        return String(text || '')
            .replace(/&nbsp;|\u00A0/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeDiscLabel(text) {
        return normalizeWhitespace(text).toUpperCase();
    }

    function normalizeTipLabel(text) {
        return normalizeWhitespace(text).replace(/[：:]\s*$/, '');
    }

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    function formatSecondsToHHMMSS(totalSeconds) {
        totalSeconds = Number(totalSeconds);
        if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '';

        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;

        return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
    }

    function normalizeDurationText(raw) {
        const text = normalizeWhitespace(raw);
        if (!text) return '';

        let m;

        // HH:MM:SS
        m = text.match(/^(\d{1,3}):(\d{1,2}):(\d{1,2})$/);
        if (m) {
            const total = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
            return formatSecondsToHHMMSS(total);
        }

        // MM:SS
        m = text.match(/^(\d{1,5}):(\d{1,2})$/);
        if (m) {
            const total = Number(m[1]) * 60 + Number(m[2]);
            return formatSecondsToHHMMSS(total);
        }

        return text;
    }

    function parseDurationSeconds(raw) {
        const normalized = normalizeDurationText(raw);
        const m = normalized.match(/^(\d{2}):(\d{2}):(\d{2})$/);
        if (!m) return null;
        return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    }

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .bgm-disc-meta-wrap {
                float: right;
                display: inline-flex;
                align-items: center;
                gap: 6px;
                margin-left: 12px;
                white-space: nowrap;
                font-size: 12px;
                font-weight: 500;
            }

            .bgm-disc-meta-badge {
                display: inline-flex;
                align-items: center;
                height: 20px;
                padding: 0 8px;
                border-radius: 999px;
                border: 1px solid rgba(0, 0, 0, 0.08);
                background: rgba(255, 255, 255, 0.92);
                color: #666;
                line-height: 20px;
            }

            .bgm-disc-meta-badge.catalog {
                color: #4f6b8a;
            }

            .bgm-disc-meta-badge.duration {
                color: #8a5a6a;
            }

            html[data-theme="dark"] .bgm-disc-meta-badge,
            body[data-theme="dark"] .bgm-disc-meta-badge {
                background: rgba(70, 70, 70, 0.88);
                border-color: rgba(255, 255, 255, 0.12);
                color: #ddd;
            }

            html[data-theme="dark"] .bgm-disc-meta-badge.catalog,
            body[data-theme="dark"] .bgm-disc-meta-badge.catalog {
                color: #9fc3ff;
            }

            html[data-theme="dark"] .bgm-disc-meta-badge.duration,
            body[data-theme="dark"] .bgm-disc-meta-badge.duration {
                color: #ffbecb;
            }

            .line_list_music > li.cat {
                display: block;
                overflow: visible;
                position: relative;
            }

            .bgm-disc-infobox-host {
                position: relative;
                overflow: visible;
            }

            .bgm-disc-summary {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                margin-left: 2px;
                flex-wrap: wrap;
            }

            .bgm-disc-summary-main {
                font-weight: 500;
            }

            .bgm-disc-summary-count {
                display: inline-flex;
                align-items: center;
                height: 18px;
                padding: 0 7px;
                border-radius: 999px;
                background: rgba(240, 145, 153, 0.14);
                color: #c45468;
                font-size: 11px;
                line-height: 18px;
            }

            html[data-theme="dark"] .bgm-disc-summary-count,
            body[data-theme="dark"] .bgm-disc-summary-count {
                background: rgba(240, 145, 153, 0.18);
                color: #ffb7c0;
            }

            .bgm-disc-detail-trigger {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 18px;
                height: 18px;
                padding: 0 6px;
                border-radius: 999px;
                cursor: pointer;
                background: rgba(54, 156, 248, 0.12);
                color: #3a80d2;
                font-size: 11px;
                line-height: 18px;
                user-select: none;
            }

            .bgm-disc-detail-trigger:hover {
                background: rgba(54, 156, 248, 0.18);
            }

            html[data-theme="dark"] .bgm-disc-detail-trigger,
            body[data-theme="dark"] .bgm-disc-detail-trigger {
                background: rgba(54, 156, 248, 0.18);
                color: #9fc3ff;
            }

            .bgm-disc-popover {
                position: absolute;
                top: calc(100% + 6px);
                left: 0;
                z-index: 9999;
                min-width: 240px;
                max-width: 360px;
                padding: 8px;
                border-radius: 10px;
                border: 1px solid rgba(0, 0, 0, 0.08);
                background: rgba(255, 255, 255, 0.97);
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
                backdrop-filter: blur(10px);
                display: none;
            }

            html[data-theme="dark"] .bgm-disc-popover,
            body[data-theme="dark"] .bgm-disc-popover {
                background: rgba(46, 46, 46, 0.97);
                border-color: rgba(255, 255, 255, 0.12);
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
            }

            .bgm-disc-popover.visible {
                display: block;
            }

            .bgm-disc-popover-row {
                display: grid;
                grid-template-columns: 64px 1fr;
                gap: 10px;
                align-items: center;
                padding: 4px 2px;
                font-size: 12px;
                line-height: 1.45;
            }

            .bgm-disc-popover-row + .bgm-disc-popover-row {
                border-top: 1px dashed rgba(0, 0, 0, 0.08);
            }

            html[data-theme="dark"] .bgm-disc-popover-row + .bgm-disc-popover-row,
            body[data-theme="dark"] .bgm-disc-popover-row + .bgm-disc-popover-row {
                border-top-color: rgba(255, 255, 255, 0.08);
            }

            .bgm-disc-popover-key {
                color: #888;
                font-weight: 600;
            }

            .bgm-disc-popover-value {
                color: inherit;
                word-break: break-all;
            }

            @media (max-width: 720px) {
                .bgm-disc-meta-wrap {
                    float: none;
                    display: flex;
                    margin-top: 6px;
                    margin-left: 0;
                    flex-wrap: wrap;
                }

                .bgm-disc-popover {
                    left: auto;
                    right: 0;
                    min-width: 220px;
                    max-width: min(320px, calc(100vw - 32px));
                }
            }
            
            .bgm-ep-duration {
                margin-right: 4px;
                white-space: nowrap;
                white-space: nowrap;
                font-size: 12px;
                line-height: 14px;
                vertical-align: middle;
      }
        `;
        document.head.appendChild(style);
    }

    /* ----------------时长显示---------------- */
    function getSubjectId() {
        const match = location.pathname.match(/^\/subject\/(\d+)(?:\/)?$/);
        return match ? match[1] : null;
    }
    /* ----------------时长显示---------------- */

    function isSubjectPage() {
        return /^\/subject\/\d+(?:\/ep(?:\/.*)?|\/?)$/.test(location.pathname);
    }

    function isLikelyMusicSubjectPage() {
        const infobox = document.querySelector('#infobox');
        const nav = document.querySelector('.subjectNav');
        if (!infobox || !nav) return false;

        const infoboxText = normalizeWhitespace(infobox.textContent || '');
        const navText = normalizeWhitespace(nav.textContent || '');

        return /曲目/.test(navText) && /播放时长|品番|商品番号|商品编号|编号|Catalog(?: Number)?|艺术家/.test(infoboxText);
    }

    function getInfoboxItems() {
        return Array.from(document.querySelectorAll('#infobox li'));
    }

    function cloneWithoutTip(li) {
        const clone = li.cloneNode(true);
        clone.querySelectorAll('.tip, .bgm-disc-summary, .bgm-disc-popover, .bgm-disc-meta-wrap').forEach((node) => node.remove());
        return normalizeWhitespace(clone.textContent || '');
    }

    function getSectionWithSubs(label) {
        const sections = Array.from(document.querySelectorAll('#infobox li.sub_section, #infobox > li'));

        for (const li of sections) {
            const tip = li.querySelector(':scope > .tip');
            if (!tip) continue;

            const tipLabel = normalizeTipLabel(tip.textContent || '');
            if (tipLabel !== label) continue;

            const subs = [];
            let next = li.nextElementSibling;

            while (
                next &&
                next.parentElement === li.parentElement &&
                next.classList &&
                next.classList.contains('sub')
            ) {
                subs.push(next);
                next = next.nextElementSibling;
            }

            return {
                section: li,
                subs,
                mainValue: cloneWithoutTip(li),
            };
        }

        return null;
    }

    function expandSequentialCatalogRange(mainValue, discCount) {
        const text = normalizeWhitespace(mainValue);
        if (!text || !discCount || discCount < 2) return new Map();

        const m = text.match(/^(.*?)(\d+)\s*[~～〜]\s*(\d+)$/);
        if (!m) return new Map();

        const prefix = m[1] || '';
        const startStr = m[2];
        const endShortStr = m[3];

        const startNum = Number(startStr);
        if (!Number.isFinite(startNum)) return new Map();

        let endNum;
        if (endShortStr.length < startStr.length) {
            const head = startStr.slice(0, startStr.length - endShortStr.length);
            endNum = Number(head + endShortStr);
        } else {
            endNum = Number(endShortStr);
        }

        if (!Number.isFinite(endNum) || endNum < startNum) return new Map();

        const expectedCount = endNum - startNum + 1;
        if (expectedCount !== discCount) return new Map();

        const width = startStr.length;
        const map = new Map();

        for (let i = 0; i < discCount; i++) {
            const discNo = i + 1;
            const catalogNo = String(startNum + i).padStart(width, '0');
            map.set(`DISC ${discNo}`, `${prefix}${catalogNo}`);
        }

        return map;
    }

    function buildCatalogMapFromMainValueIfNeeded(data, pairedDiscCount) {
        if (!data || !data.mainValue) return new Map();
        return expandSequentialCatalogRange(data.mainValue, pairedDiscCount);
    }

    function collectDiscMap(label, type, pairedDiscCount = 0) {
        const data = getSectionWithSubs(label);
        const map = new Map();

        if (!data) {
            return {
                section: null,
                mainValue: '',
                subs: [],
                map,
                hasMulti: false,
            };
        }

        data.subs.forEach((li) => {
            const tip = li.querySelector('.tip');
            if (!tip) return;

            const disc = normalizeDiscLabel(tip.textContent || '');
            let value = cloneWithoutTip(li);

            if (!/^DISC \d+$/.test(disc)) return;
            if (!value) return;

            if (type === 'duration') {
                value = normalizeDurationText(value);
            }

            map.set(disc, value);
        });

        // 品番没有显式 DISC 子项时，尝试从主值里推导顺序品番
        if (type === 'catalog' && map.size === 0 && pairedDiscCount >= 2) {
            const derivedMap = buildCatalogMapFromMainValueIfNeeded(data, pairedDiscCount);
            if (derivedMap.size >= 2) {
                return {
                    section: data.section,
                    mainValue: data.mainValue,
                    subs: data.subs,
                    map: derivedMap,
                    hasMulti: true,
                };
            }
        }

        return {
            section: data.section,
            mainValue: data.mainValue,
            subs: data.subs,
            map,
            hasMulti: map.size >= 2,
        };
    }

    function collectCatalogInfo(pairedDiscCount) {
        for (const label of CATALOG_LABELS) {
            const info = collectDiscMap(label, 'catalog', pairedDiscCount);
            if (info.section) return info;
        }

        return {
            section: null,
            mainValue: '',
            subs: [],
            map: new Map(),
            hasMulti: false,
        };
    }

    function shouldUseDurationOnHeadings(durationInfo, catalogInfo) {
        // 正常多 Disc 播放时长：照旧支持
        if (durationInfo.hasMulti) return true;

        // 播放时长只有部分 Disc，但品番已经确认是多 Disc：
        // 允许把已有的时长挂到对应 Disc 标题上
        if (catalogInfo.hasMulti && durationInfo.map.size >= 1) return true;

        return false;
    }

    function getDiscHeadingNodes() {
        return Array.from(document.querySelectorAll(
            '.subject_ep_section .line_detail ul.line_list_music > li.cat, .line_detail ul.line_list_music > li.cat'
        ));
    }

    function getDiscHeadingCount() {
        const discSet = new Set();

        getDiscHeadingNodes().forEach((li) => {
            const disc = normalizeDiscLabel(li.textContent || '');
            if (/^DISC \d+$/.test(disc)) {
                discSet.add(disc);
            }
        });

        return discSet.size;
    }

    function createBadge(className, text) {
        const span = document.createElement('span');
        span.className = `bgm-disc-meta-badge ${className}`;
        span.textContent = `[${text}]`;
        return span;
    }

    function appendDiscMetaToHeadings(durationInfo, catalogInfo) {
        const hasDurationForHeadings = shouldUseDurationOnHeadings(durationInfo, catalogInfo);
        const hasCatalogMulti = !!catalogInfo.hasMulti;

        // 两边都没有可用于标题的信息，就不用处理
        if (!hasDurationForHeadings && !hasCatalogMulti) return;
        const discHeads = getDiscHeadingNodes();
        if (!discHeads.length) return;

        discHeads.forEach((li) => {
            if (li.dataset.bgmDiscMetaEnhanced === '1') return;

            const disc = normalizeDiscLabel(li.textContent || '');
            if (!/^DISC \d+$/.test(disc)) return;

            const duration = hasDurationForHeadings ? durationInfo.map.get(disc) : '';
            const catalog = hasCatalogMulti ? catalogInfo.map.get(disc) : '';

            // 当前这个 Disc 两边都没有数据，就跳过
            if (!duration && !catalog) return;

            const wrap = document.createElement('span');
            wrap.className = 'bgm-disc-meta-wrap';

            // 先放品番，再放时长
            if (catalog) {
                wrap.appendChild(createBadge('catalog', catalog));
            }

            if (duration) {
                wrap.appendChild(createBadge('duration', duration));
            }

            li.appendChild(wrap);
            li.dataset.bgmDiscMetaEnhanced = '1';
        });
    }

    function makePopover(entries) {
        const popover = document.createElement('div');
        popover.className = 'bgm-disc-popover';

        entries.forEach(({ disc, value }) => {
            const row = document.createElement('div');
            row.className = 'bgm-disc-popover-row';

            const key = document.createElement('div');
            key.className = 'bgm-disc-popover-key';
            key.textContent = disc;

            const val = document.createElement('div');
            val.className = 'bgm-disc-popover-value';
            val.textContent = value;

            row.appendChild(key);
            row.appendChild(val);
            popover.appendChild(row);
        });

        return popover;
    }

    function bindPopover(host, trigger, popover) {
        let hideTimer = null;
        let pinned = false;

        function show() {
            if (hideTimer) {
                clearTimeout(hideTimer);
                hideTimer = null;
            }
            popover.classList.add('visible');
        }

        function hideSoon() {
            if (pinned) return;
            hideTimer = setTimeout(() => {
                popover.classList.remove('visible');
            }, 120);
        }

        host.addEventListener('mouseenter', show);
        host.addEventListener('mouseleave', hideSoon);

        trigger.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            pinned = !pinned;
            if (pinned) {
                show();
            } else {
                popover.classList.remove('visible');
            }
        });

        document.addEventListener('click', (e) => {
            if (!host.contains(e.target)) {
                pinned = false;
                popover.classList.remove('visible');
            }
        }, true);
    }

    function enhanceInfoboxSection(info, type) {
        if (!info.section || !info.hasMulti) return;
        if (info.section.dataset.bgmDiscSectionEnhanced === '1') return;

        const entries = Array.from(info.map.entries()).map(([disc, value]) => ({ disc, value }));
        if (entries.length < 2) return;

        const section = info.section;
        section.dataset.bgmDiscSectionEnhanced = '1';
        section.classList.add('bgm-disc-infobox-host');

        // 隐藏原有多 DISC 子项
        info.subs.forEach((li) => {
            li.style.display = 'none';
        });

        let summaryMain = '';
        if (type === 'duration') {
            const totalSeconds = entries
                .map((item) => parseDurationSeconds(item.value))
                .filter((v) => v != null)
                .reduce((sum, v) => sum + v, 0);
            const computed = formatSecondsToHHMMSS(totalSeconds);

            // 主行本来有值时（多级形态的第一行就是总时长，会渲染在主行上）：
            // 与我们算出的总时长相同就不再重复显示一遍，否则会出现两个一样的数字。
            // 不同则保留两者（主行是条目自己写的值，摘要是按各碟算出来的）。
            summaryMain = normalizeDurationText(info.mainValue) === computed ? '' : computed;
        } else if (type === 'catalog') {
            // 品番主值通常已经在 section 主行里显示了
            // 这里不要再重复追加一次
            summaryMain = '';
        }

        const summary = document.createElement('span');
        summary.className = 'bgm-disc-summary';

        // 主行有值（品番 / 播放时长的总时长）或要接「N Disc / 详情」摘要，都补一个空格分隔
        section.appendChild(document.createTextNode(' '));

        if (summaryMain) {
            const main = document.createElement('span');
            main.className = 'bgm-disc-summary-main';
            main.textContent = summaryMain;
            summary.appendChild(main);
        }

        const count = document.createElement('span');
        count.className = 'bgm-disc-summary-count';
        count.textContent = `${entries.length} Disc`;
        summary.appendChild(count);

        const trigger = document.createElement('span');
        trigger.className = 'bgm-disc-detail-trigger';
        trigger.textContent = '详情';
        summary.appendChild(trigger);

        const popover = makePopover(entries);

        section.appendChild(summary);
        section.appendChild(popover);

        bindPopover(section, trigger, popover);
    }

    /* ----------------时长显示---------------- */
    function collectHomeEpItems() {
        const items = [];

        const listItems = document.querySelectorAll(
            '.subject_ep_section.clearit .line_list_music li.line_odd, ' +
            '.subject_ep_section.clearit .line_list_music li.line_even'
        );

        for (const li of listItems) {
            const epLink = li.querySelector('h6 a[href^="/ep/"]');
            const cite = li.querySelector('cite');

            if (!epLink || !cite) continue;

            const epId = getEpIdFromHref(epLink.getAttribute('href'));
            if (!epId) continue;

            items.push({
                epId,
                li,
                cite,
                epLink
            });
        }

        return items;
    }

    async function fetchDurationMapFromSubjectEpPage(subjectId) {
        const url = `/subject/${subjectId}/ep`;

        try {
            const response = await fetch(url, {
                credentials: 'same-origin'
            });

            if (!response.ok) return new Map();

            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');

            return parseDurationMapFromEpPage(doc);
        } catch (error) {
            console.warn('[Bangumi EP Duration] 获取曲目页失败:', error);
            return new Map();
        }
    }

    function parseDurationMapFromEpPage(doc) {
        const map = new Map();

        const listItems = doc.querySelectorAll(
            '.line_detail .line_list li.line_odd, ' +
            '.line_detail .line_list li.line_even'
        );

        for (const li of listItems) {
            const epLink = li.querySelector('h6 a[href^="/ep/"]');
            if (!epLink) continue;

            const epId = getEpIdFromHref(epLink.getAttribute('href'));
            if (!epId) continue;

            const duration = extractDurationFromListItem(li);
            if (!duration) continue;

            map.set(epId, duration);
        }

        return map;
    }

    function extractDurationFromListItem(li) {
        const cite = li.querySelector('cite');
        if (!cite) return '';

        // 曲目页里通常是：
        // <small class="grey">时长:02:31 / </small>
        const smalls = cite.querySelectorAll('small.grey');

        for (const small of smalls) {
            const duration = extractDurationFromText(small.textContent);
            if (duration) return duration;
        }

        // 兜底：有些页面结构如果变化，就从整个 cite 文本里找
        return extractDurationFromText(cite.textContent);
    }

    function extractDurationFromText(text) {
        if (!text) return '';

        const normalized = text.replace(/\s+/g, '');

        // 支持：
        // 时长:02:31
        // 时长：02:31
        // 时长:1:02:31
        const match = normalized.match(/时长[:：]((?:\d{1,2}:)?\d{1,2}:\d{2})/);

        return match ? match[1] : '';
    }

    function renderDurations(epItems, durationMap) {
        for (const item of epItems) {
            const duration = durationMap.get(item.epId);
            if (!duration) continue;

            // 避免重复插入
            if (item.cite.querySelector(`.${DURATION_CLASS}`)) continue;

            const span = document.createElement('small');
            span.className = `grey ${DURATION_CLASS}`;
            span.textContent = `时长:${duration} / `;

            item.cite.insertBefore(span, item.cite.firstChild);
        }
    }

    function getEpIdFromHref(href) {
        if (!href) return '';

        const match = href.match(/\/ep\/(\d+)/);
        return match ? match[1] : '';
    }
    /* ----------------时长显示---------------- */

    async function enhance() {
        if (!isSubjectPage()) return;
        if (!isLikelyMusicSubjectPage()) return;

        ensureStyle();

        const durationInfo = collectDiscMap('播放时长', 'duration');
        const inferredDiscCount = Math.max(durationInfo.map.size, getDiscHeadingCount());
        const catalogInfo = collectCatalogInfo(inferredDiscCount);

        enhanceInfoboxSection(durationInfo, 'duration');
        enhanceInfoboxSection(catalogInfo, 'catalog');
        appendDiscMetaToHeadings(durationInfo, catalogInfo);

        /* ----------------时长显示---------------- */
        const epItems = collectHomeEpItems();
        if (!epItems.length) return;

        const subjectId = getSubjectId();
        if (!subjectId) return;

        const durationMap = await fetchDurationMapFromSubjectEpPage(subjectId);
        if (!durationMap || durationMap.size === 0) return;

        renderDurations(epItems, durationMap);
        /* ----------------时长显示---------------- */
    }

    function init() {
        enhance();

        const observer = new MutationObserver(() => {
            enhance();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();