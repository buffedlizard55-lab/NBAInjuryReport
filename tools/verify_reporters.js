#!/usr/bin/env node
/* =====================================================================================
 * verify_reporters.js — forward re-verification of the in-arena reporter layer
 *
 * WHY THIS EXISTS (2026-09-18, session 10)
 *   The directory's evidence was a snapshot: a bio read once, pasted into data.js, and then
 *   trusted forever. That is exactly how a verification page rots — the reporter changes
 *   outlets, the account goes quiet, the handle gets recycled, and the page keeps printing
 *   the old claim with a green tick. Nothing here is typed in by a human at run time.
 *
 * WHAT IT DOES, per registry row (BSKY_REPORTERS + SOCIAL_ACCOUNTS)
 *   1. getProfiles?actors=<handle>  → does the handle still resolve? does the stored
 *      `evidenceQuote` still appear in the account's own bio? is the Bluesky verification
 *      object (if the row claims one) still present AND valid?
 *   2. getAuthorFeed?actor=<handle>&limit=1 → newest post date, so a dormant account can be
 *      reported as dormant instead of being counted as coverage.
 *   3. GET every official club channel (nba.com/<slug>/news, 30 of them) and record the
 *      HTTP status, so the "pattern" rows in the UI stop being a promise and become a
 *      measured fact.
 *   Results land in data/live/reporter_verify.json and are rendered by reporters.html.
 *
 * WHAT FAILS THE BUILD (exit 1)
 *   - a handle that no longer resolves                      (identity claim is stale)
 *   - a claimed verification object that is gone or invalid (strongest evidence lost)
 *   --strict additionally fails on bio drift and dormancy, for whoever wants that gate.
 *   Bio drift and dormancy are WARNINGS, written down: a reporter legitimately changing
 *   outlet must not break CI, it must be visible for review.
 *
 * HONESTY RULES BAKED IN
 *   - No inference: a row is never marked ok because a DIFFERENT field matched.
 *   - If the network is unavailable, the run reports `unreachable` and writes nothing over
 *     real evidence (the file keeps its previous content, so a sandbox cannot erase facts).
 *   - `--dry-run` prints the verdicts and writes nothing.
 *
 * Usage:  node tools/verify_reporters.js [--dry-run] [--strict] [--quiet]
 * ===================================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT_ROOT = process.env.NBA_WATCH_OUT || ROOT;
const DRY = process.argv.includes("--dry-run");
const STRICT = process.argv.includes("--strict");
const QUIET = process.argv.includes("--quiet");
const TIMEOUT_MS = 20000;
const UA = "NBAInjuryReport-verify_reporters (+https://github.com/buffedlizard55-lab/NBAInjuryReport)";
const DORMANT_DAYS = 30;         // no post in this window ⇒ reported as dormant, never as coverage
const BATCH_ACTORS = 25;         // AT-Protocol getProfiles limit

/* ---- registry (single source of truth: assets/js/data.js) --------------------------- */
const dataSrc = fs.readFileSync(path.join(ROOT, "assets/js/data.js"), "utf8");
const D = new Function(dataSrc + `
  return { ENDPOINTS, TEAMS, BSKY_REPORTERS, SOCIAL_ACCOUNTS, reporterConf, nbaTeamNewsUrl, teamByAbbr };
`)();

/* =====================================================================================
 * PURE VERDICT LOGIC — exported so tools/verify_reporters_test.js can pin every branch
 * with fixtures, without a network.
 * ===================================================================================== */

/* Bios come back with hard line breaks and doubled spaces; the stored quotes were copied by
 * hand from the same field. Compare on a whitespace-normalised, case-folded copy so a reformat
 * is not reported as identity drift — but never fuzzy-match beyond that. */
function norm(s) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().toLowerCase();
}
function quotePresent(quote, bio) {
  const q = norm(quote);
  if (!q) return null;                    // nothing to check ⇒ caller reports "no quote on file"
  return norm(bio).includes(q);
}
/* A valid verification object = at least one entry with isValid true. `trustedVerifierStatus`
 * is NOT the same thing (bsky.app is a trusted verifier regardless), so it is not consulted. */
function validVerification(profile) {
  const v = (profile && profile.verification) || null;
  if (!v || !Array.isArray(v.verifications)) return { present: false, valid: false, issuer: null };
  const good = v.verifications.filter(x => x && x.isValid === true);
  const pick = good[0] || v.verifications[0] || null;
  return {
    present: v.verifications.length > 0,
    valid: good.length > 0,
    issuer: pick ? (pick.issuerHandle || null) : null
  };
}
function ageDays(iso, now) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor(((now || Date.now()) - t) / 86400000);
}

/* judge() is the whole policy in one function: given what the registry CLAIMS and what the API
 * actually RETURNED, produce one of:
 *   ok                   evidence still matches, account alive
 *   bio-drift            the account exists but the stored quote is no longer in the bio
 *   no-quote             registry row stores no evidenceQuote (legacy row) — never graded ok
 *   verification-lost    the row claims a verification object and it is gone / invalid
 *   dormant              account resolves and matches, but the newest post is older than DORMANT_DAYS
 *   missing              the handle did not resolve at all
 */
function judge(row, observed, now) {
  const o = observed || {};
  const notes = [];
  if (!o.profile) {
    return { handle: row.handle, name: row.name, status: "missing", fatal: true, notes: ["handle did not resolve: " + (o.error || "not found")] };
  }
  const v = validVerification(o.profile);
  if (row.bskyVerified === true && !v.valid) {
    return { handle: row.handle, name: row.name, status: "verification-lost", fatal: true, verification: v,
      notes: ["row claims a Bluesky verification object; API now returns " + (v.present ? "an object with no valid entry" : "none")] };
  }
  const hasQuote = !!(row.evidenceQuote);
  const present = hasQuote ? quotePresent(row.evidenceQuote, o.profile.description) : null;
  const days = ageDays(o.latestPostAt, now);
  /* Recency only matters for rows that make a COVERAGE claim. A feed:false row (a dormant
   * account kept for review, or an unconfirmed handle) is not polled, so "dormant" would be a
   * statement about a promise it never made — the honest verdict is about identity alone, and
   * the row's own evidence text already carries the dormancy caveat. */
  const claimsCoverage = row.feed !== false;
  const dormant = claimsCoverage && days != null && days > DORMANT_DAYS;
  const base = {
    handle: row.handle, name: row.name, team: row.team || null, conf: D.reporterConf(row), feed: row.feed !== false,
    verification: v, bio: String(o.profile.description || "").slice(0, 400),
    latestPostAt: o.latestPostAt || null, dormantDays: days
  };
  if (!hasQuote) return Object.assign(base, { status: "no-quote", fatal: false, notes: ["no stored evidenceQuote (pre-2026-09-18 row): bio recorded, drift cannot be judged"] });
  if (present === false) return Object.assign(base, { status: "bio-drift", fatal: false, notes: ["stored quote is no longer present in the live bio — re-read and update the row"] });
  if (dormant) return Object.assign(base, { status: "dormant", fatal: false, notes: ["quote matches, but newest post is " + days + " days old (>" + DORMANT_DAYS + ")"] });
  return Object.assign(base, { status: "ok", fatal: false,
    notes: claimsCoverage ? [] : ["held out of the alert path (feed:false) — identity re-checked, recency not enforced"] });
}

function summarize(rows) {
  const by = {};
  for (const r of rows) by[r.status] = (by[r.status] || 0) + 1;
  return {
    checked: rows.length,
    ok: by.ok || 0, bioDrift: by["bio-drift"] || 0, dormant: by.dormant || 0,
    missing: by.missing || 0, verificationLost: by["verification-lost"] || 0, noQuote: by["no-quote"] || 0,
    fatal: rows.filter(r => r.fatal).length,
    withProblems: rows.filter(r => r.status !== "ok").map(r => (r.handle || r.name) + " (" + r.status + ")")
  };
}
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/* =====================================================================================
 * NETWORK LAYER (only runs when this file is executed, never on require)
 * ===================================================================================== */
async function getJson(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}

async function profilesFor(handles) {
  const found = new Map(), errors = new Map();
  for (const batch of chunk(handles, BATCH_ACTORS)) {
    const url = D.ENDPOINTS.bskyGetProfiles + batch.map(encodeURIComponent).join("&actors=");
    try {
      const data = await getJson(url);
      const list = (data && data.profiles) || [];
      for (const p of list) found.set(String(p.handle).toLowerCase(), p);
      /* getProfiles silently omits actors it cannot resolve — record them explicitly, because a
       * dropped actor is exactly the "handle no longer exists" case this tool must not miss. */
      for (const h of batch) if (!found.has(h.toLowerCase())) errors.set(h.toLowerCase(), "not returned by getProfiles");
    } catch (e) {
      for (const h of batch) errors.set(h.toLowerCase(), e.message);
    }
  }
  return { found, errors };
}

async function latestPostAt(handle) {
  try {
    const data = await getJson(D.ENDPOINTS.bskyAuthorFeed + encodeURIComponent(handle) + "&limit=1");
    const item = ((data && data.feed) || [])[0];
    const rec = item && item.post && item.post.record;
    return (rec && rec.createdAt) || (item && item.post && item.post.indexedAt) || null;
  } catch (e) { return null; }
}
async function channelStatus(url) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: ctrl.signal, redirect: "follow" });
    clearTimeout(timer);
    const body = res.ok ? (await res.text()).slice(0, 4000) : "";
    return { url, http: res.status, ok: res.ok, looksLikeClubNews: /news|media/i.test(body) };
  } catch (e) { return { url, http: 0, ok: false, error: e.message }; }
}

/* Concurrency-limited map — the public API deserves courtesy, and 26 parallel feeds would be rude. */
async function mapLimited(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

async function main() {
  const rows = D.BSKY_REPORTERS.concat(D.SOCIAL_ACCOUNTS.filter(a => a.handle && a.url && a.url.includes("bsky.app")));
  const handles = rows.map(r => r.handle).filter(Boolean);
  if (!QUIET) console.log("verify_reporters: " + handles.length + " handles, " + D.TEAMS.length + " club channels");

  const { found, errors } = await profilesFor(handles);
  if (found.size === 0) {
    /* No network ⇒ the honest outcome is "unreachable", and the previous evidence file is left
     * untouched. Overwriting real evidence with an environment failure is how a sandbox run
     * turns into a false claim (the repo learned this the hard way — see NEXT_STEPS). */
    const msg = "UNREACHABLE: no profile could be read (first error: " + ([...errors.values()][0] || "unknown") + ")";
    console.log("✗ " + msg);
    console.log("  evidence file left unchanged; re-run from a network-capable environment (GitHub Actions).");
    if (!DRY) {
      const file = path.join(OUT_ROOT, "data/live/reporter_verify.json");
      let prev = null;
      try { prev = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { prev = null; }
      if (prev) { prev.lastAttempt = { at: new Date().toISOString(), result: msg }; fs.writeFileSync(file, JSON.stringify(prev, null, 1) + "\n"); }
    }
    process.exit(0);
  }

  const now = Date.now();
  const judged = [];
  for (const row of rows) {
    const profile = found.get(String(row.handle).toLowerCase()) || null;
    const observed = { profile, error: errors.get(String(row.handle).toLowerCase()) || null };
    if (profile && row.feed !== false) {
      observed.latestPostAt = await mapLimitedOnce(profile.handle);
    }
    judged.push(judge(row, observed, now));
  }

  const channels = await mapLimited(D.TEAMS.map(t => ({ abbr: t.abbr, url: D.nbaTeamNewsUrl(t.abbr) })), 4,
    async c => Object.assign({ abbr: c.abbr }, await channelStatus(c.url)));

  const summary = summarize(judged);
  const report = {
    generated: new Date().toISOString(),
    tool: "tools/verify_reporters.js",
    method: "getProfiles (bio + verification object) + getAuthorFeed?limit=1 (recency) per allow-list handle, then one HTTP GET per club channel. Verdicts are policy, not heuristics: see judge() in this file.",
    dormantThresholdDays: DORMANT_DAYS,
    handlesChecked: handles.length,
    summary: summary,
    rows: judged,
    channels: channels,
    channelSummary: {
      checked: channels.length,
      ok: channels.filter(c => c.ok).length,
      failed: channels.filter(c => !c.ok).map(c => c.abbr + ":http" + c.http)
    }
  };
  if (!QUIET) {
    console.log("  verdicts: " + JSON.stringify({ ok: summary.ok, bioDrift: summary.bioDrift, dormant: summary.dormant, missing: summary.missing, verificationLost: summary.verificationLost, noQuote: summary.noQuote }));
    console.log("  club channels: " + report.channelSummary.ok + "/" + report.channelSummary.checked + " answered 200" +
      (report.channelSummary.failed.length ? " — failures: " + report.channelSummary.failed.join(", ") : ""));
    for (const r of judged.filter(x => x.status !== "ok")) console.log("  ! " + (r.handle || r.name) + " → " + r.status + " (" + r.notes[0] + ")");
  }
  if (DRY) { console.log("--dry-run: nothing written."); return; }
  const outFile = path.join(OUT_ROOT, "data/live/reporter_verify.json");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(report, null, 1) + "\n");
  if (!QUIET) console.log("  wrote " + path.relative(ROOT, outFile));

  const hardFail = judged.filter(r => r.fatal);
  if (hardFail.length) {
    console.error("✗ " + hardFail.length + " identity claim(s) failed: " + hardFail.map(r => r.handle + " (" + r.status + ")").join(", "));
    process.exit(1);
  }
  if (STRICT && summary.ok !== summary.checked) {
    console.error("✗ --strict: " + (summary.checked - summary.ok) + " row(s) are not clean");
    process.exit(1);
  }
}
/* Small helper kept next to mapLimited so the per-account recency calls also respect the limit. */
async function mapLimitedOnce(handle) {
  const r = await mapLimited([handle], 1, async h => latestPostAt(h));
  return r[0] || null;
}

module.exports = { judge, summarize, quotePresent, validVerification, ageDays, chunk, norm, DORMANT_DAYS };

if (require.main === module) {
  main().catch(e => { console.error("verify_reporters failed: " + e.message); process.exit(1); });
}
