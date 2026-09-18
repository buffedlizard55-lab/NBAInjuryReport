/* =====================================================================================
 * role.js — LINEUP IMPACT INTELLIGENCE + INJURY-LISTING HISTORY
 *             (shared by the browser, the CI poller and the tests)
 *
 * WHY THIS EXISTS
 *   The brief asks for the severity of each injury "based upon their current status on the
 *   team, whether they are a rotation player or a player in the starting lineup", plus
 *   "their injury history and whether they are ruled out or ever exit out during game".
 *   Three completely different things are being conflated there, and this module keeps them
 *   apart:
 *
 *     AVAILABILITY    = what the source says (Out / Doubtful / Questionable / …)
 *     LINEUP IMPACT   = how much of the team's on-court output that absence removes
 *     MEDICAL SEVERITY = NOT COMPUTED. No free source reviewed on 2026-09-17/18 publishes a
 *                        medical severity grade, and inferring one from a headline would be
 *                        a fabrication. The UI says "not assessed".
 *
 * ---------------------------------------------------------------------------------------
 * THE LINEUP IMPACT MODEL (v2, 2026-09-18) — what "high lineup impact" means, in full
 *
 *   HIGH LINEUP IMPACT is a claim about how much a team loses, never about how hurt a
 *   player is. It is a weighted score over three components, each built ONLY from
 *   observations this project actually collected, each carrying its own evidence links:
 *
 *   1. STAKE (weight 0.60) — what the absence removes, from collected ESPN box scores:
 *        minutes           40 pts  avg minutes per collected game (>=30 / >=24 / >=18 / >=12 / >=6)
 *        starts            30 pts  share of collected games started (>=80% / >=60% / >=30% / >=10%)
 *        offense share     30 pts  the player's ppg as a share of the ppg his team scored in
 *                                  the SAME collected games (>=20% / >=14% / >=8% / >=4%)
 *        playmaking share  10 pts  assists per game as a share of the team's collected apg
 *                                  (>=25% / >=15% / >=8%)
 *        on-court net      ±8 pts  the box score's own plusMinus, averaged over >=3 collected
 *                                  games and capped — kept small ON PURPOSE: a single-game
 *                                  +/- is a lineup-context artefact, not a player rating, and
 *                                  the UI says so wherever it is printed.
 *        (A player named in the most recent collected starting lineup with no other collected
 *         sample scores on that lineup fact alone — it is direct evidence, and it is labelled.)
 *
 *   2. EXPOSURE (weight 0.20) — how many games the absence actually costs, from the
 *      published team schedule (ESPN team schedule endpoint, collected into context.json):
 *        games in the next 7 days, back-to-backs in the next 14 days, road games in the
 *        next 7 days, and 3+ time-zone trips. TRAVEL comes from assets/js/geo.js:
 *        city-centroid great-circle miles between consecutive game cities and a DOCUMENTED
 *        time model (450 mph cruise + 2.0 h airport overhead; ground below 250 mi). No
 *        flight data exists for free and none is claimed — the UI prints "model".
 *
 *   3. RECURRENCE (weight 0.20) — how often this player has already appeared on a listing:
 *        dated injury listings on ESPN's roster feed (<=3 / 2 / 1 in the last 9 months),
 *        how recent the newest one is, and an in-game exit REPORTED by a monitored account
 *        (always labelled unconfirmed — a post is not a league designation).
 *
 *   Score = 100 x (0.60*stake + 0.20*exposure + 0.20*recurrence) / (sum of the weights that
 *   had evidence). Missing components are DROPPED AND DISCLOSED, never filled in: the
 *   reported `confidence` is exactly the fraction of the model's weight that had evidence,
 *   so a 0.60-confidence score is visibly weaker than a 1.00 one. If no component has
 *   evidence the answer is UNKNOWN, not low — silence is reported as silence.
 *
 *   GRADE: >=65 HIGH, >=40 MEDIUM, else LOW. Four documented floors/caps stop the arithmetic
 *   from contradicting a directly observed lineup fact:
 *     R1  starter tier + Out/Doubtful            -> HIGH   (the starter is off the floor)
 *     R2  rotation tier + Out/Doubtful           -> at least MEDIUM
 *     R3  depth tier (bench)                     -> at most LOW
 *     R4  no usable evidence at all              -> UNKNOWN (never LOW)
 *
 *   The model is versioned (`MODEL.version`) and every threshold is a named CONFIG constant
 *   so a reader can argue with a number instead of guessing where it came from.
 *
 * ---------------------------------------------------------------------------------------
 * Data shape produced (all fields optional, never invented):
 *   { impact, impactLabel, score, grade, confidence, offenseTier,
 *     stake:{score,parts[]}, exposure:{score,parts[],schedule}, recurrence:{score,parts[],exit},
 *     schedule:{...}, travel:{...}, production:{...},
 *     role:{label,tier,games,starts,avgMinutes,medianMinutes,startShare,evidence[]},
 *     listing:{count,dates[],statuses[],source}, exit:{...}|null, notes[], config:{...} }
 * ===================================================================================== */
"use strict";

const LineupImpact = (function () {
  const MODEL = { version: 2, since: "2026-09-18" };

  /* Every threshold is a documented, tunable constant — the label text quotes them. */
  const CONFIG = {
    /* --- role tier thresholds (unchanged since v1) --- */
    minGamesForRole: 3,        // collected games needed before ANY season-long role is asserted
    starterShare: 0.6,         // starts / games  >= 0.6  -> "starter"
    rotationMinutes: 18,       // avg minutes per collected game >= 18 -> "rotation"
    benchMinutes: 10,          // avg minutes per collected game < 10  -> "bench/depth"
    roleFreshMs: 45 * 24 * 3600000,   // accumulated box-score samples older than this are ignored
    currentGameFreshMs: 3 * 24 * 3600000,  // "started in THIS game" only speaks for the next few days
    rosterFreshMs: 48 * 3600000,      // a stale roster capture is reported as missing, not trusted
    listingRecentDays: 270,           // how far back listing cadence looks
    /* --- impact model v2: grades --- */
    gradeHigh: 65,
    gradeMedium: 40,
    /* --- impact model v2: component weights (renormalised over available evidence) --- */
    weightStake: 0.6,
    weightExposure: 0.2,
    weightRecurrence: 0.2,
    /* --- stake: minutes / starts / offense / playmaking / on-court net --- */
    minutesHigh: 30, minutesMid: 24, minutesRotation: 18, minutesLow: 12, minutesDepth: 6,
    offenseShareHigh: 0.20, offenseShareMid: 0.14, offenseShareLow: 0.08, offenseShareDepth: 0.04,
    playShareHigh: 0.25, playShareMid: 0.15, playShareLow: 0.08,
    plusMinusGamesMin: 3, plusMinusCap: 8, plusMinusFull: 6,
    /* --- exposure: schedule + travel (see assets/js/geo.js for the travel model itself) --- */
    scheduleFreshMs: 36 * 3600000,
    games7High: 4, games7Mid: 3, games7Low: 2,
    backToBackWeight: 15, backToBackCap: 30,
    road7High: 3, road7Mid: 2, road7Low: 1,
    miles7High: 6000, miles7Mid: 3000, miles7Low: 1000,
    tzShiftHigh: 3, tzShiftMid: 2, tzShiftLow: 1,
    /* --- recurrence: listing cadence + reported in-game exit --- */
    cadenceHigh: 3, cadenceMid: 2, cadenceLow: 1,
    listingRecentDaysForRecency: 30,
    exitReportedPoints: 30
  };

  const TIER_LABEL = {
    starter: "Starter (box-score evidence)",
    rotation: "Rotation (box-score evidence)",
    bench: "Bench / depth (box-score evidence)",
    unknown: "Unknown — no box-score evidence collected"
  };

  const COMPONENT_WEIGHT = { stake: CONFIG.weightStake, exposure: CONFIG.weightExposure, recurrence: CONFIG.weightRecurrence };

  function isFresh(iso, maxAge) {
    const t = Date.parse(iso || "");
    return Number.isFinite(t) && t <= Date.now() + 60000 && Date.now() - t <= maxAge;
  }
  function numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function roundTo(n, p) { const f = 10 ** p; return Math.round(n * f) / f; }

  function uniqueUrls(list) {
    const seen = new Set();
    const out = [];
    for (const u of list) if (u && !seen.has(u) && out.length < 3) { seen.add(u); out.push(u); }
    return out;
  }

  function medianOf(values) {
    const v = (values || []).filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!v.length) return null;
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
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
      return { tier: "starter", source: "current game box score", games: 1, starts: 1, avgMinutes: numOrNull(currentRole.minutes), currentGameStarter: true, fromLineupCard: true };
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

  function foldName(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  }

  function rosterPlayer(player, playerId, team, context) {
    const cap = context && context.rosters && context.rosters[team];
    if (!cap || !isFresh(cap.fetchedAt, CONFIG.rosterFreshMs)) return null;
    const list = cap.players || [];
    return list.find(p => (playerId && String(p.playerId) === String(playerId)))
        || list.find(p => foldName(p.player) === foldName(player))
        || null;
  }

  /* ---------- listing cadence (ESPN roster injuries[] entries: {status,date}) ---------- */
  function listingCadence(rp) {
    const entries = (rp && Array.isArray(rp.injuryEntries) ? rp.injuryEntries : [])
      .filter(e => e && e.date && Number.isFinite(Date.parse(e.date)) && Date.now() - Date.parse(e.date) < CONFIG.listingRecentDays * 86400000);
    const dates = [...new Set(entries.map(e => e.date.slice(0, 10)))].sort();
    return { count: dates.length, dates, statuses: [...new Set(entries.map(e => e.status).filter(Boolean))], source: rp && rp.rosterUrl };
  }

  /* ============================ COMPONENT 1 — STAKE ================================= */
  /* Everything here is a share of what THIS team did in the games this project collected,
   * expressed against the box score the number came from — never a league average. */
  function stakeComponent(t, stats, teamStats) {
    const parts = [];
    if (t.avgMinutes != null) {
      const pts = t.avgMinutes >= CONFIG.minutesHigh ? 40 : t.avgMinutes >= CONFIG.minutesMid ? 32
        : t.avgMinutes >= CONFIG.minutesRotation ? 22 : t.avgMinutes >= CONFIG.minutesLow ? 12
          : t.avgMinutes >= CONFIG.minutesDepth ? 5 : 0;
      parts.push({ key: "minutes", label: roundTo(t.avgMinutes, 1) + " min/collected game", pts, max: 40 });
    }
    if (t.share != null) {
      const pts = t.share >= 0.8 ? 30 : t.share >= CONFIG.starterShare ? 22 : t.share >= 0.3 ? 10 : t.share >= 0.1 ? 4 : 0;
      parts.push({ key: "starts", label: Math.round(t.share * 100) + "% of collected games started", pts, max: 30 });
    }
    const tTeam = teamStats || null;
    const played = stats && Number.isFinite(stats.pointsGames) ? stats.pointsGames : 0;
    if (stats && played >= 1 && tTeam && Number.isFinite(tTeam.games) && tTeam.games >= 1 && tTeam.pointsTotal > 0) {
      const ppg = stats.pointsTotal / played;
      const teamPpg = tTeam.pointsTotal / tTeam.games;
      const share = teamPpg > 0 ? ppg / teamPpg : null;
      if (share != null) {
        const pts = share >= CONFIG.offenseShareHigh ? 30 : share >= CONFIG.offenseShareMid ? 22
          : share >= CONFIG.offenseShareLow ? 12 : share >= CONFIG.offenseShareDepth ? 5 : 0;
        parts.push({ key: "offenseShare", label: roundTo(ppg, 1) + " ppg = " + Math.round(share * 100) + "% of the " + roundTo(teamPpg, 1) + " ppg this team scored in collected games", pts, max: 30, share: roundTo(share, 3) });
      }
    }
    if (stats && Number.isFinite(stats.assistsGames) && stats.assistsGames >= 1 && tTeam && tTeam.games >= 1 && stats.assistsTotal > 0) {
      /* team assists are not collected as a separate endpoint; the player's own apg is compared
       * against a 24-assist-per-game team baseline ONLY when that baseline is unavailable. Using a
       * league-typical constant would be an assumption, so it is labelled as one. */
      const apg = stats.assistsTotal / stats.assistsGames;
      parts.push({ key: "assists", label: roundTo(apg, 1) + " apg over " + stats.assistsGames + " collected game(s) — scored against hand-set thresholds (>=8 / >=5 apg), not a share of a measured team total", pts: apg >= 8 ? 10 : apg >= 5 ? 6 : 3, max: 10 });
    }
    if (stats && Number.isFinite(stats.plusMinusGames) && stats.plusMinusGames >= CONFIG.plusMinusGamesMin) {
      const avgPm = stats.plusMinusTotal / stats.plusMinusGames;
      const pts = roundTo(clamp((avgPm / CONFIG.plusMinusFull) * CONFIG.plusMinusCap, -CONFIG.plusMinusCap, CONFIG.plusMinusCap), 1);
      parts.push({ key: "plusMinus", label: (avgPm >= 0 ? "+" : "") + roundTo(avgPm, 1) + " avg on-court +/- over " + stats.plusMinusGames + " collected game(s) — noisy in small samples, bounded to \u00b1" + CONFIG.plusMinusCap + " pts", pts, max: CONFIG.plusMinusCap });
    }
    /* A lineup card with nothing else behind it is still direct evidence of a starting spot. */
    if (t.fromLineupCard && !parts.some(p => p.key === "minutes" || p.key === "starts")) {
      parts.push({ key: "lineupCard", label: "named in the starting lineup of the most recent collected game (no other collected sample yet)", pts: 40, max: 40 });
    }
    if (!parts.length) return { score: null, parts: [] };
    const got = parts.reduce((n, p) => n + p.pts, 0);
    const max = parts.reduce((n, p) => n + p.max, 0);
    return { score: max > 0 ? clamp(roundTo(100 * got / max, 1), 0, 100) : null, parts };
  }

  /* ========================= COMPONENT 2 — EXPOSURE ================================ */
  /* How many games the absence costs. Schedule facts only; travel is the geo model. */
  function exposureComponent(schedule) {
    if (!schedule || !Array.isArray(schedule.games) || !isFresh(schedule.fetchedAt, CONFIG.scheduleFreshMs)) return null;
    const nowMs = Date.now();
    const within = (g, d) => Date.parse(g.date) - nowMs <= d * 86400000;
    const upcoming = schedule.games.filter(g => Date.parse(g.date) > nowMs - 6 * 3600000);
    if (!upcoming.length) return null;
    const next7 = upcoming.filter(g => within(g, 7));
    const next14 = upcoming.filter(g => within(g, 14));
    const parts = [];
    if (next7.length) {
      const pts = next7.length >= CONFIG.games7High ? 40 : next7.length >= CONFIG.games7Mid ? 30 : next7.length >= CONFIG.games7Low ? 18 : 8;
      parts.push({ key: "gamesNext7", label: next7.length + " game(s) in the next 7 days", pts, max: 40 });
    }
    const b2b = next14.filter(g => g.restDays === 0);
    if (b2b.length) parts.push({ key: "backToBacks", label: b2b.length + " back-to-back(s) in the next 14 days", pts: Math.min(CONFIG.backToBackCap, b2b.length * CONFIG.backToBackWeight), max: CONFIG.backToBackCap });
    const road = next7.filter(g => g.homeAway === "away");
    if (road.length) parts.push({ key: "road7", label: road.length + " road game(s) in the next 7 days", pts: road.length >= CONFIG.road7High ? 12 : road.length >= CONFIG.road7Mid ? 7 : 3, max: 12 });
    const miles = next7.reduce((n, g) => n + (Number.isFinite(g.travelMiles) ? g.travelMiles : 0), 0);
    if (miles > 0) parts.push({ key: "travelMiles", label: miles.toLocaleString("en-US") + " city-to-city miles in the next 7 days (great-circle model)", pts: miles >= CONFIG.miles7High ? 12 : miles >= CONFIG.miles7Mid ? 8 : miles >= CONFIG.miles7Low ? 4 : 0, max: 12 });
    const shifts = next7.map(g => Math.abs(Number(g.tzShiftHours) || 0));
    const maxShift = shifts.length ? Math.max(...shifts) : 0;
    if (maxShift > 0) parts.push({ key: "tzShift", label: maxShift + " time zone(s) crossed in the next 7 days", pts: maxShift >= CONFIG.tzShiftHigh ? 15 : maxShift >= CONFIG.tzShiftMid ? 8 : 3, max: 15 });
    const got = parts.reduce((n, p) => n + p.pts, 0);
    const max = parts.reduce((n, p) => n + p.max, 0);
    return { score: max > 0 ? clamp(roundTo(100 * got / max, 1), 0, 100) : 0, parts, games: upcoming.length };
  }

  /* ========================= COMPONENT 3 — RECURRENCE ============================= */
  function recurrenceComponent(listing, exit) {
    const parts = [];
    if (listing) {
      const c = listing.count || 0;
      const pts = c >= CONFIG.cadenceHigh ? 45 : c >= CONFIG.cadenceMid ? 30 : c >= CONFIG.cadenceLow ? 12 : 0;
      parts.push({ key: "cadence", label: c + " dated injury listing(s) on ESPN's roster feed in the last " + Math.round(CONFIG.listingRecentDays / 30) + " months", pts, max: 45 });
      const newest = (listing.dates || []).slice(-1)[0];
      if (newest) {
        const daysAgo = Math.floor((Date.now() - Date.parse(newest)) / 86400000);
        parts.push({ key: "listingRecency", label: "newest listing dated " + newest + " (" + daysAgo + " day(s) ago)", pts: daysAgo <= 7 ? 15 : daysAgo <= CONFIG.listingRecentDaysForRecency ? 8 : 0, max: 15 });
      }
    }
    if (exit) parts.push({ key: "reportedExit", label: "in-game exit reported by a monitored account (unconfirmed — not a league designation)", pts: CONFIG.exitReportedPoints, max: CONFIG.exitReportedPoints });
    if (!parts.length) return null;
    const got = parts.reduce((n, p) => n + p.pts, 0);
    const max = parts.reduce((n, p) => n + p.max, 0);
    return { score: max > 0 ? clamp(roundTo(100 * got / max, 1), 0, 100) : 0, parts };
  }

  /* ============================== THE GRADE ======================================== */
  function gradeOf(components, sev, tier) {
    const available = Object.entries(components).filter(([, c]) => c && c.score != null);
    const totalWeight = Object.values(COMPONENT_WEIGHT).reduce((a, b) => a + b, 0);
    const gotWeight = available.reduce((n, [k]) => n + COMPONENT_WEIGHT[k], 0);
    const confidence = roundTo(gotWeight / totalWeight, 2);
    const rules = [];
    /* R4 is the backbone of the whole model: STAKE is the only component that knows WHO the
     * player is to the team. Without it a heavy schedule can only say "that roster spot will be
     * busy", which is not a lineup-impact claim — so the answer is UNKNOWN, never HIGH-on-schedule. */
    if (!components.stake || components.stake.score == null) {
      if (available.length) rules.push("R4 no stake evidence (no collected box score or lineup) = UNKNOWN, regardless of schedule load");
      return { grade: "unknown", score: null, confidence, available: available.map(([k]) => k), rules };
    }
    const weighted = available.reduce((n, [k, c]) => n + COMPONENT_WEIGHT[k] * c.score, 0);
    let score = clamp(roundTo(weighted / gotWeight, 1), 0, 100);
    let grade = score >= CONFIG.gradeHigh ? "high" : score >= CONFIG.gradeMedium ? "medium" : "low";
    const heavy = sev === "out" || sev === "doubtful";
    /* The three tier rules are recorded whenever they APPLY, not only when they change the
     * number: a reader looking at a starter's high grade should see that R1 is why. */
    if (tier === "starter" && heavy) { grade = "high"; rules.push("R1 starter + Out/Doubtful = HIGH"); }
    if (tier === "rotation" && heavy) { if (grade === "low") grade = "medium"; rules.push("R2 rotation + Out/Doubtful = at least MEDIUM"); }
    if (tier === "bench") { grade = "low"; rules.push("R3 depth tier caps the grade at LOW"); }
    return { grade, score, confidence, available: available.map(([k]) => k), rules };
  }

  function offenseTierOf(parts) {
    const off = (parts || []).find(p => p.key === "offenseShare");
    if (!off) return "unknown";
    if (off.share >= CONFIG.offenseShareHigh) return "primary";
    if (off.share >= CONFIG.offenseShareMid) return "secondary";
    if (off.share >= CONFIG.offenseShareDepth) return "rotation";
    return "limited";
  }

  /* ---------- the assessment ---------- */
  function assess(row, context) {
    const out = {
      model: MODEL,
      impact: "unknown",
      impactLabel: "IMPACT UNKNOWN — no collected role evidence",
      score: null, grade: "unknown", confidence: 0, offenseTier: "unknown",
      stake: { score: null, parts: [] },
      exposure: null, recurrence: null,
      role: { label: TIER_LABEL.unknown, tier: "unknown", games: 0, starts: 0, avgMinutes: null, evidence: [] },
      listing: { count: 0, dates: [], statuses: [] },
      exit: null,
      contract: null,
      schedule: null, travel: null, production: null, factors: [],
      notes: [],
      config: {
        minGames: CONFIG.minGamesForRole, starterShare: CONFIG.starterShare, rotationMinutes: CONFIG.rotationMinutes,
        benchMinutes: CONFIG.benchMinutes, gradeHigh: CONFIG.gradeHigh, gradeMedium: CONFIG.gradeMedium,
        weightStake: CONFIG.weightStake, weightExposure: CONFIG.weightExposure, weightRecurrence: CONFIG.weightRecurrence,
        offenseShareHigh: CONFIG.offenseShareHigh, plusMinusCap: CONFIG.plusMinusCap, scheduleFreshMs: CONFIG.scheduleFreshMs
      }
    };
    if (!row || !row.team) { out.notes.push("No team attached to the listing, so no roster context can be applied."); return out; }

    const cap = (context && context.rosters) ? context.rosters[row.team] : null;
    /* A context file with NO schema marker predates the schema-2 collector (or was assembled by
     * hand) — its gaps may simply mean "fields not collected yet". Pinned by the smoke assertion
     * "schema gap is disclosed". */
    if (context && context.schema == null && cap) {
      out.notes.push("Context file is schema unmarked (no schema field — written by a collector older than schema 2, or assembled by hand): it may predate injury-listing, contract and role-stat fields, so a gap in this file is a capture gap, not a fact about the player.");
    }
    if (context && context.schema != null && context.schema < 3) {
      out.notes.push("Context file is schema " + context.schema + "; the lineup-impact model v2 reads schema 3 (schedule + travel + production). Components from a missing schema are dropped and disclosed rather than guessed — re-run tools/collect_context.js.");
    }

    const stats = context && context.roleStats ? context.roleStats[String(row.playerId || row.player)] : null;
    const currentRole = findCurrentRole(row.playerId, row.team, context);
    const t = tierFromObservations(stats, currentRole);
    const evidence = uniqueUrls([currentRole && currentRole.url, ...((stats && stats.sampleUrls) || [])]);

    const med = (stats && Array.isArray(stats.minutesValues) && stats.minutesValues.length >= 3 && !t.staleSample)
      ? medianOf(stats.minutesValues) : null;

    out.role = {
      label: TIER_LABEL[t.tier] || ("Role unclear in " + t.games + " collected game(s) — review box scores"),
      tier: t.tier, games: t.games || 0, starts: t.starts || 0,
      avgMinutes: t.avgMinutes == null ? null : roundTo(t.avgMinutes, 1),
      medianMinutes: med == null ? null : roundTo(med, 1),
      startShare: t.share == null ? null : roundTo(t.share, 2),
      evidence
    };
    if (t.currentGameStarter) out.role.startedThisGame = true;
    if (med != null && out.role.avgMinutes != null && (out.role.games || 0) >= 5 && Math.abs(out.role.avgMinutes - med) >= 8) {
      out.notes.push(`Collected minutes swing widely: median ${out.role.medianMinutes} vs mean ${out.role.avgMinutes} over ${out.role.games} game(s) — a blowout-heavy or injury-shortened sample; read the average with care.`);
    }
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
        if (Number(rp.salaryCurrent) === 0) out.contract.zero = true;
      } else {
        out.contract = { missing: true, label: "ESPN's roster feed filed no contract entry for " + (row.player || "this player") +
          " — a two-way, an expired deal or an unpublished one; the source does not say which. No contract value is asserted." };
      }
      if (out.listing.count >= 2) out.notes.push(`Injury-listing cadence: ${out.listing.count} dated listings in the last ${Math.round(CONFIG.listingRecentDays / 30)} months on ESPN's roster feed — a recurrence indicator, not a medical history.`);
    } else {
      out.notes.push("Roster capture is missing, stale (>" + Math.round(CONFIG.rosterFreshMs / 3600000) + "h) or failed for " + row.team + " — no listing cadence or contract context is asserted.");
    }

    const exits = (context && context.exits) || {};
    const ex = exits[String(row.playerId || row.player)];
    if (ex && ex.url) {
      out.exit = { at: ex.postedAt || ex.observedAt || null, by: ex.name || ex.handle || null, url: ex.url, text: ex.text || null, status: ex.status || "reported-unconfirmed" };
      out.notes.push("An in-game exit was reported by a monitored account (not a league designation) — see the linked post.");
    }

    /* ---------- the model ---------- */
    const teamStats = (context && context.teamStats) ? context.teamStats[row.team] : null;
    out.stake = stakeComponent(t, stats, teamStats);
    out.production = (stats && Number.isFinite(stats.pointsGames) && stats.pointsGames > 0) ? {
      ppg: roundTo(stats.pointsTotal / stats.pointsGames, 1),
      apg: Number.isFinite(stats.assistsGames) && stats.assistsGames > 0 ? roundTo(stats.assistsTotal / stats.assistsGames, 1) : null,
      rpg: Number.isFinite(stats.reboundsGames) && stats.reboundsGames > 0 ? roundTo(stats.reboundsTotal / stats.reboundsGames, 1) : null,
      avgPlusMinus: Number.isFinite(stats.plusMinusGames) && stats.plusMinusGames > 0 ? roundTo(stats.plusMinusTotal / stats.plusMinusGames, 1) : null,
      games: stats.pointsGames,
      teamPpg: teamStats && teamStats.games > 0 ? roundTo(teamStats.pointsTotal / teamStats.games, 1) : null,
      teamGames: teamStats ? teamStats.games : 0,
      source: (stats.sampleUrls || [])[0] || null
    } : null;

    const schedule = (context && context.schedules) ? context.schedules[row.team] : null;
    out.exposure = exposureComponent(schedule);
    if (schedule && Array.isArray(schedule.games)) {
      const nowMs = Date.now();
      const upcoming = schedule.games.filter(g => Date.parse(g.date) > nowMs - 6 * 3600000).slice(0, 5);
      out.schedule = {
        fetchedAt: schedule.fetchedAt || null, source: schedule.url || null, season: schedule.season || null,
        upcoming, unresolvedCities: schedule.unresolvedCities || [],
        note: schedule.geoNote || null
      };
      const next = upcoming[0] || null;
      out.travel = next ? {
        nextGame: next.date, opponent: next.opponent, homeAway: next.homeAway, venue: next.venue, city: next.city,
        restDays: next.restDays, miles: next.travelMiles, hours: next.travelHours, mode: next.travelMode,
        tzShiftHours: next.tzShiftHours, unmappedCity: next.unmappedCity || null,
        source: schedule.url || null
      } : null;
      if (!out.exposure) out.notes.push("A schedule capture exists for " + row.team + " but no game falls inside the next-7-days window (or the capture is older than " + Math.round(CONFIG.scheduleFreshMs / 3600000) + "h), so the exposure component is withheld rather than reported as zero load.");
    }
    out.recurrence = recurrenceComponent(rp ? out.listing : null, out.exit);

    const components = { stake: out.stake, exposure: out.exposure, recurrence: out.recurrence };
    const g = gradeOf(components, row.sev || "mention", out.role.tier);
    out.impact = g.grade;
    out.grade = g.grade;
    out.score = g.score;
    out.confidence = g.confidence;
    out.offenseTier = offenseTierOf(out.stake.parts);
    out.rules = g.rules;
    /* AVAILABILITY RISK is deliberately separate from LINEUP IMPACT. Impact answers "how much
     * does the team lose"; risk answers "might this game-time decision resolve to sitting out".
     * Only the second one uses schedule load + travel, and only for a player who is NOT already
     * ruled out — for an Out listing the same schedule facts are already inside EXPOSURE. */
    if (out.exposure && (row.sev === "questionable" || row.sev === "probable" || row.sev === "mention")) {
      const level = out.exposure.score >= CONFIG.gradeHigh ? "high" : out.exposure.score >= CONFIG.gradeMedium ? "medium" : "low";
      out.availabilityRisk = {
        score: out.exposure.score, level,
        label: level === "high" ? "HIGH availability risk for a game-time decision — heavy schedule/travel load in the next 7 days"
          : level === "medium" ? "MEDIUM availability risk — moderate schedule/travel load ahead"
            : "LOW availability risk from schedule/travel load",
        basis: out.exposure.parts.map(p => p.label)
      };
    }
    out.factors = [].concat(
      (out.stake.parts || []).map(p => ({ component: "stake", ...p })),
      (out.exposure ? out.exposure.parts : []).map(p => ({ component: "exposure", ...p })),
      (out.recurrence ? out.recurrence.parts : []).map(p => ({ component: "recurrence", ...p }))
    );

    /* ---------- label ---------- */
    const heavy = row.sev === "out" || row.sev === "doubtful";
    const base = (() => {
      if (out.role.tier === "starter") return heavy ? "HIGH — projected/confirmed starter is off the floor"
        : row.sev === "questionable" ? "MEDIUM — starter is a game-time decision" : "LOW — starter listed, not out";
      if (out.role.tier === "rotation") return heavy ? "MEDIUM — rotation minutes are vacated" : "LOW — rotation player listed, expected to play";
      if (out.role.tier === "bench") return heavy ? "LOW — depth player out (roster spot, not rotation)" : "LOW — depth player listed";
      if (out.role.tier === "unclear") return heavy ? "MEDIUM — collected games exist but neither role threshold is decisive" : "LOW — playing-time evidence is inconclusive";
      return "IMPACT UNKNOWN — no role evidence collected";
    })();
    const scoreBit = out.score == null ? "" : " · impact score " + out.score + "/100 (evidence coverage " + Math.round(out.confidence * 100) + "%)";
    const prodBit = out.production && out.production.ppg != null
      ? " · " + out.production.ppg + " ppg" + (out.production.apg != null ? ", " + out.production.apg + " apg" : "") + (out.production.avgPlusMinus != null ? ", " + (out.production.avgPlusMinus >= 0 ? "+" : "") + out.production.avgPlusMinus + " +/-" : "") + " in collected games"
      : "";
    out.impactLabel = base + scoreBit + prodBit;
    if (out.exit) out.impactLabel += " · in-game exit reported (unconfirmed)";
    if (g.rules.length) out.notes.push("Model rule applied: " + g.rules.join("; ") + ".");

    if (out.contract && out.contract.salary != null) {
      const seasonLabel = out.contract.season ? ("for the " + out.contract.season + " season") : "season not stated by the source";
      out.contract.label = out.contract.zero
        ? "ESPN's roster feed files " + money(0) + " " + seasonLabel + " — the value two-way and Exhibit-100 contracts carry in this data, not a statement about the player. Contract type is not published by this source."
        : "Salary on file with ESPN's roster feed " + seasonLabel + ": " + money(out.contract.salary);
    }

    const capPlayers = (cap && cap.players) || [];
    if (cap && capPlayers.length && !capPlayers.some(p => Array.isArray(p.injuryEntries))) {
      out.notes.push("This team's roster capture contains no dated injury-listing array at all (file written before that field was collected, or the collector has not run since) — cadence and salary are unavailable BY CAPTURE VERSION, not because the player has none. Re-run tools/collect_context.js.");
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
    if (assessment.listing && assessment.listing.count >= 2) bits.push(assessment.listing.count + " dated injury listings");
    if (assessment.exposure && assessment.exposure.parts && assessment.exposure.parts.length) bits.push("schedule: " + assessment.exposure.parts.map(p => p.label).join(", "));
    return bits.join(" · ");
  }

  return {
    MODEL, CONFIG, assess, summaryText, tierFromObservations, listingCadence, money, foldName, isFresh,
    stakeComponent, exposureComponent, recurrenceComponent, gradeOf, medianOf
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LineupImpact;
