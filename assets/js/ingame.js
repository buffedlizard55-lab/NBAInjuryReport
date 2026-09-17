/* In-game injury monitor.
 *
 * What it does: while an NBA game is LIVE on the ESPN scoreboard, poll that game's
 * ESPN summary endpoint and surface players who are not playing for injury reasons
 * (in-game exits / ruled-out in-game), then alert + log them with review links.
 *
 * Verification basis (2026-09-17 — see sources.html, source 'espn-summary-api'):
 *   - Summary payload for a completed game exposes
 *       boxscore.players[].statistics[].athletes[] -> { didNotPlay, reason, ejected }
 *     and a game `article` recap. Verified live on event 401811041 (ORL@BOS 2026-04-12).
 *   - "COACH'S DECISION" was DIRECTLY OBSERVED as a non-injury `reason` value and is
 *     excluded by NON_INJURY_RE below.
 *   - No live game exists during the offseason, so live-only behavior (e.g. ESPN
 *     adding in-game `injuries` arrays) is parsed defensively and flagged as untested.
 *
 * Design rule: this module NEVER asserts an injury. It reports exactly what the
 * feed reports ("not playing — <reason as stated by ESPN>") and always links the
 * ESPN game page for manual review.
 */
"use strict";

const InGame = (() => {
  const LS_SEEN = "nba-ingame-seen-v1";
  const REQUEST_TIMEOUT_MS = 15000;

  /* Injury-keyword match for DNP reasons. Counter-example captured during
   * verification: "COACH'S DECISION" (matches nothing below and is also
   * explicitly excluded by NON_INJURY_RE). */
  const INJURY_REASON_RE = /injur|hurt|illness|sick|concussion|protocol|sore(ness)?|sprain|strain|contusion|fracture|bruise|torn|ruptur|achilles|acl\b|mcl\b|meniscus|labrum|knee|ankle|hamstring|calf|groin|back|shoulder|wrist|elbow|hip|foot|feet|toe|finger|hand|thumb|neck|oblique|quad|heel|chest|head|stinger|laceration|dislocat/i;
  const NON_INJURY_RE = /coach|decision|rest|g ?league|assignment|suspension|suspended|ejection|ejected|personal|trade|waiv/i;

  let seenPrimed = false; // first load seeds the seen-set WITHOUT alerting (same rule as the wire)

  function getSeen() {
    try { return new Set(JSON.parse(localStorage.getItem(LS_SEEN) || "[]")); }
    catch (e) { return new Set(); }
  }
  function saveSeen(set) {
    localStorage.setItem(LS_SEEN, JSON.stringify([...set].slice(-400)));
  }

  function eventUrl(id) { return "https://www.espn.com/nba/game/_/gameId/" + id; }

  /* Extract injury-signal entries from one summary payload. Pure function -> smoke-testable. */
  function extract(summary, eventId, matchup) {
    const out = [];
    const players = summary && summary.boxscore && summary.boxscore.players;
    if (Array.isArray(players)) {
      for (const side of players) {
        const abbr = side && side.team && side.team.abbreviation;
        for (const stat of (side.statistics || [])) {
          for (const row of (stat.athletes || [])) {
            if (!row || row.didNotPlay !== true || row.ejected === true) continue;
            const reason = String(row.reason || "").trim();
            if (!reason || !INJURY_REASON_RE.test(reason) || NON_INJURY_RE.test(reason)) continue;
            const name = (row.athlete && (row.athlete.displayName || row.athlete.shortName)) || "Unknown player";
            out.push({
              id: "dnp-" + eventId + "-" + ((row.athlete && row.athlete.id) || name),
              kind: "DNP",
              player: name, team: abbr || "?", reason,
              matchup, url: eventUrl(eventId),
              sev: "out", sevLabel: "OUT — IN-GAME LISTING"
            });
          }
        }
      }
    }
    /* Defensive: some ESPN summary payloads also carry per-team `injuries` arrays.
     * Presence NOT verified for NBA live games — parse only if the shape matches. */
    const injSection = summary && summary.injuries;
    if (Array.isArray(injSection)) {
      for (const side of injSection) {
        const abbr = side && side.team && side.team.abbreviation;
        for (const inj of (side.injuries || [])) {
          const name = (inj.athlete && (inj.athlete.displayName || inj.athlete.shortName)) || "Unknown player";
          const status = String(inj.status || "").trim();
          const detail = inj.details ? String(inj.details.comment || inj.details.type || inj.details.description || "").trim() : "";
          const text = name + " " + status + " " + detail;
          if (!status && !detail) continue;
          if (!INJURY_REASON_RE.test(text) && !/out|doubtful|questionable|day-to-day/i.test(status)) continue;
          out.push({
            id: "inj-" + eventId + "-" + ((inj.athlete && inj.athlete.id) || name) + "-" + status,
            kind: "LISTING",
            player: name, team: abbr || "?", reason: (status + (detail ? " — " + detail : "")).trim(),
            matchup, url: eventUrl(eventId),
            sev: /questionable|day-to-day/i.test(status) ? "questionable" : /doubtful/i.test(status) ? "doubtful" : "out",
            sevLabel: (status || "INJURY LISTING").toUpperCase() + " — IN-GAME"
          });
        }
      }
    }
    return out;
  }

  function liveEvents(events) {
    return (events || []).filter(ev => {
      const comp = (ev.competitions || [])[0] || {};
      return comp.status && comp.status.type && comp.status.type.state === "in";
    });
  }

  async function fetchSummary(eventId) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(ENDPOINTS.summary + eventId, { signal: ctrl.signal, cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (e) {
      console.warn("summary fetch failed for", eventId, e);
      return null;
    } finally { clearTimeout(to); }
  }

  function render(box, live, allFindings, note) {
    if (!box) return;
    if (!live.length) {
      box.innerHTML = `<div class="muted small">🏥 <b>In-game monitor:</b> armed — no live games right now.
        It activates automatically when a game tips (next: preseason 2026-10-03).
        <span class="tiny">⚠ Structure verified against completed-game data 2026-09-17; live-game behavior is untested until then
        (<a href="sources.html">verification log</a>).</span></div>`;
      return;
    }
    const rows = live.map(ev => {
      const comp = (ev.competitions || [])[0] || {};
      const cs = (comp.competitors || []);
      const away = cs.find(c => c.homeAway === "away") || {};
      const home = cs.find(c => c.homeAway === "home") || {};
      const matchup = `${away.team?.abbreviation || "?"} @ ${home.team?.abbreviation || "?"}`;
      const found = allFindings.filter(f => f.matchup === matchup);
      const list = found.length
        ? found.map(f => `<div class="dnp-item">
            <span class="tag ${f.sev}">${AlertEngine.escapeHtml(f.sevLabel)}</span>
            <b>${AlertEngine.escapeHtml(f.player)}</b> <span class="team-chip">${AlertEngine.escapeHtml(f.team)}</span>
            — <span class="muted">"${AlertEngine.escapeHtml(f.reason)}"</span>
            <a href="${AlertEngine.escapeHtml(f.url)}" target="_blank" rel="noopener">ESPN game ↗</a>
            <a href="${xSearchUrl(f.player + " " + (teamByAbbr(f.team) ? teamByAbbr(f.team).name : "") + " injury")}" target="_blank" rel="noopener">confirm on X ↗</a>
          </div>`).join("")
        : `<div class="muted tiny">No injury-related absences detected so far (checked every refresh; last check ${new Date().toLocaleTimeString()}).</div>`;
      return `<div class="ingame-game"><b>🔴 ${AlertEngine.escapeHtml(matchup)}</b>${list}</div>`;
    }).join("");
    box.innerHTML = rows + (note ? `<div class="tiny muted">${AlertEngine.escapeHtml(note)}</div>` : "");
  }

  /* Called by the dashboard after each scoreboard refresh. */
  async function check(events, isFirstLoad) {
    const box = document.getElementById("ingameBox");
    const live = liveEvents(events);
    if (!live.length) { render(box, [], [], null); return; }

    const results = await Promise.all(live.map(async ev => {
      const comp = (ev.competitions || [])[0] || {};
      const cs = (comp.competitors || []);
      const away = cs.find(c => c.homeAway === "away") || {};
      const home = cs.find(c => c.homeAway === "home") || {};
      const matchup = `${away.team?.abbreviation || "?"} @ ${home.team?.abbreviation || "?"}`;
      const summary = await fetchSummary(ev.id);
      return summary ? extract(summary, ev.id, matchup) : [];
    }));

    const findings = results.flat();
    const seen = getSeen();
    const fresh = [];
    for (const f of findings) {
      if (!seen.has(f.id)) { seen.add(f.id); fresh.push(f); }
    }
    saveSeen(seen);

    if (!seenPrimed) {
      // First run seeds silently so opening the page mid-game doesn't blast stale alerts.
      if (fresh.length) {
        AlertEngine.log(`🏥 In-game monitor seeded ${fresh.length} existing listing(s) silently (no alert on first load).`, null);
        AlertEngine.renderLog();
      }
      seenPrimed = true;
    } else if (!isFirstLoad) {
      const filters = (typeof App !== "undefined" && App.getFilters) ? App.getFilters() : null;
      for (const f of fresh) {
        const allowed = filters ? !!filters.sevs[f.sev] : true;
        if (allowed) AlertEngine.fire({ sevLabel: f.sevLabel, title: `${f.player} (${f.team}) — "${f.reason}" [${f.matchup}]`, url: f.url, sev: f.sev });
        else AlertEngine.log(`(muted by filter: ${f.sevLabel}) ${f.player} (${f.team}) — "${f.reason}"`, f.url);
      }
    }
    if (fresh.length && box) AlertEngine.renderLog();
    render(box, live, findings, findings.length ? "DNP = did not play, reason as stated by ESPN. Always confirm via the linked game page + X search." : null);
  }

  function resetSeen() { localStorage.removeItem(LS_SEEN); seenPrimed = false; }

  return { check, extract, liveEvents, resetSeen, INJURY_REASON_RE, NON_INJURY_RE };
})();
