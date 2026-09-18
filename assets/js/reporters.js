/* Reporter directory + forward-tracking reliability scorecard.
 *
 * Two identity layers:
 *   1. X handles (the legacy directory) — verified in the first session, kept with their evidence links.
 *   2. Bluesky handles — verified live 2026-09-17 against the Bluesky public API
 *      (Bluesky's own verification objects + Howard Beck's curated 150-member NBA writers list).
 * Layer 2 is the one that can actually be polled automatically for free, so it feeds the live wire.
 *
 * Scoring is forward-collected and evidence-based: every logged call must carry the post URL.
 * "First" is only claimable once the GitHub Actions poller has timestamp history (see NEXT_STEPS.md).
 */
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
      case "citation-verified": return `<span class="badge ok">cited on the injury feed · no handle asserted</span>`;
      case "inactive": return `<span class="badge dim">confirmed · inactive on X</span>`;
      case "retired": return `<span class="badge bad">retired · historical only</span>`;
      default: return "";
    }
  }
  /* A citation row's evidence is the byline text itself, stored verbatim in data.js from the
   same ESPN snapshot the board renders. Show its tail so a reader can compare without opening anything. */
  const dataSnapshotUrl = "https://github.com/buffedlizard55-lab/NBAInjuryReport/blob/main/data/live/latest.json";
  function citeTail(r) {
    const t = String(r.citeText || "");
    const i = Math.max(t.lastIndexOf(". "), t.lastIndexOf("; "));
    return (i > 0 ? t.slice(i + 2) : t).slice(0, 150);
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
  function bskyFor(name) {
    const list = (typeof BSKY_REPORTERS !== "undefined") ? BSKY_REPORTERS : [];
    return list.find(b => b.name.toLowerCase() === String(name).toLowerCase());
  }
  function bskyCell(r) {
    const b = bskyFor(r.name);
    if (!b) return `<span class="tiny muted">—</span>`;
    return `<a href="https://bsky.app/profile/${b.handle}" target="_blank" rel="noopener">@${b.handle} ↗</a>` +
      (b.bskyVerified ? `<br><span class="badge ok">Bluesky-verified</span>` : `<br><span class="badge warn">no verification object</span>`) +
      `<br><span class="tiny muted"><a href="${b.evidence}" target="_blank" rel="noopener">evidence ↗</a></span>`;
  }

  function inArenaStatus(r) {
    const isArena = r.inArena === true || (r.beat && r.status !== "citation-verified" && r.status !== "retired");
    if (isArena) return `<span class="badge ok" title="Monitors games in-arena; can first report locker room trips &amp; exits">🏟️ In-arena live</span>`;
    if (r.status === "citation-verified") return `<span class="badge info" title="Cited in ESPN/RotoWire structured injury comments">📋 Wire citation</span>`;
    if (r.status === "retired" || r.status === "inactive") return `<span class="badge dim">⏳ Inactive</span>`;
    return `<span class="badge dim" title="National coverage &amp; intel desk">🏢 National desk</span>`;
  }

  let currentCategory = "ALL";

  function renderTable(filter) {
    const el = document.getElementById("reporterTable");
    if (!el) return;
    const q = (filter.q || "").toLowerCase();
    const rows = REPORTERS.filter(r => {
      if (filter.tier !== "ALL" && String(r.tier) !== filter.tier) return false;
      if (filter.status !== "ALL" && r.status !== filter.status) return false;

      const isArena = r.inArena === true || (r.beat && r.status !== "citation-verified" && r.status !== "retired");
      if (filter.inArena === "in-arena" && !isArena) return false;
      if (filter.inArena === "desk" && (isArena || r.status === "citation-verified")) return false;
      if (filter.inArena === "citation" && r.status !== "citation-verified") return false;

      if (currentCategory === "insider" && r.tier !== 1) return false;
      if (currentCategory === "arena" && !isArena && !r.beat) return false;
      if (currentCategory === "citation" && r.status !== "citation-verified") return false;
      if (currentCategory === "other" && r.status !== "community" && r.status !== "retired" && r.status !== "inactive") return false;

      if (q) {
        const hay = (r.name + " " + r.outlet + " " + r.role + " " + (r.beat || "") + " " + (r.handle || "") + " " + ((bskyFor(r.name) || {}).handle || "")).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const counts = document.getElementById("repCount");
    if (counts) counts.textContent = `${rows.length} of ${REPORTERS.length} shown`;
    const tot = document.getElementById("repTotalCount");
    if (tot) tot.textContent = REPORTERS.length;

    el.innerHTML = rows.map(r => `<tr>
      <td><b>${AlertEngine.escapeHtml(r.name)}</b><br><span class="tiny muted">${AlertEngine.escapeHtml(r.role)}</span></td>
      <td>${AlertEngine.escapeHtml(r.outlet)}${r.beat ? `<br><span class="team-chip">${r.beat}</span>` : ""}</td>
      <td>${tierBadge(r.tier)}</td>
      <td>${inArenaStatus(r)}</td>
      <td>${xLink(r)}</td>
      <td>${bskyCell(r)}</td>
      <td>${statusBadge(r)}${r.citeText ? `<br><span class="tiny muted cite">“…${AlertEngine.escapeHtml(citeTail(r))}”</span><br><a class="tiny" href="${dataSnapshotUrl}" target="_blank" rel="noopener">stored snapshot ↗</a>` : ""}<br><a class="tiny" href="${r.verifyUrl}" target="_blank" rel="noopener">${r.citeText ? "ESPN injury page ↗" : "verification ↗"}</a></td>
      <td class="tiny muted">${AlertEngine.escapeHtml(r.notes || "")}</td>
      <td data-score-for="${AlertEngine.escapeHtml(r.name)}" class="tiny"><span class="muted">—</span></td>
    </tr>`).join("");
    paintScores();
  }

  /* ===================================================================================
   * IN-ARENA VERIFICATION MATRIX — rendered from arenaCoverage() in data.js (2026-09-18)
   *
   * The previous version of this table was assembled on the fly from whatever rows happened to
   * exist, which produced a green "✓ In-arena live coverage" badge for a team whose only row was
   * a byline citation — a claim the data did not support. The matrix now renders the COMPUTED
   * coverage class and prints each row's gaps verbatim, including "no pollable in-arena writer
   * account", so an uncovered team looks uncovered on the page.
   * =================================================================================== */
  const CLS_META = {
    "verified-pollable": { badge: "ok", label: "✓ verified in-arena writer, polled" },
    "bio-pollable": { badge: "warn", label: "◐ writer polled · bio-verified identity" },
    "official-only": { badge: "bad", label: "✗ no writer account · official channel only" },
    "gap": { badge: "bad", label: "✗ NO SOURCE — must be fixed" }
  };
  const CONF_META = {
    "bsky-verified": { badge: "ok", short: "Bluesky-verified" },
    "bio-verified": { badge: "warn", short: "bio states outlet + beat" },
    "outlet-verified": { badge: "info", short: "outlet page" },
    "unconfirmed": { badge: "bad", short: "UNCONFIRMED" }
  };
  function confidenceBadge(conf) {
    const m = CONF_META[conf] || CONF_META.unconfirmed;
    return `<span class="badge ${m.badge}">${m.short}</span>`;
  }
  function renderArenaMatrix() {
    const el = document.getElementById("arenaMatrixTable");
    if (!el || typeof arenaCoverage !== "function") return;
    const esc = AlertEngine.escapeHtml;
    const cov = arenaCoverage();

    el.innerHTML = cov.map(c => {
      const t = teamByAbbr(c.abbr);
      const meta = CLS_META[c.cls] || CLS_META.gap;
      const writers = c.pollable.length
        ? c.pollable.map(p => `<b>${esc(p.name)}</b><br><span class="tiny muted">${esc(p.outlet)}</span><br>
             ${confidenceBadge(p.conf)}${p.bskyVerified && p.verifier ? `<span class="tiny muted"> (${esc(p.verifier)})</span>` : ""}<br>
             <a class="tiny" href="${esc(p.evidence)}" target="_blank" rel="noopener">profile ↗</a>
             ${p.evidenceApi ? `· <a class="tiny" href="${esc(p.evidenceApi)}" target="_blank" rel="noopener">re-check API ↗</a>` : ""}
             ${p.evidenceQuote ? `<br><span class="tiny muted cite">“${esc(p.evidenceQuote)}”</span>` : ""}`).join("<hr style='border:0;border-top:1px solid var(--line);margin:6px 0'>")
        : `<span class="muted small">none polled</span>`;
      const dirOnly = c.directory.length
        ? `<br><span class="tiny muted">directory: ${c.directory.map(d => esc(d.name) + " (" + esc(d.status) + ")").join(", ")}</span>` : "";
      const held = c.graded.length
        ? `<br><span class="tiny muted">held out of alerts: ${c.graded.map(d => esc(d.name) + " — " + esc(d.conf) + (d.feed ? "" : " (feed off)")).join(", ")}</span>` : "";
      /* The probe result is stated per row, because "there is a URL here" and "a machine read it"
       * are different claims — and on 2026-09-18 the machine was refused (HTTP 403) for all 30. */
      const probe = (typeof NBA_TEAM_NEWS_PROBE !== "undefined") ? NBA_TEAM_NEWS_PROBE : null;
      const official = `<a href="${esc(c.official.news)}" target="_blank" rel="noopener">club news (nba.com/${esc(t.nba)}) ↗</a>
        <br><span class="tiny muted">${c.official.newsChecked
          ? "re-read live in a browser " + esc(c.official.newsChecked)
          : (probe ? "pattern URL · runner probe HTTP 403 on " + esc(probe.checkedAt.slice(0, 10)) + " → manual review only"
                   : "URL pattern, not re-read")}</span>
        ${c.official.bluesky.length ? c.official.bluesky.map(b => `<br><span class="tiny">${b.bskyVerified ? '<span class="badge ok">Bluesky-verified</span>' : '<span class="badge warn">no verification object</span>'} <a class="tiny" href="${esc(b.url)}" target="_blank" rel="noopener">@${esc(b.handle)} ↗</a>${b.feed ? " <span class='tiny muted'>(polled)</span>" : " <span class='tiny muted'>(not polled)</span>"}</span>`).join("") : ""}`;
      const gaps = c.gaps.length
        ? `<ul class="tight tiny muted" style="margin:4px 0 0;padding-left:16px">${c.gaps.map(g => `<li>${esc(g)}</li>`).join("")}</ul>`
        : `<span class="tiny ok-text">no measured gap</span>`;
      return `<tr>
        <td><b><span class="team-chip">${esc(c.abbr)}</span></b><br><span class="tiny muted">${esc(c.city)} ${esc(c.name)}</span></td>
        <td>${writers}${dirOnly}${held}</td>
        <td><span class="badge ${meta.badge}">${meta.label}</span><br>${gaps}</td>
        <td class="tiny">${official}</td>
        <td class="tiny"><a href="${esc(espnTeamInjuriesUrl(c.abbr))}" target="_blank" rel="noopener">ESPN injuries ↗</a><br>
            <a href="${xSearchUrl(c.city + " " + c.name + " injury")}" target="_blank" rel="noopener">X search ↗</a></td>
      </tr>`;
    }).join("");
  }

  /* ---- headline numbers + the "needs work" list, computed from the same coverage model ---- */
  function renderCoverage() {
    const sumEl = document.getElementById("coverageSummary");
    if (!sumEl || typeof arenaCoverageSummary !== "function") return;
    const s = arenaCoverageSummary();
    const esc = AlertEngine.escapeHtml;
    sumEl.innerHTML = [
      `<span class="pill ok">✓ ${s.verifiedPollable}/30 teams: verified in-arena writer, polled automatically</span>`,
      `<span class="pill warn">◐ ${s.bioPollable}/30: writer polled, identity evidence is the account's own bio</span>`,
      `<span class="pill bad">✗ ${s.officialOnly}/30: no writer account — official club channel + manual review only</span>`,
      `<span class="pill ${s.gap ? "bad" : "ok"}">${s.gap} teams with no source at all</span>`,
      `<span class="pill ok">${s.pollableWriters} pollable writer accounts · ${s.blsSkyVerifiedWriters} Bluesky-verified</span>`
    ].join(" ");
    const listEl = document.getElementById("coverageWorklist");
    if (listEl) {
      const cov = arenaCoverage().filter(c => c.cls !== "verified-pollable");
      listEl.innerHTML = cov.length
        ? `<b>Not yet verified in-arena (${cov.length} teams)</b> — each needs an account whose identity evidence is a
           verification object or an outlet page, before it can be trusted at the moment of an injury:
           <ul class="tight" style="margin:6px 0 0;padding-left:18px">${cov.map(c =>
            `<li><span class="team-chip">${esc(c.abbr)}</span> ${esc(c.cls === "bio-pollable" ? "bio-verified writer only" : "official channels only")}
              — ${esc(c.gaps[0] || "")}${c.directory.length ? ` <span class="tiny muted">(directory row present, not pollable)</span>` : ""}</li>`).join("")}</ul>`
        : `<span class="ok-text">Every team has a verified, polled in-arena writer.</span>`;
    }
  }

  /* ---- what the CI re-verification run observed last (data/live/reporter_verify.json) ---- */
  function renderVerifyStatus() {
    const el = document.getElementById("verifyStatus");
    if (!el) return;
    const esc = AlertEngine.escapeHtml;
    fetch("data/live/reporter_verify.json", { cache: "no-store" })
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(v => {
        const s = v.summary || {};
        const problems = (v.rows || []).filter(r => r.status !== "ok");
        el.innerHTML = `<b>Last automated re-verification:</b> ${esc(new Date(v.generated).toLocaleString())} —
          ${esc(String(s.checked))} handles checked · ${esc(String(s.ok))} clean ·
          ${esc(String(s.bioDrift))} bio drift · ${esc(String(s.dormant))} dormant ·
          ${esc(String(s.recencyUnknown || 0))} recency unreadable ·
          ${esc(String(s.missing))} unresolvable · club channels ${esc(String((v.channelSummary || {}).ok))}/${esc(String((v.channelSummary || {}).checked))} answered.
          ${problems.length ? `<div class="tiny" style="margin-top:6px">${problems.map(p => `<div>⚠ ${esc(p.handle || p.name)} → <b>${esc(p.status)}</b> ${esc((p.notes || [])[0] || "")}</div>`).join("")}</div>` : ""}`;
      })
      .catch(e => {
        el.innerHTML = `<span class="muted">No automated re-verification file yet (${esc(e.message)}). The daily
          <span class="kbd">live-audit.yml</span> job (09:17 UTC) writes <span class="kbd">data/live/reporter_verify.json</span>; until it has run,
          the evidence above is the <b>session-10 manual pass of 2026-09-18</b>, whose per-row quotes are stored in
          <span class="kbd">assets/js/data.js</span>.</span>`;
      });
  }

  /* ---- Bluesky allow-list table (the pollable layer) ---- */
  function renderBsky() {
    const el = document.getElementById("bskyTable");
    if (!el) return;
    const official = (typeof SOCIAL_ACCOUNTS !== "undefined") ? SOCIAL_ACCOUNTS : [];
    const reps = (typeof BSKY_REPORTERS !== "undefined") ? BSKY_REPORTERS : [];
    const rows = official.map(a => Object.assign({}, a, { kindLabel: a.kind === "official-league" ? "Official league" : a.kind === "official-team" ? ("Official team " + (a.team || "")) : a.kind === "outlet" ? "Outlet account" : "Stats site" }))
      .concat(reps.map(r => ({ handle: r.handle, name: r.name, kindLabel: "Reporter · " + (r.outlet || "outlet unconfirmed"), team: r.team, bskyVerified: r.bskyVerified, verified: r.verified, url: r.evidence, feed: r.feed })));
    el.innerHTML = rows.map(a => `<tr>
      <td><b>${AlertEngine.escapeHtml(a.name)}</b><br><a class="tiny" href="${a.url}" target="_blank" rel="noopener">@${AlertEngine.escapeHtml(a.handle)} ↗</a></td>
      <td class="small">${AlertEngine.escapeHtml(a.kindLabel)}${a.team ? ` <span class="team-chip">${a.team}</span>` : ""}</td>
      <td>${a.bskyVerified ? '<span class="badge ok">Bluesky-verified</span>' : '<span class="badge warn">no verification object</span>'}</td>
      <td>${a.feed ? '<span class="badge info">polled for alerts</span>' : '<span class="badge dim">evidence only</span>'}</td>
      <td class="tiny muted">${AlertEngine.escapeHtml(a.verified)}</td>
    </tr>`).join("");
    const listEl = document.getElementById("bskyListInfo");
    if (listEl && typeof BLUESKY_LIST_SOURCE !== "undefined") {
      listEl.innerHTML = `Roster built from <a href="${BLUESKY_LIST_SOURCE.url}" target="_blank" rel="noopener">${AlertEngine.escapeHtml(BLUESKY_LIST_SOURCE.name)}</a>
        (${BLUESKY_LIST_SOURCE.members} members, read live via the public API). ${AlertEngine.escapeHtml(BLUESKY_LIST_SOURCE.verified)}`;
    }
  }

  /* Pills are computed from the registry so the numbers on a verification page cannot go stale. */
  function renderPills() {
    const el = document.getElementById("reporterPills");
    if (!el || typeof REPORTERS === "undefined") return;
    const by = st => REPORTERS.filter(r => r.status === st).length;
    const bsky = (typeof BSKY_REPORTERS !== "undefined") ? BSKY_REPORTERS.length : 0;
    const accounts = (typeof SOCIAL_ACCOUNTS !== "undefined") ? SOCIAL_ACCOUNTS.length : 0;
    const pills = [
      ["ok", `✓ ${by("verified-handle")} X handles verified (first pass 2026-09-17, each with an evidence link)`],
      ["ok", `✓ ${bsky} reporter Bluesky accounts verified against the public API 2026-09-17`],
      ["ok", `✓ ${accounts} official league/team/outlet Bluesky accounts verified`],
      ["ok", `✓ ${by("citation-verified")} reporters added from bylines on the injury feed itself (no handle asserted)`],
      ["warn", `${by("outlet-only")} outlet-verified · X handle unconfirmed (none asserted)`],
      ["bad", `${by("retired")} retired · ${by("inactive")} inactive on X`],
      ["warn", `${REPORTERS.length} rows in the directory`]
    ];
    el.innerHTML = pills.map(([k, t]) => `<span class="pill ${k}">${AlertEngine.escapeHtml(t)}</span>`).join("");
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
      reporter, n: s.n, pts: s.pts, firsts: s.firsts,
      acc: (s.correct + s.wrong) ? (100 * s.correct / (s.correct + s.wrong)).toFixed(0) + "%" : "—"
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
        : `<tr><td colspan="6" class="muted">No calls logged yet. Log the first one when a tracked account posts injury news.</td></tr>`;
    }
    const log = document.getElementById("callsLog");
    if (log) {
      const calls = getCalls();
      log.innerHTML = calls.length ? calls.slice(0, 60).map(c =>
        `<div class="alert-entry"><time>${AlertEngine.escapeHtml(new Date(c.ts).toLocaleString())}</time>
         <b>${AlertEngine.escapeHtml(c.reporter)}</b> — ${AlertEngine.escapeHtml(c.player)}: ${AlertEngine.escapeHtml(c.claim)}
         [${AlertEngine.escapeHtml(c.outcome)} · ${pointsFor(c.outcome)} pts${c.platform ? " · " + AlertEngine.escapeHtml(c.platform) : ""}]
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
    const base = REPORTERS.filter(r => r.status !== "retired")
      .map(r => ({ name: r.name, outlet: r.outlet }));
    const extra = ((typeof BSKY_REPORTERS !== "undefined") ? BSKY_REPORTERS : [])
      .filter(b => !base.some(x => x.name.toLowerCase() === b.name.toLowerCase()))
      .map(b => ({ name: b.name, outlet: (b.outlet || "outlet unconfirmed") + " (Bluesky)" }));
    sel.innerHTML = base.concat(extra)
      .sort((a, b) => a.name.localeCompare(b.name))
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
        platform: document.getElementById("callPlatform").value,
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
            saveCalls(data.concat(getCalls()).slice(0, 2000));
            paintScores();
            alert("Imported " + data.length + " calls.");
          } catch (e) { alert("Import failed: " + e.message); }
        };
        rd.readAsText(f);
      });
    }
  }

  function init() {
    const filter = { tier: "ALL", status: "ALL", inArena: "ALL", q: "" };
    renderTable(filter);
    renderBsky();
    renderPills();
    renderRubric();
    renderCoverage();
    renderArenaMatrix();
    renderVerifyStatus();
    buildForm();
    paintScores();
    const t = document.getElementById("tierFilter");
    const s = document.getElementById("statusFilter");
    const a = document.getElementById("inArenaFilter");
    const q = document.getElementById("repSearch");
    if (t) t.addEventListener("change", () => { filter.tier = t.value; renderTable(filter); });
    if (s) s.addEventListener("change", () => { filter.status = s.value; renderTable(filter); });
    if (a) a.addEventListener("change", () => { filter.inArena = a.value; renderTable(filter); });
    if (q) q.addEventListener("input", () => { filter.q = q.value; renderTable(filter); });

    if (typeof document !== "undefined" && document.querySelectorAll) {
      document.querySelectorAll(".cat-tab").forEach(tab => {
        tab.addEventListener("click", () => {
          document.querySelectorAll(".cat-tab").forEach(x => x.classList.remove("active"));
          tab.classList.add("active");
          currentCategory = tab.dataset.cat || "ALL";
          renderTable(filter);
        });
      });
    }
  }

  return { init, scoreboard };
})();

document.addEventListener("DOMContentLoaded", () => Reporters.init());
