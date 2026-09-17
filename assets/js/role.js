/* =====================================================================================
 * role.js — LINEUP IMPACT + INJURY-LISTING HISTORY (shared by browser, CI poller and tests)
 *
 * WHY THIS EXISTS
 *   The brief asks for "the severity of each injury … based upon their current status on
 *   the team, whether they are a rotation player or a player in the starting lineup", plus
 *   "look to see their injury history and whether they are ruled out or ever exit out
 *   during game". Two completely different things are being conflated there, and this
 *   module keeps them apart:
 *
 *     AVAILABILITY  = what the source says (Out / Doubtful / Questionable / …)
 *     LINEUP IMPACT = how much of the team's on-court production that absence removes
 *     MEDICAL SEVERITY = NOT COMPUTED. No free source reviewed on 2026-09-17 publishes a
 *                        medical severity grade, and inferring one from a headline would be
 *                        a fabrication. The UI says "not assessed".
 *
 *   Lineup impact is therefore built ONLY from explicit, linkable observations:
 *     1. starter/bench flags + minutes from ESPN box scores this project has actually
 *        collected (data/live/context.json `roles` + accumulated `roleStats`), and
 *     2. dated injury-listing entries ESPN carries on the same roster payload (`injuryEntries`),
 *        used as LISTING CADENCE (how often the player appeared on a report), never as a
 *        medical record, and
 *     3. in-game-exit signals already recorded by the social layer (`exits`), always labelled
 *        "reported, unconfirmed" because a post is not a league designation.
 *
 *   If none of (1) is present the answer is `unknown`, not a guess. Silence is reported as
 *   silence. That is a deliberate product decision: a wrong "starter" tag changes how a reader
 *   reacts to an alert.
 *
 * Data shape produced (all fields optional, never invented):
 *   { impact, impactLabel, role:{label,tier,games,starts,avgMinutes,evidence[]},
 *     listing:{count,dates[],source}, exit:{...}|null, notes[] }
 * ===================================================================================== */
"use strict";

const LineupImpact = (function () {
  /* Every threshold is a documented, tunable constant — the label text quotes them. */
  const CONFIG = {
    minGamesForRole: 3,        // collected games needed before ANY season-long role is asserted
    starterShare: 0.6,         // starts / games  >= 0.6  -> "starter"
    rotationMinutes: 18,       // avg minutes per collected game >= 18 -> "rotation"
    benchMinutes: 10,          // avg minutes per collected game < 10  -> "bench/depth"
    roleFreshMs: 45 * 24 * 3600000,   // accumulated box-score samples older than this are ignored
    currentGameFreshMs: 3 * 24 * 3600000,  // "started in THIS game" only speaks for the next few days
    rosterFreshMs: 48 * 3600000,      // a stale roster capture is reported as missing, not trusted
    listingRecentDays: 270            // how far back listing cadence looks
  };

  const TIER_LABEL = {
    starter: "Starter (box-score evidence)",
    rotation: "Rotation (box-score evidence)",
    bench: "Bench / depth (box-score evidence)",
    unknown: "Unknown — no box-score evidence collected"
  };

  function isFresh(iso, maxAge) {
    const t = Date.parse(iso || "");
    return Number.isFinite(t) && t <= Date.now() + 60000 && Date.now() - t <= maxAge;
  }

  function uniqueUrls(list) {
    const seen = new Set();
    const out = [];
    for (const u of list) if (u && !seen.has(u) && out.length < 3) { seen.add(u); out.push(u); }
    return out;
  }

  /* ---------- role tier from collected box-score observations ---------- */
  function tierFromObservations(stats, currentRole) {
    const currentStarter = !!(currentRole && isFresh(currentRole.observedAt, CONFIG.currentGameFreshMs) && /Starter/i.test(currentRole.role || ""));
    /* Staleness is checked on the aggregate too: a sample from the finished season must not be
     * presented as this week's role. When it is old the tier becomes unknown WITH a note. */
    const statsFresh = !!(stats && stats.games >= CONFIG.minGamesForRole && (!stats.updatedAt || isFresh(stats.updatedAt, CONFIG.roleFreshMs)));
    const statsStale = !!(stats && stats.games >= CONFIG.minGamesForRole && stats.updatedAt && !isFresh(stats.updatedAt, CONFIG.roleFreshMs));
    /* The aggregate wins when it exists: a single box score proves tonight's lineup, not the role.
     * The current-game flag is still carried through so the UI can say "started tonight". */
    if (statsStale) {
      return { tier: "unknown", games: stats.games, starts: stats.starts || 0, avgMinutes: null, staleSample: true, staleAt: stats.updatedAt, currentGameStarter: currentStarter };
    }
    if (currentStarter && !statsFresh) {
      return { tier: "starter", source: "current game box score", games: 1, starts: 1, avgMinutes: numOrNull(currentRole.minutes), currentGameStarter: true };
    }
    if (!statsFresh) {
      return { tier: "unknown", games: stats ? stats.games || 0 : 0, starts: stats ? stats.starts || 0 : 0, avgMinutes: null, currentGameStarter: currentStarter };
    }
    const games = stats.games, starts = stats.starts || 0;
    const avg = stats.minutesGames ? stats.minutesTotal / stats.minutesGames : null;
    const share = games ? starts / games : 0;
    let tier = "unknown";
    if (share >= CONFIG.starterShare) tier = "starter";
    else if (avg != null && avg >= CONFIG.rotationMinutes) tier = "rotation";
    else if (avg != null && avg < CONFIG.benchMinutes) tier = "bench";
    else tier = "unclear";       // collected games exist but neither threshold is decisive
    return { tier, games, starts, avgMinutes: avg, share, currentGameStarter: currentStarter };
  }

  function findCurrentRole(playerId, team, context) {
    for (const r of (context && context.roles) || []) {
      if (String(r.playerId) === String(playerId) && r.team === team && isFresh(r.observedAt, CONFIG.roleFreshMs)) return r;
    }
    return null;
  }

  /* Median + spread from bounded per-game minute values (collector stores minutesValues).
   * A mean over a blowout-heavy 6-game sample misleads silently; the median and range say so. */
  function medianOf(values) {
    const v = (values || []).filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!v.length) return null;
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }

  function numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

  function rosterPlayer(player, playerId, team, context) {
    const cap = context && context.rosters && context.rosters[team];
    if (!cap || !isFresh(cap.fetchedAt, CONFIG.rosterFreshMs)) return null;
    const list = cap.players || [];
    return list.find(p => (playerId && String(p.playerId) === String(playerId)))
        || list.find(p => foldName(p.player) === foldName(player))
        || null;
  }
  function foldName(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  }

  /* ---------- listing cadence (ESPN roster injuries[] entries: {status,date}) ---------- */
  function listingCadence(rp) {
    const entries = (rp && Array.isArray(rp.injuryEntries) ? rp.injuryEntries : [])
      .filter(e => e && e.date && Number.isFinite(Date.parse(e.date)) && Date.now() - Date.parse(e.date) < CONFIG.listingRecentDays * 86400000);
    const dates = [...new Set(entries.map(e => e.date.slice(0, 10)))].sort();
    return { count: dates.length, dates, statuses: [...new Set(entries.map(e => e.status).filter(Boolean))], source: rp && rp.rosterUrl };
  }

  /* ---------- the assessment ---------- */
  function assess(row, context) {
    const out = {
      impact: "unknown",
      impactLabel: "IMPACT UNKNOWN — no collected role evidence",
      role: { label: TIER_LABEL.unknown, tier: "unknown", games: 0, starts: 0, avgMinutes: null, evidence: [] },
      listing: { count: 0, dates: [], statuses: [] },
      exit: null,
      contract: null,
      notes: [],
      config: { minGames: CONFIG.minGamesForRole, starterShare: CONFIG.starterShare, rotationMinutes: CONFIG.rotationMinutes, benchMinutes: CONFIG.benchMinutes }
    };
    if (!row || !row.team) { out.notes.push("No team attached to the listing, so no roster context can be applied."); return out; }

    const cap = (context && context.rosters) ? context.rosters[row.team] : null;
    /* A context file with NO schema marker predates the schema-2 collector (or was assembled by
     * hand) — its gaps may simply mean "fields not collected yet". Pinned by the smoke assertion
     * "schema gap is disclosed", which the test harness had never actually run (dead closure,
     * found and fixed 2026-09-17, session 6). */
    if (context && context.schema == null && cap) {
      out.notes.push("Context file is schema unmarked (no schema field — written by a collector older than schema 2, or assembled by hand): it may predate injury-listing, contract and role-stat fields, so a gap in this file is a capture gap, not a fact about the player.");
    }

    const stats = context && context.roleStats ? context.roleStats[String(row.playerId || row.player)] : null;
    const currentRole = findCurrentRole(row.playerId, row.team, context);
    const t = tierFromObservations(stats, currentRole);
    const evidence = uniqueUrls([currentRole && currentRole.url, ...((stats && stats.sampleUrls) || [])]);

    /* Median minutes + divergence note: a mean over a small, blowout-heavy sample misleads, so
     * the collector keeps bounded per-game values (minutesValues) and the UI quotes both. */
    const med = (stats && Array.isArray(stats.minutesValues) && stats.minutesValues.length >= 3 && !t.staleSample)
      ? medianOf(stats.minutesValues) : null;

    out.role = {
      label: TIER_LABEL[t.tier] || ("Role unclear in " + t.games + " collected game(s) — review box scores"),
      tier: t.tier, games: t.games || 0, starts: t.starts || 0,
      avgMinutes: t.avgMinutes == null ? null : Math.round(t.avgMinutes * 10) / 10,
      medianMinutes: med == null ? null : Math.round(med * 10) / 10,
      startShare: t.share == null ? null : Math.round(t.share * 100) / 100,
      evidence
    };
    if (t.currentGameStarter) out.role.startedThisGame = true;
    if (med != null && out.role.avgMinutes != null && (out.role.games || 0) >= 5 && Math.abs(out.role.avgMinutes - med) >= 8) {
      out.notes.push(`Collected minutes swing widely: median ${out.role.medianMinutes} vs mean ${out.role.avgMinutes} over ${out.role.games} game(s) — a blowout-heavy or injury-shortened sample; read the average with care.`);
    }
    /* A trade silently aliases minutes: the aggregate keeps the team it was collected under, so
     * when the listing's team differs the sample must be flagged, not quietly reassigned. */
    if (stats && stats.team && row.team && stats.team !== row.team) {
      out.role.teamChanged = true;
      out.notes.push(`Box-score sample was collected with ${stats.team}; the player has since moved to ${row.team}. A team change resets nothing automatically — the cross-team sample is flagged, and new-team observations keep accumulating from here.`);
    }
    if (t.staleSample) {
      out.role.staleSample = true;
      out.notes.push("Collected box-score sample exists but was last refreshed " + (t.staleAt || "at an unknown time") + ", outside the " + Math.round(CONFIG.roleFreshMs / 86400000) + "-day window — an old sample is not this week's role, so impact is withheld.");
    }
    if (t.source) out.notes.push("Role taken from the current game's ESPN box score — one start proves tonight's lineup, not a season role.");
    else if (out.role.games) out.notes.push(`Role computed from ${out.role.games} collected box score(s): ${out.role.starts} start(s), ${out.role.avgMinutes ?? "n/a"} avg min — thresholds: >=${Math.round(CONFIG.starterShare * 100)}% starts or >=${CONFIG.rotationMinutes} min = starter/rotation, <${CONFIG.benchMinutes} min = depth.`);
    else out.notes.push("No box-score observation has been collected for this player, so lineup impact is unknown. Absence of evidence is reported as unknown, never as 'role player'.");

    const rp = rosterPlayer(row.player, row.playerId, row.team, context);
    if (rp) {
      out.listing = listingCadence(rp);
      out.position = rp.position || null;
      out.rosterStatus = rp.rosterStatus || null;
      if (rp.experienceYears != null) out.experienceYears = rp.experienceYears;
      if (rp.playerUrl) out.playerUrl = rp.playerUrl;
      if (rp.salaryCurrent != null) {
        out.contract = { salary: rp.salaryCurrent, season: rp.salarySeason || null, source: rp.rosterUrl || null };
        /* ESPN files $0 for two-way/Exhibit-100 deals. Saying "$0.0M" would read like a fact about
         * the player's worth; it is a quirk of the source, so it is named as one. */
        if (Number(rp.salaryCurrent) === 0) out.contract.zero = true;
      } else {
        /* A player present in the roster capture but with NO contract entry at all is its own
         * state: two-way, expired or simply unpublished — the source does not say which. Silence
         * here used to read like "contract unknown anywhere", which is a claim we cannot make. */
        out.contract = { missing: true, label: "ESPN's roster feed filed no contract entry for " + (row.player || "this player") +
          " — a two-way, an expired deal or an unpublished one; the source does not say which. No contract value is asserted." };
      }
      if (out.listing.count >= 2) out.notes.push(`Injury-listing cadence: ${out.listing.count} dated listings in the last ${Math.round(CONFIG.listingRecentDays / 30)} months on ESPN's roster feed — a recurrence indicator, not a medical history.`);
    } else {
      out.notes.push("Roster capture is missing, stale (>" + Math.round(CONFIG.rosterFreshMs / 3600000) + "h) or failed for " + row.team + " — no listing cadence or contract context is asserted.");
    }

    /* in-game exit reported by a verified account (from the evidence ledger), always unconfirmed */
    const exits = (context && context.exits) || {};
    const ex = exits[String(row.playerId || row.player)];
    if (ex && ex.url) {
      out.exit = { at: ex.postedAt || ex.observedAt || null, by: ex.name || ex.handle || null, url: ex.url, text: ex.text || null, status: ex.status || "reported-unconfirmed" };
      out.notes.push("An in-game exit was reported by a monitored account (not a league designation) — see the linked post.");
    }

    /* impact matrix: availability severity x role tier. Never medical severity. */
    const sev = row.sev || "mention";
    const heavy = sev === "out" || sev === "doubtful";
    if (out.role.tier === "starter") {
      out.impact = heavy ? "high" : (sev === "questionable" ? "medium" : "low");
      out.impactLabel = heavy ? "HIGH — projected/confirmed starter is off the floor"
        : sev === "questionable" ? "MEDIUM — starter is a game-time decision" : "LOW — starter listed, not out";
    } else if (out.role.tier === "rotation") {
      out.impact = heavy ? "medium" : "low";
      out.impactLabel = heavy ? "MEDIUM — rotation minutes are vacated" : "LOW — rotation player listed, expected to play";
    } else if (out.role.tier === "bench") {
      out.impact = "low";
      out.impactLabel = heavy ? "LOW — depth player out (roster spot, not rotation)" : "LOW — depth player listed";
    } else if (out.role.tier === "unclear") {
      out.impact = "unknown";
      out.impactLabel = "UNCLEAR — collected games exist but neither threshold is decisive";
    } else {
      out.impact = "unknown";
      out.impactLabel = "IMPACT UNKNOWN — no role evidence collected";
    }
    /* Distinguish 'this capture has no listing history at all' (collector not run for this team,
     * or an older file version) from 'this player has one dated listing'. Only the first is a gap.
     * (`cap` is hoisted to the top of assess() — the schema-unmarked disclosure uses it too.) */
    const capPlayers = (cap && cap.players) || [];
    if (cap && capPlayers.length && !capPlayers.some(p => Array.isArray(p.injuryEntries))) {
      out.notes.push("This team's roster capture contains no dated injury-listing array at all (file written before that field was collected, or the collector has not run since) — cadence and salary are unavailable BY CAPTURE VERSION, not because the player has none. Re-run tools/collect_context.js.");
    }

    if (out.exit && out.impact === "unknown") out.impactLabel += " · in-game exit reported (unconfirmed)";
    else if (out.exit) out.impactLabel += " · in-game exit reported (unconfirmed)";

    /* a two-way/Exhibit-100 contract is factual context from the same roster payload; it is NOT
     * used to set the tier, only to explain it, because a two-way can still start a game. */
    if (out.contract && out.contract.salary != null) {
      const seasonLabel = out.contract.season ? ("for the " + out.contract.season + " season") : "season not stated by the source";
      out.contract.label = out.contract.zero
        ? "ESPN's roster feed files " + money(0) + " " + seasonLabel + " — the value two-way and Exhibit-100 contracts carry in this data, not a statement about the player. Contract type is not published by this source."
        : "Salary on file with ESPN's roster feed " + seasonLabel + ": " + money(out.contract.salary);
    }
    return out;
  }

  function money(n) {
    if (n == null || !Number.isFinite(n)) return "unknown";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + Math.round(n / 1e3) + "K";
    return "$" + n;
  }

  /* one-line summary for alert titles / wire badges (no markup, no claims beyond evidence) */
  function summaryText(assessment) {
    if (!assessment) return "";
    const bits = [assessment.impactLabel];
    if (assessment.role.games) bits.push(assessment.role.label + " (" + assessment.role.starts + " of " + assessment.role.games + " collected games started" + (assessment.role.avgMinutes != null ? ", " + assessment.role.avgMinutes + " min avg" : "") + (assessment.role.medianMinutes != null ? ", median " + assessment.role.medianMinutes : "") + ")");
    if (assessment.listing.count >= 2) bits.push(assessment.listing.count + " dated injury listings");
    return bits.join(" · ");
  }

  return { CONFIG, assess, summaryText, tierFromObservations, listingCadence, money, foldName, isFresh };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LineupImpact;
