// ==UserScript==
// @name         SportAdmin Activity Helper
// @namespace    https://kansli.sportadmin.se/
// @version      2026.05.2
// @description  Adds auto-detected year buttons to quickly select/deselect participants by birth year in the activity list.
// @author       Mikael Frid
// @match        https://admin.sportadmin.se/callings/edit*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=sportadmin.se
// @homepageURL  https://github.com/frimik/tampermonkey-sportadmin-helper
// @supportURL   https://github.com/frimik/tampermonkey-sportadmin-helper/issues
// @updateURL    https://frimik.github.io/tampermonkey-sportadmin-helper/sportadmin-helper.user.js
// @downloadURL  https://frimik.github.io/tampermonkey-sportadmin-helper/sportadmin-helper.user.js
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    panelId: "sa-activity-helper-panel",
    yearsWrapId: "sa-activity-helper-years",
    debounceMs: 250,
    minAllowedYear: 1900,
    maxAllowedYear: 2099,
    logPrefix: "[SA Helper]",
    logLevel: "debug",
  };

  const state = {
    refreshTimer: null,
    observer: null,
    actionSeq: 0,
    yearButtonMap: new Map(),
    lastPointerActivationByButton: new WeakMap(),
  };

  const LOG_LEVEL = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
  };

  function shouldLog(level) {
    const current = LOG_LEVEL[CONFIG.logLevel] ?? LOG_LEVEL.info;
    const incoming = LOG_LEVEL[level] ?? LOG_LEVEL.info;
    return incoming <= current;
  }

  function log(level, message, meta) {
    if (!shouldLog(level)) return;
    const timestamp = new Date().toISOString();
    const prefix = `${CONFIG.logPrefix} ${timestamp} ${level.toUpperCase()}`;

    if (meta !== undefined) {
      console[level](`${prefix} ${message}`, meta);
    } else {
      console[level](`${prefix} ${message}`);
    }
  }

  function beginAction(action, meta) {
    state.actionSeq += 1;
    const actionId = state.actionSeq;
    log("info", `click registered: ${action}`, { actionId, ...meta });
    return actionId;
  }

  function isInsideHelperPanel(node) {
    if (!(node instanceof Element)) return false;
    return node.closest(`#${CONFIG.panelId}`) !== null;
  }

  function shouldHandleActivation(button, event) {
    if (!button || button.disabled) {
      return false;
    }

    if (event.type === "pointerdown") {
      const isPrimaryPointer = event.isPrimary !== false;
      const isMainButton = event.button === 0;
      if (!isPrimaryPointer || !isMainButton) {
        log("debug", "pointerdown ignored (not primary/main)", {
          isPrimaryPointer,
          button: event.button,
        });
        return false;
      }

      const now = performance.now();
      state.lastPointerActivationByButton.set(button, now);
      log("debug", "pointerdown activation accepted", {
        year: button.dataset?.year,
      });
      return true;
    }

    if (event.type === "click") {
      // Keyboard-originated click has detail=0; keep those for accessibility.
      if (event.detail === 0) {
        log("debug", "keyboard click accepted", {
          year: button.dataset?.year,
        });
        return true;
      }

      const lastPointerTs =
        state.lastPointerActivationByButton.get(button) ?? Number.NEGATIVE_INFINITY;
      const elapsedMs = performance.now() - lastPointerTs;
      if (elapsedMs >= 0 && elapsedMs < 700) {
        log("debug", "click ignored as duplicate after pointerdown", {
          year: button.dataset?.year,
          elapsedMs,
        });
        return false;
      }

      log("debug", "mouse click accepted", {
        year: button.dataset?.year,
        elapsedMs,
      });
      return true;
    }

    return false;
  }

  function isValidYear(year) {
    return (
      Number.isInteger(year) &&
      year >= CONFIG.minAllowedYear &&
      year <= CONFIG.maxAllowedYear
    );
  }

  function findActivityTable() {
    const tables = Array.from(document.querySelectorAll("table.idealis-table"));
    log("debug", "findActivityTable scanned tables", { count: tables.length });
    for (const table of tables) {
      if (table.querySelector("tbody tr.normal-row")) {
        log("debug", "findActivityTable matched table with normal-row");
        return table;
      }
    }
    if (tables[0]) {
      log("debug", "findActivityTable falling back to first idealis-table");
    } else {
      log("debug", "findActivityTable found no table");
    }
    return tables[0] || null;
  }

  function getRows(table) {
    if (!table) return [];
    const tbody = table.querySelector("tbody");
    if (!tbody) return [];

    const rows = [];
    let currentSection = "";

    for (const tr of Array.from(tbody.querySelectorAll("tr"))) {
      const sectionCell = tr.querySelector("td[colspan]");
      if (sectionCell) {
        currentSection = (sectionCell.textContent || "").trim().toLowerCase();
        log("debug", "section switched", { currentSection });
        continue;
      }

      if (!tr.classList.contains("normal-row")) continue;
      if (currentSection.includes("ledare")) continue;

      rows.push(tr);
    }

    log("debug", "rows collected", { count: rows.length });
    return rows;
  }

  function getRowEntry(row) {
    const cells = row.querySelectorAll("td");
    if (cells.length < 2) return null;

    const yearText = (cells[1].textContent || "").trim();
    if (!/^\d{4}$/.test(yearText)) return null;

    const year = Number(yearText);
    if (!isValidYear(year)) return null;

    const checkbox = row.querySelector(
      "td.selectable-checkbox input.form-check-input[type='checkbox']"
    );
    if (!checkbox || checkbox.disabled) return null;

    return { checkbox, year, row };
  }

  function collectEntriesByYear(table) {
    const map = new Map();
    const rows = getRows(table);

    for (const row of rows) {
      const entry = getRowEntry(row);
      if (!entry) continue;
      if (!map.has(entry.year)) {
        map.set(entry.year, []);
      }
      map.get(entry.year).push(entry);
    }

    log("debug", "entries grouped by year", {
      years: Array.from(map.keys()).sort((a, b) => a - b),
      rowCount: rows.length,
    });
    return map;
  }

  function setChecked(checkbox, checked) {
    if (checkbox.checked === checked) {
      log("debug", "setChecked skipped (already target state)", {
        target: checked,
      });
      return;
    }

    log("debug", "setChecked applying", {
      from: checkbox.checked,
      to: checked,
    });
    checkbox.checked = checked;

    // Trigger framework/listeners that rely on events.
    checkbox.dispatchEvent(new Event("input", { bubbles: true }));
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function selectYear(entriesByYear, year, checked) {
    const entries = entriesByYear.get(year) || [];
    log("debug", "selectYear start", {
      year,
      checked,
      entries: entries.length,
    });
    for (const entry of entries) {
      setChecked(entry.checkbox, checked);
    }
    log("debug", "selectYear done", { year, checked });
  }

  function toggleYear(entriesByYear, year) {
    const entries = entriesByYear.get(year) || [];
    if (entries.length === 0) return;

    const allChecked = entries.every((e) => e.checkbox.checked);
    const target = !allChecked;

    log("debug", "toggleYear start", {
      year,
      entries: entries.length,
      allChecked,
      target,
    });

    for (const entry of entries) {
      setChecked(entry.checkbox, target);
    }

    log("debug", "toggleYear done", { year, target });
  }

  function selectAllVisible(table, checked) {
    log("debug", "selectAllVisible start", { checked });
    for (const row of getRows(table)) {
      const entry = getRowEntry(row);
      if (!entry) continue;
      setChecked(entry.checkbox, checked);
    }
    log("debug", "selectAllVisible done", { checked });
    refreshUI();
  }

  function createButton(label, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    if (typeof onClick === "function") {
      btn.addEventListener("pointerdown", (event) => {
        if (!shouldHandleActivation(btn, event)) return;
        event.preventDefault();
        onClick(event);
      });

      btn.addEventListener("click", (event) => {
        if (!shouldHandleActivation(btn, event)) return;
        onClick(event);
      });
    }
    btn.style.border = "1px solid #c9d2df";
    btn.style.background = "#f7f9fc";
    btn.style.color = "#1d2a3a";
    btn.style.padding = "6px 8px";
    btn.style.borderRadius = "8px";
    btn.style.fontSize = "12px";
    btn.style.cursor = "pointer";
    btn.style.whiteSpace = "nowrap";
    return btn;
  }

  function createYearButton(year) {
    const btn = createButton("", null);
    btn.dataset.year = String(year);
    btn.title = `Click to toggle ${year}. Shift+click selects all, Alt+click deselects all.`;
    return btn;
  }

  function applyYearButtonState(btn, year, total, selected) {
    btn.textContent = `${year} (${selected}/${total})`;
    btn.disabled = total === 0;
    btn.style.opacity = total === 0 ? "0.5" : "1";

    if (total > 0 && selected === total) {
      btn.style.background = "#d8f3dc"; // all selected
      btn.style.borderColor = "#95d5b2";
    } else if (selected > 0) {
      btn.style.background = "#fff4cc"; // partially selected
      btn.style.borderColor = "#f0d27a";
    } else {
      btn.style.background = "#f7f9fc"; // none selected
      btn.style.borderColor = "#c9d2df";
    }
  }

  function handleYearButtonClick(event) {
    const rawTarget = event.target;
    if (!(rawTarget instanceof Element)) return;

    const button = rawTarget.closest("button[data-year]");
    if (!button) return;

    if (!shouldHandleActivation(button, event)) return;
    if (event.type === "pointerdown") {
      event.preventDefault();
    }

    const year = Number(button.dataset.year);
    if (!Number.isInteger(year)) return;

    const actionId = beginAction("year button click", {
      year,
      eventType: event.type,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    });

    const freshTable = findActivityTable();
    if (!freshTable) {
      log("warn", "year click aborted (table missing)", {
        actionId,
        year,
      });
      return;
    }

    const freshEntriesByYear = collectEntriesByYear(freshTable);
    if (event.shiftKey) {
      log("debug", "year click selecting", { actionId, year });
      selectYear(freshEntriesByYear, year, true);
    } else if (event.altKey) {
      log("debug", "year click deselecting", { actionId, year });
      selectYear(freshEntriesByYear, year, false);
    } else {
      log("debug", "year click toggling", { actionId, year });
      toggleYear(freshEntriesByYear, year);
    }

    refreshUI();
  }

  function buildPanel() {
    if (document.getElementById(CONFIG.panelId)) {
      log("debug", "buildPanel skipped (already exists)");
      return;
    }

    const table = findActivityTable();
    if (!table) {
      log("debug", "buildPanel aborted (table not found)");
      return;
    }

    const panel = document.createElement("div");
    panel.id = CONFIG.panelId;

    panel.style.position = "sticky";
    panel.style.top = "8px";
    panel.style.zIndex = "10";
    panel.style.margin = "8px 0";
    panel.style.padding = "10px";
    panel.style.border = "1px solid #dbe2ea";
    panel.style.borderRadius = "10px";
    panel.style.background = "linear-gradient(135deg, #ffffff 0%, #f4f8ff 100%)";
    panel.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.08)";
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.gap = "8px";

    const title = document.createElement("div");
    title.textContent = "Activity Helper: Birth year quick-select";
    title.style.fontWeight = "600";
    title.style.fontSize = "13px";
    title.style.color = "#10243a";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.flexWrap = "wrap";
    actions.style.gap = "6px";

    actions.appendChild(
      createButton("Select all visible", () => {
        const actionId = beginAction("select all visible", {});
        const t = findActivityTable();
        if (!t) {
          log("warn", "select all visible aborted (table missing)", { actionId });
          return;
        }
        log("debug", "select all visible executing", { actionId });
        selectAllVisible(t, true);
      })
    );
    actions.appendChild(
      createButton("Deselect all visible", () => {
        const actionId = beginAction("deselect all visible", {});
        const t = findActivityTable();
        if (!t) {
          log("warn", "deselect all visible aborted (table missing)", {
            actionId,
          });
          return;
        }
        log("debug", "deselect all visible executing", { actionId });
        selectAllVisible(t, false);
      })
    );
    actions.appendChild(
      createButton("Refresh", () => {
        const actionId = beginAction("manual refresh", {});
        log("debug", "manual refresh executing", { actionId });
        refreshUI();
      })
    );

    const yearsWrap = document.createElement("div");
    yearsWrap.id = CONFIG.yearsWrapId;
    yearsWrap.style.display = "flex";
    yearsWrap.style.flexWrap = "wrap";
    yearsWrap.style.gap = "6px";
    yearsWrap.addEventListener("pointerdown", handleYearButtonClick);
    yearsWrap.addEventListener("click", handleYearButtonClick);

    panel.appendChild(title);
    panel.appendChild(actions);
    panel.appendChild(yearsWrap);

    if (table.parentElement) {
      table.parentElement.insertBefore(panel, table);
    } else {
      document.body.prepend(panel);
    }

    log("debug", "panel built and inserted");
  }

  function refreshUI() {
    log("debug", "refreshUI start");
    const table = findActivityTable();
    if (!table) {
      log("debug", "refreshUI aborted (table missing)");
      return;
    }

    const panel = document.getElementById(CONFIG.panelId);
    if (!panel) {
      buildPanel();
    }

    const yearsWrap = document.getElementById(CONFIG.yearsWrapId);
    if (!yearsWrap) {
      log("debug", "refreshUI aborted (yearsWrap missing)");
      return;
    }

    const entriesByYear = collectEntriesByYear(table);
    const years = Array.from(entriesByYear.keys()).sort((a, b) => a - b);
    log("debug", "refreshUI years prepared", { years });

    const existingButtons = new Map();
    for (const btn of Array.from(yearsWrap.querySelectorAll("button[data-year]"))) {
      const y = Number(btn.dataset.year);
      if (Number.isInteger(y)) {
        existingButtons.set(y, btn);
      }
    }

    state.yearButtonMap = existingButtons;

    for (const y of years) {
      const entries = entriesByYear.get(y) || [];
      const total = entries.length;
      const selected = entries.reduce(
        (acc, item) => acc + (item.checkbox.checked ? 1 : 0),
        0
      );

      let btn = existingButtons.get(y);
      if (!btn) {
        btn = createYearButton(y);
        yearsWrap.appendChild(btn);
        log("debug", "year button created", { year: y });
      }

      applyYearButtonState(btn, y, total, selected);
      existingButtons.delete(y);

      // Keep visual order stable without replacing entire container.
      yearsWrap.appendChild(btn);
    }

    for (const [staleYear, staleBtn] of existingButtons) {
      log("debug", "year button removed", { year: staleYear });
      staleBtn.remove();
    }

    state.yearButtonMap = new Map(
      Array.from(yearsWrap.querySelectorAll("button[data-year]")).map((btn) => [
        Number(btn.dataset.year),
        btn,
      ])
    );

    log("debug", "refreshUI done", { yearButtonCount: years.length });
  }

  function scheduleRefresh() {
    log("debug", "scheduleRefresh requested", { debounceMs: CONFIG.debounceMs });
    if (state.refreshTimer) {
      log("debug", "scheduleRefresh skipped (already scheduled)");
      return;
    }

    state.refreshTimer = window.setTimeout(() => {
      state.refreshTimer = null;
      refreshUI();
    }, CONFIG.debounceMs);
  }

  function setupObserver() {
    if (state.observer) {
      log("debug", "setupObserver skipped (already set)");
      return;
    }

    state.observer = new MutationObserver((mutationList) => {
      let hasRelevantMutation = false;

      for (const mutation of mutationList) {
        if (!isInsideHelperPanel(mutation.target)) {
          hasRelevantMutation = true;
          break;
        }

        for (const node of Array.from(mutation.addedNodes || [])) {
          if (!isInsideHelperPanel(node)) {
            hasRelevantMutation = true;
            break;
          }
        }
        if (hasRelevantMutation) break;

        for (const node of Array.from(mutation.removedNodes || [])) {
          if (!isInsideHelperPanel(node)) {
            hasRelevantMutation = true;
            break;
          }
        }
        if (hasRelevantMutation) break;
      }

      if (!hasRelevantMutation) {
        log("debug", "observer mutation ignored (helper panel internal changes)");
        return;
      }

      log("debug", "observer mutation callback triggered", {
        mutationCount: mutationList.length,
      });
      // Rebuild panel if SPA navigation replaced major parts of DOM.
      if (!document.getElementById(CONFIG.panelId)) {
        log("debug", "observer rebuilding missing panel");
        buildPanel();
      }
      scheduleRefresh();
    });

    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
    });

    log("debug", "observer initialized");
  }

  function init() {
    log("info", "initializing script");
    buildPanel();
    refreshUI();
    setupObserver();

    // Extra safety for apps that re-render without obvious mutation timing.
    window.addEventListener("focus", scheduleRefresh);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        scheduleRefresh();
      }
    });

    log("info", "script initialization complete");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // TODO (future): team-based virtual groups can be added by extracting team labels
  // from each row and creating an additional section of group toggle buttons.
})();
