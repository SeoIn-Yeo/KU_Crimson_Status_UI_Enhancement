// ==UserScript==
// @name         School Portal Status Table Enhancer
// @namespace    https://sejong.korea.ac.kr/
// @version      1.0.0
// @description  Improve readability of a school portal status table with badges, highlighting, and status-based sorting.
// @match        https://sejong.korea.ac.kr/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(() => {
    "use strict";

    const STORAGE_KEY = "school-portal-status-table-enhancer-enabled";
    const TOOLBAR_CLASS = "sbe-toolbar";
    const BADGE_CLASS = "sbe-badge";
    const CELL_CLASS = "sbe-cell";
    const ROW_CLASS = "sbe-row";

    const STATUS = {
        approved: { key: "approved", label: "승인", order: 0, fg: "#b54b73", bg: "#ffd8e6", border: "#f3a8c3" },
        pending: { key: "pending", label: "대기중", order: 1, fg: "#92400e", bg: "#fde2a7", border: "#f2bd4f" },
        rejected: { key: "rejected", label: "반려", order: 2, fg: "#374151", bg: "#d8dde6", border: "#aeb7c4" },
        unknown: { key: "unknown", label: "기타", order: 3, fg: "#475569", bg: "#e2e8f0", border: "#cbd5e1" }
    };

    let suppressObserver = false;
    let runTimer = null;

    function addStyle(css) {
        if (typeof GM_addStyle === "function") {
            GM_addStyle(css);
            return;
        }

        const style = document.createElement("style");
        style.textContent = css;
        document.head.appendChild(style);
    }

    addStyle(`
        .${TOOLBAR_CLASS} {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            flex-wrap: wrap;
            margin: 0 0 16px;
            padding: 14px 16px;
            border: 1px solid #d7e0ea;
            border-radius: 14px;
            background: linear-gradient(135deg, #f8fbff 0%, #f1f5f9 100%);
        }

        .${TOOLBAR_CLASS} .summary {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }

        .${TOOLBAR_CLASS} .chip,
        .${CELL_CLASS} .${BADGE_CLASS} {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 6px 12px;
            border-radius: 999px;
            border: 1px solid transparent;
            font-weight: 700;
            line-height: 1.2;
            white-space: nowrap;
        }

        .${TOOLBAR_CLASS} .chip::before {
            content: "";
            width: 10px;
            height: 10px;
            border-radius: 999px;
            background: currentColor;
            flex: none;
        }

        .${TOOLBAR_CLASS} .chip.approved,
        .${CELL_CLASS}.approved .${BADGE_CLASS} {
            color: ${STATUS.approved.fg};
            background: ${STATUS.approved.bg};
            border-color: ${STATUS.approved.border};
        }

        .${TOOLBAR_CLASS} .chip.pending,
        .${CELL_CLASS}.pending .${BADGE_CLASS} {
            color: ${STATUS.pending.fg};
            background: ${STATUS.pending.bg};
            border-color: ${STATUS.pending.border};
        }

        .${TOOLBAR_CLASS} .chip.rejected,
        .${CELL_CLASS}.rejected .${BADGE_CLASS} {
            color: ${STATUS.rejected.fg};
            background: ${STATUS.rejected.bg};
            border-color: ${STATUS.rejected.border};
        }

        .${TOOLBAR_CLASS} .toggle {
            appearance: none;
            border: 0;
            border-radius: 10px;
            background: #111827;
            color: #fff;
            padding: 10px 15px;
            font-size: 14px;
            font-weight: 700;
            cursor: pointer;
        }

        .${TOOLBAR_CLASS} .toggle[data-enabled="false"] {
            background: #64748b;
        }

        .${ROW_CLASS}.approved {
            box-shadow: inset 6px 0 0 ${STATUS.approved.fg};
            background: rgba(243, 168, 195, 0.34);
        }

        .${ROW_CLASS}.pending {
            box-shadow: inset 6px 0 0 #f59e0b;
            background: rgba(252, 211, 77, 0.34);
        }

        .${ROW_CLASS}.rejected {
            box-shadow: inset 6px 0 0 ${STATUS.rejected.fg};
            background: rgba(203, 213, 225, 0.5);
        }

        .${CELL_CLASS} {
            font-weight: 700 !important;
        }

        @media (max-width: 767px) {
            .${TOOLBAR_CLASS} .toggle {
                width: 100%;
            }
        }
    `);

    function textOf(value) {
        return (value || "").replace(/\s+/g, " ").trim();
    }

    function normalized(value) {
        return (value || "").replace(/\s+/g, "").trim();
    }

    function relevantPage() {
        const path = window.location.pathname;
        return /\/swuniv\/12697\/subview\.do$/i.test(path) || /\/crimson\/[^/]+\/.+\.do$/i.test(path);
    }

    function sortEnabled() {
        return window.localStorage.getItem(STORAGE_KEY) !== "false";
    }

    function setSortEnabled(value) {
        window.localStorage.setItem(STORAGE_KEY, String(value));
    }

    function classify(value) {
        const v = normalized(value);
        if (!v) {
            return STATUS.unknown;
        }

        if (/(반려|거절|미승인|불가)/.test(v)) {
            return STATUS.rejected;
        }

        if (/(대기|검토중|심사중|진행중|접수|확인중)/.test(v)) {
            return STATUS.pending;
        }

        if (/(승인|인정|처리완료|승인완료)/.test(v)) {
            return STATUS.approved;
        }

        return STATUS.unknown;
    }

    function candidateTables() {
        const tables = Array.from(document.querySelectorAll(".boardWrap table, .board-table, table"));
        return tables.filter((table) => {
            const headers = Array.from(table.querySelectorAll("thead th")).map((th) => textOf(th.textContent));
            if (headers.some((header) => /(승인여부|승인|상태|처리상태)/.test(header))) {
                return true;
            }

            const rows = Array.from(table.querySelectorAll("tbody tr"));
            return rows.some((row) => Array.from(row.cells).some((cell) => classify(cell.textContent).key !== STATUS.unknown.key));
        });
    }

    function statusColumnIndex(table, rows) {
        const headers = Array.from(table.querySelectorAll("thead tr:last-child th"));
        const byHeader = headers.findIndex((th) => /(승인여부|승인|상태|처리상태)/.test(textOf(th.textContent)));
        if (byHeader >= 0) {
            return byHeader;
        }

        const sample = rows.find((row) => row.cells.length > 0);
        if (!sample) {
            return -1;
        }

        return Array.from(sample.cells).findIndex((cell) => classify(cell.textContent).key !== STATUS.unknown.key);
    }

    function collectRows(table) {
        const body = table.tBodies[0];
        if (!body) {
            return [];
        }

        const rows = Array.from(body.rows).filter((row) => !row.querySelector(".no-data"));
        const index = statusColumnIndex(table, rows);

        return rows.map((row, originalIndex) => {
            if (!row.dataset.sbeOriginalIndex) {
                row.dataset.sbeOriginalIndex = String(originalIndex);
            }

            const cell = index >= 0 && row.cells[index]
                ? row.cells[index]
                : Array.from(row.cells).find((entry) => classify(entry.textContent).key !== STATUS.unknown.key) || null;

            const statusText = textOf(cell ? cell.textContent : "");
            const status = classify(statusText);

            return {
                row,
                cell,
                status,
                statusText: statusText || status.label,
                originalIndex: Number(row.dataset.sbeOriginalIndex)
            };
        });
    }

    function paintCell(info) {
        if (!info.cell || info.status.key === STATUS.unknown.key) {
            return;
        }

        info.cell.classList.remove("approved", "pending", "rejected");
        info.cell.classList.add(CELL_CLASS, info.status.key);

        if (!info.cell.querySelector("a, button, input, select, textarea")) {
            let badge = info.cell.querySelector(`.${BADGE_CLASS}`);
            if (!badge) {
                badge = document.createElement("span");
                badge.className = BADGE_CLASS;
                info.cell.replaceChildren(badge);
            }

            badge.textContent = info.statusText;
        }
    }

    function paintRow(info) {
        info.row.classList.remove(ROW_CLASS, "approved", "pending", "rejected");
        if (info.status.key === STATUS.unknown.key) {
            return;
        }

        info.row.classList.add(ROW_CLASS, info.status.key);
    }

    function renderToolbar(table, infos) {
        let toolbar = table.previousElementSibling;
        if (!toolbar || !toolbar.classList.contains(TOOLBAR_CLASS)) {
            toolbar = document.createElement("div");
            toolbar.className = TOOLBAR_CLASS;
            table.parentElement.insertBefore(toolbar, table);
        }

        const counts = { approved: 0, pending: 0, rejected: 0 };
        infos.forEach((info) => {
            if (counts[info.status.key] !== undefined) {
                counts[info.status.key] += 1;
            }
        });

        const summary = document.createElement("div");
        summary.className = "summary";
        summary.innerHTML = `
            <span class="chip approved">승인 ${counts.approved}</span>
            <span class="chip pending">대기중 ${counts.pending}</span>
            <span class="chip rejected">반려 ${counts.rejected}</span>
        `;

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "toggle";
        toggle.dataset.enabled = String(sortEnabled());
        toggle.textContent = sortEnabled() ? "원래 순서로 보기" : "상태순으로 정렬";
        toggle.addEventListener("click", () => {
            setSortEnabled(!sortEnabled());
            scheduleRun();
        });

        toolbar.replaceChildren(summary, toggle);
    }

    function reorder(table, infos) {
        const body = table.tBodies[0];
        if (!body) {
            return;
        }

        const ordered = [...infos].sort((a, b) => {
            if (sortEnabled() && a.status.order !== b.status.order) {
                return a.status.order - b.status.order;
            }

            return a.originalIndex - b.originalIndex;
        });

        ordered.forEach((info) => body.appendChild(info.row));
    }

    function enhanceTable(table) {
        const infos = collectRows(table);
        const matched = infos.filter((info) => info.status.key !== STATUS.unknown.key);
        if (!matched.length) {
            return;
        }

        infos.forEach((info) => {
            paintRow(info);
            paintCell(info);
        });

        renderToolbar(table, infos);
        reorder(table, infos);
    }

    function run() {
        if (!relevantPage()) {
            return;
        }

        suppressObserver = true;
        candidateTables().forEach(enhanceTable);

        window.setTimeout(() => {
            suppressObserver = false;
        }, 0);
    }

    function scheduleRun() {
        window.clearTimeout(runTimer);
        runTimer = window.setTimeout(run, 120);
    }

    const observer = new MutationObserver(() => {
        if (suppressObserver) {
            return;
        }

        scheduleRun();
    });

    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    } else {
        window.addEventListener("DOMContentLoaded", () => {
            observer.observe(document.body, { childList: true, subtree: true });
        }, { once: true });
    }

    window.addEventListener("load", scheduleRun, { once: true });
    window.setInterval(scheduleRun, 2000);
    scheduleRun();
})();
