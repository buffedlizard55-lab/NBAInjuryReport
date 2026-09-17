/* Live injury wire — the chat-style stream.
 *
 * Every layer (structured ESPN injury board, ESPN news, Bluesky social posts,
 * in-game absences, official-report links) pushes normalized items into ONE
 * reverse-chronological stream, so a human can watch injuries land in real time
 * the way Basketball Monster's player-news page reads.
 *
 * Item shape:
 *   { key, ts, sev, sevLabel, layer, text, detail, url, extraUrl, team, player, source }
 * `layer` is one of: "espn-board" | "espn-news" | "social" | "in-game"
 */
"use strict";

const Wire = (() => {
  const MAX = 300;
  let items = [];
  const seen = new Set();

  const LAYER_LABEL = {
    "espn-board": "ESPN injury board",
    "espn-news": "ESPN news",
    "social": "Social (Bluesky)",
    "in-game": "In-game",
    "official": "Official NBA"
  };

  function push(item) {
    if (!item || !item.key) return false;
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    items.push(Object.assign({ ts: new Date().toISOString(), sev: "mention" }, item));
    items.sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0));
    if (items.length > MAX) items = items.slice(0, MAX);
    return true;
  }

  function matches(item, f) {
    if (!f) return true;
    const teamOk = (f.team === "ALL") || (item.team && f.team === item.team);
    const sevOk = !!f.sevs[item.sev];
    return teamOk && sevOk;
  }

  function render(flashKeys) {
    const el = document.getElementById("wire");
    const countEl = document.getElementById("wireCount");
    if (!el) return;
    const f = (typeof App !== "undefined" && App.getFilters) ? App.getFilters() : null;
    const flash = new Set(flashKeys || []);
    const shown = items.filter(i => matches(i, f));
    if (countEl) countEl.textContent = `${shown.length} shown · ${items.length} captured this session`;

    if (!shown.length) {
      el.innerHTML = `<div class="muted">Nothing matches the current filters yet.
        ${items.length ? "Try enabling more severities or switching the team filter to <b>All teams</b>." :
        "The wire fills automatically from ESPN's structured injury board, ESPN news, and the verified Bluesky accounts — first refresh seeds it, then new items appear as they land."}</div>`;
      return;
    }
    el.innerHTML = shown.slice(0, 120).map(i => {
      const when = i.ts ? new Date(i.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--";
      const day = i.ts ? new Date(i.ts).toLocaleDateString() : "";
      const links = [];
      if (i.url) links.push(`<a href="${AlertEngine.escapeHtml(i.url)}" target="_blank" rel="noopener">source ↗</a>`);
      if (i.extraUrl) links.push(`<a href="${AlertEngine.escapeHtml(i.extraUrl)}" target="_blank" rel="noopener">player page ↗</a>`);
      if (i.team && typeof xSearchUrl === "function" && typeof teamByAbbr === "function") {
        const t = teamByAbbr(i.team);
        links.push(`<a href="${xSearchUrl((i.player ? i.player + " " : "") + (t ? t.city + " " + t.name : i.team) + " injury")}" target="_blank" rel="noopener">confirm on X ↗</a>`);
      }
      return `<div class="wire-item sev-${i.sev}${flash.has(i.key) ? " flash" : ""}">
        <div class="wire-meta">
          <span class="tag ${i.sev}">${AlertEngine.escapeHtml(i.sevLabel || i.sev.toUpperCase())}</span>
          <span class="badge dim">${AlertEngine.escapeHtml(LAYER_LABEL[i.layer] || i.layer || "feed")}</span>
          ${i.team ? `<span class="team-chip">${AlertEngine.escapeHtml(i.team)}</span>` : ""}
          <span title="${AlertEngine.escapeHtml(day)}">${AlertEngine.escapeHtml(when)}</span>
          ${i.source ? `<span>· ${AlertEngine.escapeHtml(i.source)}</span>` : ""}
        </div>
        <div class="wire-title">${AlertEngine.escapeHtml(i.text)}</div>
        ${i.detail ? `<p class="wire-desc">${AlertEngine.escapeHtml(i.detail)}</p>` : ""}
        ${links.length ? `<div class="wire-links">${links.join("")}</div>` : ""}
      </div>`;
    }).join("");
  }

  function clear() { items = []; seen.clear(); render([]); }
  function all() { return items; }

  return { push, render, clear, all, LAYER_LABEL };
})();
