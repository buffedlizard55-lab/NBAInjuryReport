/* =====================================================================================
 * wire.js — one merged, chat-style live stream
 *
 * Every layer pushes here: the structured injury board, the ESPN news classifier, the Bluesky
 * social layer and the in-game summary monitor. One stream in time order answers the only three
 * questions that matter in a hurry — what changed, when, and who reported it — and every row
 * keeps its layer badge plus a link to the original so nothing is asserted without a way to check.
 *
 * Layer labels are deliberately explicit about provenance ("ESPN injury board" vs "Social
 * (Bluesky)") so a reader can never mistake a social post for a league designation.
 * ===================================================================================== */
const Wire = (function () {
  const SEEN_KEY = "nba-wire-seen-v1";
  const MAX = 400;

  const LAYER_LABEL = {
    "official-nba": { text: "NBA official", cls: "board", title: "League PDF designation with game date" },
    "espn-board": { text: "ESPN injury board", cls: "board", title: "structured listing: status + injury + estimated return" },
    "espn-news": { text: "ESPN news", cls: "news", title: "ESPN news headline, classified" },
    "social": { text: "Social (Bluesky)", cls: "social", title: "post from a verified account on the allow-list" },
    "in-game": { text: "In-game (ESPN summary)", cls: "ingame", title: "live game summary: DNP reasons and injuries list" }
  };

  let items = [];

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
  };
  function loadSeen() { try { return new Set(JSON.parse(LS.get(SEEN_KEY, "[]")) || []); } catch (e) { return new Set(); } }
  function saveSeen(set) { LS.set(SEEN_KEY, JSON.stringify(Array.from(set).slice(-1500))); }

  /* push(): true when the key is new, false when it is a duplicate. A re-push that carries NEW
   * information (a status change under a stable key) updates in place and counts as new again. */
  function push(item) {
    if (!item || !item.key) return false;
    const normalized = {
      key: String(item.key),
      ts: item.ts || new Date().toISOString(),
      layer: item.layer || "espn-news",
      sev: item.sev || "mention",
      sevLabel: item.sevLabel || null,
      text: item.text || "",
      detail: item.detail || "",
      url: item.url || null,
      extraUrl: item.extraUrl || null,
      source: item.source || null,
      player: item.player || null,
      team: item.team || null
    };
    const i = items.findIndex(x => x.key === normalized.key);
    if (i < 0) {
      items.push(normalized);
      const seen = loadSeen();
      seen.delete(normalized.key);              // brand new → unread
      saveSeen(seen);
      if (items.length > MAX) items.splice(0, items.length - MAX);
      return true;
    }
    const before = items[i];
    const changed = before.sev !== normalized.sev || before.text !== normalized.text || before.detail !== normalized.detail;
    items[i] = normalized;
    if (changed) {
      const seen = loadSeen();
      seen.delete(normalized.key);
      saveSeen(seen);
      return true;
    }
    return false;
  }

  function pushMany(list) { let n = 0; for (const it of (list || [])) if (push(it)) n++; return n; }

  function all() { return items.slice(); }
  function clear() { items = []; saveSeen(new Set()); render(); }
  function markRead() { const seen = loadSeen(); for (const i of items) seen.add(i.key); saveSeen(seen); render(); }
  function counts() {
    const c = { total: items.length, unread: items.filter(i => !loadSeen().has(i.key)).length };
    for (const k of Object.keys(LAYER_LABEL)) c[k] = items.filter(i => i.layer === k).length;
    return c;
  }

  const esc = (typeof AlertEngine !== "undefined" && AlertEngine.escapeHtml)
    ? AlertEngine.escapeHtml
    : (s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));

  function ago(iso) {
    if (!iso) return "";
    const d = new Date(iso); if (isNaN(d)) return "";
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    return Math.round(hrs / 24) + "d ago";
  }
  function stamp(iso) {
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  /* filters is accepted as [] (the "render everything" call sites in app.js) or as the filter
   * object from App.getFilters(); an empty array means no filtering, not "hide everything". */
  function render(filters) {
    const box = document.getElementById("wire");
    if (!box) return;
    const arg = Array.isArray(filters) ? null : filters;
    const f = arg || ((typeof App !== "undefined" && App.getFilters) ? App.getFilters() : null);
    const seen = loadSeen();

    let rows = items.slice().sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0));
    if (f) {
      if (f.team && f.team !== "ALL") rows = rows.filter(r => r.team === f.team);
      if (f.sevs && typeof f.sevs === "object") rows = rows.filter(r => f.sevs[r.sev] !== false);
      if (f.query) {
        const q = String(f.query).toLowerCase();
        rows = rows.filter(r => (r.text + " " + (r.detail || "") + " " + (r.player || "") + " " + (r.source || "")).toLowerCase().indexOf(q) >= 0);
      }
    }

    const count = document.getElementById("wireCount");
    if (count) {
      const unread = rows.filter(r => !seen.has(r.key)).length;
      count.textContent = rows.length + (rows.length !== items.length ? " of " + items.length : "") + " items" + (unread ? " · " + unread + " new" : "");
    }
    if (!rows.length) {
      box.innerHTML = '<div class="empty">Nothing in the stream yet. It fills from the structured injury board, the ESPN news wire, the verified Bluesky accounts and the in-game monitor.</div>';
      return;
    }
    box.innerHTML = rows.map(r => {
      const L = LAYER_LABEL[r.layer] || { text: String(r.layer).toUpperCase(), cls: "news", title: "" };
      const isNew = !seen.has(r.key);
      return '<div class="wire-item ' + (isNew ? "is-new " : "") + 'sev-border-' + esc(r.sev) + '">' +
        '<div class="wire-line">' +
        '<span class="wire-dot sev-' + esc(r.sev) + '" title="' + esc(r.sevLabel || r.sev) + '"></span>' +
        '<span class="wire-layer ' + esc(L.cls) + '" title="' + esc(L.title) + '">' + esc(L.text) + '</span>' +
        (r.sevLabel ? '<span class="tag ' + esc(r.sev) + '">' + esc(r.sevLabel) + '</span>' : "") +
        (r.team ? '<span class="tag team">' + esc(r.team) + '</span>' : "") +
        '<span class="wire-ts tiny muted" title="' + esc(r.ts) + '">' + esc(ago(r.ts)) + '</span>' +
        '</div>' +
        (r.text ? '<div class="wire-text">' + esc(r.text) + '</div>' : "") +
        (r.detail ? '<div class="wire-detail tiny muted">' + esc(r.detail) + '</div>' : "") +
        '<div class="wire-foot tiny"><span class="muted">' + esc(stamp(r.ts)) + (r.source ? " · " + esc(r.source) : "") + '</span>' +
        (r.url ? ' · <a href="' + esc(r.url) + '" target="_blank" rel="noopener">source ↗</a>' : "") +
        (r.extraUrl ? ' · <a href="' + esc(r.extraUrl) + '" target="_blank" rel="noopener">player ↗</a>' : "") +
        '</div></div>';
    }).join("");
  }

  return { push: push, pushMany: pushMany, render: render, clear: clear, markRead: markRead, all: all, counts: counts, LAYER_LABEL: LAYER_LABEL };
})();
