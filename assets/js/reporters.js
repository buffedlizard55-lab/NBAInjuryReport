/* Reporters directory + forward-tracking reliability scorecard (localStorage). */
"use strict";

const Reporters = (() => {
  const LS_CALLS = "nba-reporter-calls-v1";

  function getCalls() {
    try { return JSON.parse(localStorage.getItem(LS_CALLS) || "[]"); }
    catch (e) { return []; }
  }
  function saveCalls(c) { localStorage.setItem(LS_CALLS, JSON.stringify(c)); }

  function statusBadge(r) {
    switch (r.status) {
      case "verified-handle": return `<span class="badge ok">✓ handle verified</span>`;
      case "outlet-only": return `<span class="badge warn">outlet verified · handle unverified</span>`;
      case "community": return `<span class="badge info">community-listed · re-confirm</span>`;
      case "inactive": return `<span class="badge dim">confirmed · inactive on X</span>`;
      case "retired": return `<span class="badge bad">retired · historical only</span>`;
      default: return "";
    }
  }
  function tierBadge(t) {
    return t === 1 ? `<span class="badge bad">TIER 1 · lead insider</span>`
      : t === 2 ? `<span class="badge warn">TIER 2 · national/beat</span>`
      : `<span class="badge dim">TIER 3 · analyst/other</span>`;
  }

  function xLink(r) {
    if (r.handle) return `<a href="https://x.com/${r.handle}" target="_blank" rel="noopener">@${r.handle} ↗</a>`;
    return `<a href="${xSearchUrl(r.name + " NBA")}" target="_blank" rel="noopener">search X ↗</a>`;
  }

  function renderTable(filter) {
    const el = document.getElementById("reporterTable");
    if (!el) return;
    const q = (filter.q || "").toLowerCase();
    const rows = REPORTERS.filter(r =>
      (filter.tier === "ALL" || String(r.tier) === filter.tier) &&
      (filter.status === "ALL" || r.status === filter.status) &&
      (!q || (r.name + " " + r.outlet + " " + r.role + " " + (r.handle || "")).toLowerCase().includes(q))
    );
    const counts = document.getElementById("repCount");
    if (counts) counts.textContent = `${rows.length} of ${REPORTERS.length} shown`;
    el.innerHTML = rows.map(r => `<tr>
      <td><b>${AlertEngine.escapeHtml(r.name)}</b><br><span class="tiny muted">${AlertEngine.escapeHtml(r.role)}</span></td>
      <td>${AlertEngine.escapeHtml(r.outlet)}${r.beat ? `<br><span class="team-chip">${r.beat}</span>` : ""}</td>
      <td>${tierBadge(r.tier)}</td>
      <td>${xLink(r)}</td>
      <td>${statusBadge(r)}<br><a class="tiny" href="${r.verifyUrl}" target="_blank" rel="noopener">verification ↗</a></td>
      <td class="tiny muted">${AlertEngine.escapeHtml(r.notes || "")}</td>
      <td data-score-for="${AlertEngine.escapeHtml(r.name)}" class="tiny"><span class="muted">—</span></td>
    </tr>`).join("");
    paintScores();
  }

  /* --- Scorecard --- */
  function pointsFor(outcome) {
    return { first_correct: 3, correct: 1, partial: 0.5, pending: 0, wrong: -2, fabricated: -5 }[outcome] ?? 0;
  }
  function scoreboard() {
    const calls = getCalls();
    const by = {};
    for (const c of calls) {
      by[c.reporter] = by[c.reporter] || { n: 0, pts: 0, correct: 0, wrong: 0, firsts: 0 };
      const s = by[c.reporter];
      s.n++; s.pts += pointsFor(c.outcome);
      if (c.outcome === "first_correct") { s.correct++; s.firsts++; }
      else if (c.outcome === "correct") s.correct++;
      else if (c.outcome === "wrong" || c.outcome === "fabricated") s.wrong++;
    }
    return Object.entries(by).map(([reporter, s]) => ({
      reporter, ...s, acc: (s.correct + s.wrong) ? (100 * s.correct / (s.correct + s.wrong)).toFixed(0) + "%" : "—"
    })).sort((a, b) => b.pts - a.pts);
  }
  function paintScores() {
    const board = Object.fromEntries(scoreboard().map(s => [s.reporter, s]));
    document.querySelectorAll("[data-score-for]").forEach(td => {
      const s = board[td.dataset.scoreFor];
      td.innerHTML = s ? `<b>${s.pts} pts</b><br><span class="muted">${s.n} calls · ${s.acc}</span>` : `<span class="muted">no calls logged</span>`;
    });
    const sb = document.getElementById("scoreboard");
    if (sb) {
      const rows = scoreboard();
      sb.innerHTML = rows.length ? rows.map((s, i) =>
        `<tr><td>${i + 1}</td><td><b>${AlertEngine.escapeHtml(s.reporter)}</b></td><td>${s.pts}</td>
         <td>${s.n}</td><td>${s.acc}</td><td>${s.firsts}</td></tr>`).join("")
        : `<tr><td colspan="6" class="muted">No calls logged yet. Use the form below the first time a tracked reporter posts injury news.</td></tr>`;
    }
    const log = document.getElementById("callsLog");
    if (log) {
      const calls = getCalls();
      log.innerHTML = calls.length ? calls.slice(0, 50).map(c =>
        `<div class="alert-entry"><time>${AlertEngine.escapeHtml(new Date(c.ts).toLocaleString())}</time>
         <b>${AlertEngine.escapeHtml(c.reporter)}</b> — ${AlertEngine.escapeHtml(c.player)}: ${AlertEngine.escapeHtml(c.claim)}
         [${AlertEngine.escapeHtml(c.outcome)} · ${pointsFor(c.outcome)} pts]
         ${c.url ? ` <a href="${AlertEngine.escapeHtml(c.url)}" target="_blank" rel="noopener">post ↗</a>` : ""}
         <button class="btn sm ghost" data-del="${c.id}" style="margin-left:8px">remove</button></div>`).join("")
        : `<div class="muted small">No logged calls yet.</div>`;
      log.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
        saveCalls(getCalls().filter(c => String(c.id) !== b.dataset.del));
        paintScores();
      }));
    }
  }

  function renderRubric() {
    const el = document.getElementById("rubric");
    if (!el) return;
    el.innerHTML = SCORING_RUBRIC.map(r =>
      `<tr><td><b>${r.outcome}</b></td><td><b>${r.points}</b></td><td class="muted">${r.desc}</td></tr>`).join("");
  }

  function buildForm() {
    const sel = document.getElementById("callReporter");
    if (!sel) return;
    sel.innerHTML = REPORTERS.filter(r => r.status !== "retired")
      .map(r => `<option value="${AlertEngine.escapeHtml(r.name)}">${AlertEngine.escapeHtml(r.name)} — ${AlertEngine.escapeHtml(r.outlet)}</option>`).join("");
    document.getElementById("callForm").addEventListener("submit", ev => {
      ev.preventDefault();
      const calls = getCalls();
      calls.unshift({
        id: Date.now(),
        ts: new Date().toISOString(),
        reporter: sel.value,
        player: document.getElementById("callPlayer").value.trim(),
        claim: document.getElementById("callClaim").value.trim(),
        url: document.getElementById("callUrl").value.trim(),
        outcome: document.getElementById("callOutcome").value
      });
      saveCalls(calls);
      ev.target.reset();
      paintScores();
      AlertEngine.log(`📝 Scored call: ${calls[0].reporter} on ${calls[0].player} [${calls[0].outcome}]`, calls[0].url || null);
    });
    const exp = document.getElementById("exportCalls");
    if (exp) exp.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(getCalls(), null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "reporter-scorecard.json";
      a.click();
      URL.revokeObjectURL(a.href);
    });
    const imp = document.getElementById("importCalls");
    const file = document.getElementById("importFile");
    if (imp && file) {
      imp.addEventListener("click", () => file.click());
      file.addEventListener("change", () => {
        const f = file.files[0];
        if (!f) return;
        const rd = new FileReader();
        rd.onload = () => {
          try {
            const data = JSON.parse(rd.result);
            if (!Array.isArray(data)) throw new Error("not an array");
            saveCalls(data.concat(getCalls()).slice(0, 1000));
            paintScores();
            alert("Imported " + data.length + " calls.");
          } catch (e) { alert("Import failed: " + e.message); }
        };
        rd.readAsText(f);
      });
    }
  }

  function init() {
    const filter = { tier: "ALL", status: "ALL", q: "" };
    renderTable(filter);
    renderRubric();
    buildForm();
    paintScores();
    const t = document.getElementById("tierFilter");
    const s = document.getElementById("statusFilter");
    const q = document.getElementById("repSearch");
    if (t) t.addEventListener("change", () => { filter.tier = t.value; renderTable(filter); });
    if (s) s.addEventListener("change", () => { filter.status = s.value; renderTable(filter); });
    if (q) q.addEventListener("input", () => { filter.q = q.value; renderTable(filter); });
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", () => Reporters.init());
