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
    let sourceRows = REPORTERS;
    if (currentCategory === "official") {
      const officials = (typeof SOCIAL_ACCOUNTS !== "undefined" ? SOCIAL_ACCOUNTS : [])
        .filter(a => a.kind === "official-league" || a.kind === "official-team" || a.kind === "outlet");
      sourceRows = officials.map(a => ({
        name: a.name,
        role: a.kind === "official-league" ? "Official NBA League Account" : ("Official Club Channel" + (a.team ? " (" + a.team + ")" : "")),
        outlet: a.team ? (a.team + " (NBA Club)") : "NBA",
        beat: a.team || null,
        tier: 1,
        inArena: true,
        handle: null,
        status: a.bskyVerified ? "verified-handle" : "outlet-only",
        verifyUrl: a.url || ("https://bsky.app/profile/" + a.handle),
        notes: a.verified || (a.bskyVerified ? "Official Bluesky verified account" : "Official unverified channel"),
        bskyHandle: a.handle,
        bskyVerified: a.bskyVerified
      }));
    }

    const rows = sourceRows.filter(r => {
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
  /* ACTIVITY (session 13, 2026-09-18). Identity (`CLS_META` / `CONF_META`) says who an account is;
   * these badges say when it last said anything — the difference between "we have a verified writer
   * for Dallas" and "that writer last posted 628 days ago". Rendered from arenaCoverage().recency,
   * which is computed, so a page cannot claim an active feed it did not measure. */
  const REC_META = {
    "active":                  { badge: "ok",   label: "⏱ active" },
    "dormant-only":            { badge: "bad",  label: "⏱ ALL writers dormant" },
    "dormant-and-unmeasured":  { badge: "bad",  label: "⏱ no active writer (some unmeasured)" },
    "unmeasured":              { badge: "dim",  label: "⏱ activity not measured" },
    "no-writer":               { badge: "bad",  label: "⏱ no writer account to measure" }
  };
  /* Newest-post dates measured by tools/verify_reporters.js (data/live/reporter_verify.json).
   * Loaded before the matrix renders; when the file is missing the registry's own observations are
   * used and the page says which it is showing — never a silent blend of the two. */
  let RECENCY = null;
  /* Timestamp of the CI evidence file actually loaded (null = not loaded yet). Drives the pills'
   * "verified on" date so the page cannot assert a re-verification that has not happened. */
  let CI_GENERATED = null;
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
    const cov = arenaCoverage(RECENCY);

    el.innerHTML = cov.map(c => {
      const t = teamByAbbr(c.abbr);
      const meta = CLS_META[c.cls] || CLS_META.gap;
      const writers = c.pollable.length
        ? c.pollable.map(p => `<b>${esc(p.name)}</b><br><span class="tiny muted">${esc(p.outlet)}</span><br>
             ${confidenceBadge(p.conf)}${p.bskyVerified && p.verifier ? `<span class="tiny muted"> (${esc(p.verifier)})</span>` : ""}<br>
             <a class="tiny" href="${esc(p.evidence)}" target="_blank" rel="noopener">profile ↗</a>
             ${p.evidenceApi ? `· <a class="tiny" href="${esc(p.evidenceApi)}" target="_blank" rel="noopener">re-check API ↗</a>` : ""}
             <br><span class="tiny ${p.recency && p.recency.state === "active" ? "ok-text" : "muted"}">${p.recency ? "⏱ " + esc(p.recency.label) : ""}</span>
             ${p.evidenceQuote ? `<br><span class="tiny muted cite">“${esc(p.evidenceQuote)}”</span>` : ""}`).join("<hr style='border:0;border-top:1px solid var(--line);margin:6px 0'>")
        : `<span class="muted small">none polled</span>`;
      const dirOnly = c.directory.length
        ? `<br><span class="tiny muted">directory: ${c.directory.map(d => esc(d.name) + " (" + esc(d.status) + ")").join(", ")}</span>` : "";
      const held = c.graded.length
        ? `<br><span class="tiny muted">held out of alerts: ${c.graded.map(d => esc(d.name) + " — " + esc(d.conf) + (d.feed ? "" : " (feed off)")).join(", ")}</span>` : "";
      /* The probe result is stated per row, because "there is a URL here" and "a machine read it"
       * are different claims — and on 2026-09-18 the machine was refused (HTTP 403) for all 30. */
      const probe = (typeof NBA_TEAM_NEWS_PROBE !== "undefined") ? NBA_TEAM_NEWS_PROBE : null;
      /* What the 25-handle club probe found for this franchise: the honest answer to "is there an
       * official Bluesky account?" is usually "no verified one, and here is every handle that
       * looks like one and why it is not accepted". */
      const clubProbeHtml = (c.official.probe || []).map(pr => {
        const tag = pr.verdict === "impersonation-labelled" ? '<span class="badge bad">Bluesky-labelled impersonation</span>'
          : pr.verdict === "absent" ? '<span class="badge dim">no such handle</span>'
            : pr.verdict === "private-profile" ? '<span class="badge warn">private profile — unreadable keylessly</span>'
              : pr.verdict === "placeholder" ? '<span class="badge dim">placeholder, not a club</span>'
                : pr.verification ? '<span class="badge ok">verified</span>' : '<span class="badge warn">no verification object</span>';
        const counts = (pr.followers != null || pr.posts != null)
          ? ` <span class="tiny muted">${pr.followers == null ? "?" : pr.followers.toLocaleString()} followers · ${pr.posts == null ? "?" : pr.posts.toLocaleString()} posts</span>` : "";
        return `<div class="tiny">${tag} <code>@${esc(pr.handle)}</code>${counts}${pr.moderationLabel ? ` <span class="tiny muted">(label: ${esc(pr.moderationLabel)})</span>` : ""}</div>`;
      }).join("");
      const official = `<a href="${esc(c.official.news)}" target="_blank" rel="noopener">club news (nba.com/${esc(t.nba)}) ↗</a>
        <br><span class="tiny muted">${c.official.newsChecked
          ? "re-read live in a browser " + esc(c.official.newsChecked)
          : (probe ? "pattern URL · runner probe HTTP 403 on " + esc(probe.checkedAt.slice(0, 10)) + " → manual review only"
                   : "URL pattern, not re-read")}</span>
        ${clubProbeHtml}
        ${c.official.bluesky.length ? c.official.bluesky.map(b => `<br><span class="tiny">${b.bskyVerified ? '<span class="badge ok">Bluesky-verified</span>' : '<span class="badge warn">no verification object</span>'} <a class="tiny" href="${esc(b.url)}" target="_blank" rel="noopener">@${esc(b.handle)} ↗</a>${b.feed ? " <span class='tiny muted'>(polled)</span>" : " <span class='tiny muted'>(not polled)</span>"}</span>`).join("") : ""}`;
      const gaps = c.gaps.length
        ? `<ul class="tight tiny muted" style="margin:4px 0 0;padding-left:16px">${c.gaps.map(g => `<li>${esc(g)}</li>`).join("")}</ul>`
        : `<span class="tiny ok-text">no measured gap</span>`;
      return `<tr>
        <td><b><span class="team-chip">${esc(c.abbr)}</span></b><br><span class="tiny muted">${esc(c.city)} ${esc(c.name)}</span></td>
        <td>${writers}${dirOnly}${held}</td>
        <td><span class="badge ${meta.badge}">${meta.label}</span>
            ${(REC_META[c.recency] ? `<br><span class="badge ${REC_META[c.recency].badge}">${REC_META[c.recency].label}</span>` : "")}
            ${c.quietestWriterDays != null ? `<br><span class="tiny muted">quietest writer: ${c.quietestWriterDays} days</span>` : ""}
            <br>${gaps}</td>
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
    const s = arenaCoverageSummary(RECENCY);
    const esc = AlertEngine.escapeHtml;
    sumEl.innerHTML = [
      `<span class="pill ok">✓ ${s.verifiedPollable}/30 teams: verified in-arena writer, polled automatically</span>`,
      `<span class="pill warn">◐ ${s.bioPollable}/30: writer polled, identity evidence is the account's own bio</span>`,
      `<span class="pill bad">✗ ${s.officialOnly}/30: no writer account — official club channel + manual review only</span>`,
      `<span class="pill ${s.gap ? "bad" : "ok"}">${s.gap} teams with no source at all</span>`,
      `<span class="pill ok">${s.pollableWriters} pollable writer accounts · ${s.blsSkyVerifiedWriters} Bluesky-verified</span>`,
      /* ACTIVITY — the second question, asked separately (session 13). A team can be
       * identity-verified and still have nobody posting. */
      `<span class="pill ${s.activeTeams === 30 ? "ok" : "warn"}">⏱ ${s.activeTeams}/30 teams have a writer who posted within ${s.dormantThresholdDays} days</span>`,
      `<span class="pill ${s.writersDormant ? "bad" : "ok"}">${s.writersDormant} of ${s.pollableWriters} writers are DORMANT · ${s.writersUnmeasured} unmeasured</span>`,
      `<span class="pill ${RECENCY ? "ok" : "dim"}">${RECENCY ? "activity from the CI re-verification file" : "activity from registry observations (CI file not loaded)"}</span>`
    ].join(" ");
    const listEl = document.getElementById("coverageWorklist");
    if (listEl) {
      const cov = arenaCoverage(RECENCY);
      const identity = cov.filter(c => c.cls !== "verified-pollable");
      /* The list session 12 did not have: teams whose writer EXISTS but has gone quiet. These read
       * as covered on identity alone, which is precisely the claim this page exists to check. */
      const quiet = cov.filter(c => c.recency === "dormant-only" || c.recency === "dormant-and-unmeasured" || c.recency === "unmeasured");
      listEl.innerHTML =
        (identity.length
          ? `<b>Not yet verified in-arena (${identity.length} teams)</b> — each needs an account whose identity evidence is a
             verification object or an outlet page, before it can be trusted at the moment of an injury:
             <ul class="tight" style="margin:6px 0 0;padding-left:18px">${identity.map(c =>
              `<li><span class="team-chip">${esc(c.abbr)}</span> ${esc(c.cls === "bio-pollable" ? "bio-verified writer only" : "official channels only")}
                — ${esc(c.gaps[0] || "")}${c.directory.length ? ` <span class="tiny muted">(directory row present, not pollable)</span>` : ""}</li>`).join("")}</ul>`
          : `<span class="ok-text">Every team has a verified, polled in-arena writer.</span>`) +
        (quiet.length
          ? `<div style="margin-top:10px"><b>⏱ Named writer, no recent activity (${quiet.length} teams)</b> — the account exists and its
             identity is evidenced, but nothing has been posted inside ${esc(String(s.dormantThresholdDays))} days, so it cannot
             corroborate an injury right now. Measured, not estimated:
             <ul class="tight" style="margin:6px 0 0;padding-left:18px">${quiet.map(c =>
              `<li><span class="team-chip">${esc(c.abbr)}</span> ${esc(c.pollable.map(p => p.name + " (" + (p.recency.dormantDays == null ? "unmeasured" : p.recency.dormantDays + " days") + ")").join(", "))}</li>`).join("")}</ul></div>`
          : `<div class="tiny ok-text" style="margin-top:10px">Every team's polled writer has posted inside ${esc(String(s.dormantThresholdDays))} days.</div>`);
    }
  }

  /* ---- what the CI re-verification run observed last (data/live/reporter_verify.json) ---- */
  /* ---- Verifier drift & activity watch (session 17) ----
   * The session-15 leftover was a "verifier-drift UI": the verifier had been detecting revoked
   * verification objects and beat changes for two sessions, but the only place a reader could see
   * them was one badge inside a run-on status line, so the page could not answer the question the
   * panel exists for — what has changed about who these people are? The computation lives in
   * data.js so it is testable in Node; this function only paints it. */
  const DRIFT_BADGE = {
    "verifier-revoked": "bad",
    "verification-invalid": "warn",
    "beat-change": "warn",
    "activity-transition": "info"
  };
  const DRIFT_LABEL = {
    "verifier-revoked": "verification object revoked",
    "verification-invalid": "verification object invalid",
    "beat-change": "beat change",
    "activity-transition": "activity change"
  };
  function paintDrift(drift) {
    const esc = AlertEngine.escapeHtml;
    const c = drift.counts;
    const pills = document.getElementById("driftPills");
    if (pills) {
      pills.innerHTML = [
        `<span class="pill"><b>${esc(String(c.total))}</b> drift fact(s)</span>`,
        `<span class="pill ${c.verifierRevoked ? "warn" : ""}">🔐 <b>${esc(String(c.verifierRevoked))}</b> verification revoked</span>`,
        `<span class="pill ${c.verificationInvalid ? "warn" : ""}">◐ <b>${esc(String(c.verificationInvalid))}</b> object invalid</span>`,
        `<span class="pill ${c.beatChange ? "warn" : ""}">🔀 <b>${esc(String(c.beatChange))}</b> beat change</span>`,
        `<span class="pill ${c.activityTransition ? "info" : ""}">📉 <b>${esc(String(c.activityTransition))}</b> activity change</span>`,
        `<span class="pill">threshold <b>${esc(String(drift.thresholdDays))}</b> days</span>`
      ].join("");
    }
    const tb = document.getElementById("driftTable");
    if (tb) {
      tb.innerHTML = drift.facts.length ? drift.facts.map(f => `<tr>
        <td><b>${esc(f.name || f.handle)}</b><br><span class="tiny muted">@${esc(f.handle)}</span></td>
        <td>${f.team ? `<span class="team-chip">${esc(f.team)}</span>` : '<span class="tiny muted">national</span>'}</td>
        <td><span class="badge ${DRIFT_BADGE[f.kind] || "info"}">${esc(DRIFT_LABEL[f.kind] || f.kind)}</span>
          <div class="small" style="margin-top:3px">${esc(f.label || "")}</div></td>
        <td class="small">${esc(f.detail || "")}${f.at ? `<div class="tiny muted">measured ${esc(String(f.at))}</div>` : ""}
          <div class="tiny muted">${esc(f.source || "")}</div></td>
        <td>${f.url ? `<a class="tiny" href="${esc(f.url)}" target="_blank" rel="noopener">re-open the evidence ↗</a>` : '<span class="tiny muted">—</span>'}</td>
      </tr>`).join("") : `<tr><td colspan="5" class="small muted">No drift measured. That is a statement about this
        re-verification run, not a guarantee: the verifier can only compare what it re-read.</td></tr>`;
    }
    const note = document.getElementById("driftNote");
    if (note) {
      note.innerHTML = `Scope: ${esc(drift.scope)} · computed ${esc(new Date(drift.checkedAt).toLocaleString())}.
        A <b>beat change</b> is a coverage loss for the team that was left and must be filled from a live read, never invented;
        a <b>revoked or invalid verification object</b> is a standing risk recorded against the row, not a retraction of the identity;
        an <b>activity change</b> moves a row across the ${esc(String(drift.thresholdDays))}-day line in either direction and never re-grades it.`;
    }
  }
  function renderDrift() {
    const el = document.getElementById("driftTable");
    if (!el || typeof verifierDrift !== "function") return;
    /* Registry-only first, so the panel is never empty while the CI file is in flight, then
     * repainted with the measurement when it arrives. */
    paintDrift(verifierDrift(null, Date.now()));
    fetch("data/live/reporter_verify.json", { cache: "no-store" })
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(v => paintDrift(verifierDrift(v.rows || [], Date.now())))
      .catch(() => { /* the registry-only paint above already stands, and says so in its scope line */ });
  }

  function renderVerifyStatus() {
    const el = document.getElementById("verifyStatus");
    if (!el) return;
    const esc = AlertEngine.escapeHtml;
    fetch("data/live/reporter_verify.json", { cache: "no-store" })
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(v => {
        const s = v.summary || {};
        const problems = (v.rows || []).filter(r => r.status !== "ok");
        /* Feed the measured newest-post dates back into the coverage model BEFORE repainting, so the
         * matrix shows the CI measurement rather than the date stored when a row was written.
         * (Session 13: the file had the truth for 11 dormant accounts while the matrix printed
         * coverage, because nothing ever connected the two.) */
        RECENCY = {};
        for (const r of (v.rows || [])) {
          if (r && r.handle) RECENCY[String(r.handle).toLowerCase()] = { latestPostAt: r.latestPostAt || null, status: r.status };
        }
        CI_GENERATED = v.generated || null;
        renderPills();
        renderCoverage();
        renderArenaMatrix();
        el.innerHTML = `<b>Last automated re-verification:</b> ${esc(new Date(v.generated).toLocaleString())} —
          ${esc(String(s.checked))} handles checked · ${esc(String(s.ok))} clean ·
          ${esc(String(s.bioDrift))} bio drift · ${esc(String(s.dormant))} dormant ·
          ${esc(String(s.recencyUnknown || 0))} recency unreadable ·
          ${esc(String(s.missing))} unresolvable · club channels ${esc(String((v.channelSummary || {}).ok))}/${esc(String((v.channelSummary || {}).checked))} answered.
          <div class="tiny" style="margin-top:4px">⏱ activity: <b>${esc(String(s.activeInAlertPath == null ? "?" : s.activeInAlertPath))}</b> of
            ${esc(String(s.inAlertPath == null ? "?" : s.inAlertPath))} allow-listed accounts posted within
            ${esc(String(s.dormantThresholdDays == null ? "?" : s.dormantThresholdDays))} days ·
            ${esc(String(s.dormantInAlertPath == null ? "?" : s.dormantInAlertPath))} dormant ·
            ${esc(String(s.unmeasuredInAlertPath == null ? "?" : s.unmeasuredInAlertPath))} with no readable date
            ${s.quietestInAlertPath == null ? "" : `· quietest ${esc(String(s.quietestInAlertPath))} days`}
            ${s.impersonationLabel ? `· <b class="bad">${esc(String(s.impersonationLabel))} impersonation-labelled</b>` : ""}
            ${s.profilePrivate ? `· ${esc(String(s.profilePrivate))} private profile(s)` : ""}</div>
          ${problems.length ? `<div class="tiny" style="margin-top:6px">${problems.map(p => {
            const beatTag = (p.beatChange || (p.notes && p.notes.some(n => /beat-change/i.test(n)))) ? ' <span class="badge warn">beat-change watch</span>' : '';
            const revokeTag = (p.verification && p.verification.invalid) || (p.notes && p.notes.some(n => /verifier-revocation/i.test(n))) ? ' <span class="badge bad">verifier-revoked</span>' : '';
            return `<div>⚠ ${esc(p.handle || p.name)} → <b>${esc(p.status)}</b>${beatTag}${revokeTag} ${esc((p.notes || [])[0] || "")}</div>`;
          }).join("")}</div>` : ""}`;
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
  /* ===================================================================================
   * The verification DATE is derived, not typed (session 13). This page used to say "verified
   * against the public API 2026-09-17" forever, while the registry underneath it was re-read on
   * 2026-09-18 and is re-read by CI every day. A hardcoded date on a verification page is the same
   * defect as a hardcoded count: it keeps asserting a check nobody is running. The date now comes
   * from the newest `observed.checkedAt` in the registry, and is replaced by the CI evidence file's
   * own `generated` stamp once that file has loaded.
   * =================================================================================== */
  function registryCheckedAt() {
    let newest = null;
    const rows = (typeof BSKY_REPORTERS !== "undefined" ? BSKY_REPORTERS : [])
      .concat(typeof SOCIAL_ACCOUNTS !== "undefined" ? SOCIAL_ACCOUNTS : []);
    for (const r of rows) {
      const d = r && r.observed && r.observed.checkedAt;
      if (d && (!newest || String(d) > String(newest))) newest = d;
    }
    return newest;
  }

  function renderPills() {
    const el = document.getElementById("reporterPills");
    if (!el || typeof REPORTERS === "undefined") return;
    const by = st => REPORTERS.filter(r => r.status === st).length;
    const bsky = (typeof BSKY_REPORTERS !== "undefined") ? BSKY_REPORTERS.length : 0;
    const accounts = (typeof SOCIAL_ACCOUNTS !== "undefined") ? SOCIAL_ACCOUNTS.length : 0;
    /* CI file wins when present: it is a measurement of the whole allow-list, the registry dates are
     * per-row reads. Both are stated as what they are. */
    const bskyDate = CI_GENERATED
      ? `re-verified by CI ${String(CI_GENERATED).slice(0, 10).replace(/-/g, "-")}`
      : `verified against the public API ${registryCheckedAt() || "(no dated read on file)"}`;
    const pills = [
      ["ok", `✓ ${by("verified-handle")} X handles verified (first pass 2026-09-17, each with an evidence link)`],
      ["ok", `✓ ${bsky} reporter Bluesky accounts ${bskyDate}${CI_GENERATED ? "" : " · re-checked daily by live-audit.yml"}`],
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

  /* ===================================================================================
   * OFFICIAL CLUB BLUESKY PROBE (session 13) — the honest answer to "is there an official
   * club account we can verify?". 25 candidate handles were read with one keyless getProfiles
   * request; 16 resolved and NOT ONE carried a verification object, three carry Bluesky's own
   * `impersonation` label, and nine do not exist at all. Every row is rendered with its verdict
   * so a reader can see the misses, not just the finds.
   * =================================================================================== */
  function renderClubProbe() {
    const el = document.getElementById("clubProbeTable");
    if (!el || typeof NBA_OFFICIAL_ACCOUNT_PROBE === "undefined") return;
    const esc = AlertEngine.escapeHtml;
    const P = NBA_OFFICIAL_ACCOUNT_PROBE;
    const VERDICT = {
      "absent": ["dim", "no such handle"],
      "placeholder": ["dim", "placeholder — no club claim"],
      "impersonation-labelled": ["bad", "Bluesky-labelled impersonation"],
      "private-profile": ["warn", "private profile — unreadable keylessly"],
      "unverified-candidate": ["warn", "claims the club · no verification object"],
      "in-registry": ["info", "listed in the registry"]
    };
    el.innerHTML = P.rows.map(r => {
      const v = VERDICT[r.verdict] || ["dim", r.verdict];
      return `<tr>
        <td><span class="team-chip">${esc(r.team)}</span></td>
        <td><a href="https://bsky.app/profile/${esc(r.handle)}" target="_blank" rel="noopener">@${esc(r.handle)} ↗</a>
            <br><span class="tiny muted">${r.displayName ? esc(r.displayName) : "(no display name)"}</span></td>
        <td><span class="badge ${v[0]}">${esc(v[1])}</span>${r.moderationLabel ? `<br><span class="tiny muted">label: ${esc(r.moderationLabel)}</span>` : ""}</td>
        <td class="tiny">${r.followers == null ? "—" : esc(r.followers.toLocaleString())} followers<br>${r.posts == null ? "—" : esc(r.posts.toLocaleString())} posts</td>
        <td class="tiny muted">${r.bio ? `“${esc(r.bio)}”` : (r.resolved ? "(no bio returned)" : "handle does not exist — getProfiles returned an empty profiles array")}${r.note ? `<br>${esc(r.note)}` : ""}</td>
        <td class="tiny">${esc(r.via || "")}</td>
      </tr>`;
    }).join("");
    const meta = document.getElementById("clubProbeMeta");
    if (meta) meta.innerHTML = `Read ${esc(P.checkedAt)} via <span class="kbd">app.bsky.actor.getProfiles</span> (keyless, batched).
      <b>${esc(String(P.summary.handlesProbed))}</b> candidate handles probed · <b>${esc(String(P.summary.resolved))}</b> resolved ·
      <b>${esc(String(P.summary.absent))}</b> do not exist · <b class="bad">${esc(String(P.summary.withValidVerificationObject))}</b> with a valid
      verification object · <b class="bad">${esc(String(P.summary.impersonationLabelled))}</b> labelled impersonation by Bluesky.
      <a href="${esc(P.probeUrl)}" target="_blank" rel="noopener">re-run the probe ↗</a> ·
      <a href="${esc(P.leagueFollows.url)}" target="_blank" rel="noopener">league follows (${esc(String(P.leagueFollows.count))}) ↗</a> ·
      <a href="${esc(P.starterPack.url)}" target="_blank" rel="noopener">third-party starter pack (${esc(String(P.starterPack.listItemCount))} items) ↗</a>
      <div class="tiny muted" style="margin-top:4px">${esc(P.summary.meaning)}</div>
      ${P.summary.reprobe ? `<div class="tiny" style="margin-top:6px"><b>Latest re-probe ${esc(P.summary.reprobe.when)}:</b>
      ${esc(String(P.summary.reprobe.handlesRequested))} handles requested · ${esc(String(P.summary.reprobe.resolved))} resolved ·
      <b class="${P.summary.reprobe.withValidVerificationObject.length ? "ok" : "bad"}">${esc(String(P.summary.reprobe.withValidVerificationObject.length))}</b> with a valid verification object
      (${esc(P.summary.reprobe.withValidVerificationObject.join(", "))}) · changed since last probe: <b>${esc(String(P.summary.reprobe.changed.length))}</b> ·
      <a href="${esc(P.summary.reprobe.url)}" target="_blank" rel="noopener">re-run ↗</a>
      <div class="muted">${esc(P.summary.reprobe.meaning)}</div></div>` : ""}`;
  }

  /* ===================================================================================
   * INSTAGRAM / FACEBOOK — why they are links and not feeds. Rendered from the SOURCES registry
   * so the wording on this page cannot drift from the wording the source audit publishes.
   * =================================================================================== */
  function renderSocialBlockers() {
    const el = document.getElementById("socialBlockers");
    if (!el || typeof SOURCES === "undefined") return;
    const esc = AlertEngine.escapeHtml;
    const rows = SOURCES.filter(s => s.id === "instagram-public-pages" || s.id === "facebook-public-pages" || s.id === "x-api");
    if (!rows.length) return;
    el.innerHTML = rows.map(s => `<div class="callout warn" style="margin-bottom:8px">
      <b>${esc(s.name)}</b>
      <div class="tiny" style="margin-top:4px">${esc(s.verified || "")}</div>
      <div class="tiny muted" style="margin-top:4px">${esc(s.note || "")}</div>
      <div class="tiny" style="margin-top:4px"><a href="${esc(s.review || s.url)}" target="_blank" rel="noopener">evidence ↗</a></div>
    </div>`).join("");
  }

  function init() {
    const filter = { tier: "ALL", status: "ALL", inArena: "ALL", q: "" };
    renderTable(filter);
    renderBsky();
    renderPills();
    renderRubric();
    renderCoverage();
    renderArenaMatrix();
    renderClubProbe();
    renderSocialBlockers();
    renderVerifyStatus();
    renderDrift();
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
