#!/usr/bin/env node
/* =====================================================================================
 * backfill_registry_recency.js — write the MEASURED newest-post date back into the registry
 *
 * WHY THIS EXISTS (2026-09-19, session 14)
 *   reporters.html answers two different questions and it must be able to answer both:
 *
 *     IDENTITY  — who is this account?           ← stored in the registry row (evidenceQuote)
 *     ACTIVITY  — when did it last say anything? ← measured by tools/verify_reporters.js
 *
 *   Identity lives in `assets/js/data.js`; activity is measured by CI into
 *   `data/live/reporter_verify.json`. The page reads the CI file FIRST and the registry second,
 *   which is correct — but it means that before the first CI run of a checkout (a fresh clone, a
 *   fork, a fork's first Pages build, or any environment where the evidence file is missing or
 *   older) 30 of 40 writers printed *unmeasured* even though the project had already measured
 *   them. The measurement existed; it just was not stored where the page could fall back to it.
 *
 *   This tool copies the measured date from the evidence file into each registry row's
 *   `observed` block, with the source recorded, so the registry alone can answer the activity
 *   question. It is idempotent, it never invents a date, and it refuses to touch a row whose
 *   stored date is NEWER than the evidence (a fresh live read is not "drift").
 *
 * WHAT IT WILL NOT DO
 *   - It never writes a date for a handle the evidence does not carry. A row that is held out of
 *     collection (feed:false) has no measured date by design; it is reported as `no-evidence`.
 *   - It never touches identity fields (name / handle / outlet / conf / evidenceQuote / feed).
 *     The rewritten file is re-evaluated and compared field-by-field before anything is written;
 *     if any identity field differs, nothing is written and the tool exits non-zero.
 *   - It never invents a bio, a follower count or a verification verdict.
 *
 * THE ONE BUG THIS TOOL SHIPPED WITH (found and fixed 2026-09-19, same session)
 *   Rows checked-but-not-measured store the shape `observed: { ..., latestPostAt: null }`. The first
 *   version only replaced QUOTED dates, so on those rows it prepended `latestPostAt: "…"` and left
 *   the old `null` behind. JavaScript keeps the LAST duplicate key, so the file parsed, every check
 *   in the repository passed — and the row still evaluated to `null`, i.e. Boston's Gary Washburn
 *   printed *unmeasured* in exactly the environment this tool exists for (a checkout with no
 *   evidence file). The proof step could not see it because "did this row change?" is a weaker
 *   question than "does this row now hold the planned date?".
 *   Both halves are fixed: the literal pattern accepts an unquoted `null`, duplicate keys are
 *   repaired instead of added to, and the post-edit proof now asserts the EVALUATED value of every
 *   row it touched equals the date it planned, field by field.
 *
 * USAGE
 *   node tools/backfill_registry_recency.js            # rewrite assets/js/data.js in place
 *   node tools/backfill_registry_recency.js --check    # exit 1 if the registry is behind; write nothing
 *   node tools/backfill_registry_recency.js --dry-run  # print what would change; write nothing
 *   NBA_WATCH_OUT=/scratch node tools/backfill_registry_recency.js   # redirect the registry path
 *
 * Wired into `.github/workflows/live-audit.yml` right after the live re-verification, so the
 * registry cannot silently fall behind the measurement that the page is rendered from.
 * ===================================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const OUT_ROOT = process.env.NBA_WATCH_OUT || ROOT;
const DATA_FILE = path.join(OUT_ROOT, "assets/js/data.js");
const EVIDENCE_FILE = path.join(OUT_ROOT, "data/live/reporter_verify.json");
const CHECK = process.argv.includes("--check");
const DRY = process.argv.includes("--dry-run");

/* ---- 1. the measurement of record ---------------------------------------------------- */
function readEvidence() {
  if (!fs.existsSync(EVIDENCE_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(EVIDENCE_FILE, "utf8")); } catch (e) { return null; }
}
const evidence = readEvidence();
if (!evidence || !Array.isArray(evidence.rows)) {
  console.log("backfill_registry_recency: no usable evidence file at data/live/reporter_verify.json " +
    "— nothing to backfill (the registry keeps whatever it already stores).");
  process.exit(0);
}
const evidenceStamp = evidence.generated || "unknown";
/* handle → measured newest post. Only rows the verifier actually READ a feed for appear here;
 * a missing entry means "not measured", never "dormant" and never "healthy". */
const measured = new Map();
for (const r of evidence.rows) {
  if (!r || !r.handle) continue;
  if (!r.latestPostAt) continue;
  measured.set(String(r.handle).toLowerCase(), { at: r.latestPostAt, status: r.status || null });
}

/* ---- 2. the registry, read the same way every other tool reads it --------------------- */
function loadRegistry(src) {
  const sandbox = { console: console, Date: Date, Math: Math, JSON: JSON };
  vm.createContext(sandbox);
  vm.runInContext(src + "\n;globalThis.__r = { BSKY_REPORTERS, SOCIAL_ACCOUNTS };", sandbox, { filename: "data.js" });
  return sandbox.__r;
}
const source = fs.readFileSync(DATA_FILE, "utf8");
let before;
try {
  before = loadRegistry(source);
} catch (e) {
  console.error("✗ assets/js/data.js does not evaluate before the edit: " + e.message);
  process.exit(1);
}

/* ---- 3. tiny scanner: find a row's `observed: { ... }` block without guessing ---------- */
/* Handles double/single-quoted strings with escapes, line comments, block comments and
 * template literals, so a brace inside a bio cannot shift the match. */
function scanTo(src, from, stop) {
  let i = from;
  while (i < src.length) {
    const c = src[i];
    if (stop(i, c)) return i;
    if (c === '"' || c === "'" || c === "`") {
      const q = c; i++;
      while (i < src.length) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i < 0) return src.length; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 2; continue; }
    i++;
  }
  return src.length;
}
function matchingBrace(src, openIdx) {
  let depth = 0;
  const end = scanTo(src, openIdx, (i, c) => {
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return true; }
    return false;
  });
  return end;
}
/* The array literal region, so a handle that appears in a comment or in the club probe table
 * can never be edited by mistake. Brackets inside strings/comments are skipped. */
function arrayRegion(src, name) {
  const decl = src.indexOf("const " + name + " = [");
  if (decl < 0) throw new Error("array not found: " + name);
  const open = src.indexOf("[", decl);
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c; i++;
      while (i < src.length) { if (src[i] === "\\") { i += 2; continue; } if (src[i] === q) { i++; break; } i++; }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") { const nl = src.indexOf("\n", i); i = nl < 0 ? src.length : nl + 1; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) return { decl: decl, open: open, end: i }; }
    i++;
  }
  throw new Error("unterminated array: " + name);
}
/* Every top-level object inside the array, with the handle it declares. */
function rowsInRegion(src, region, name) {
  const rows = [];
  let i = region.open + 1;
  while (i < region.end) {
    i = scanTo(src, i, (n, c) => c === "{" || c === "]" || c === "[" || c === "}" || c === ",");
    if (i >= region.end) break;
    if (src[i] !== "{") { i++; continue; }
    const end = matchingBrace(src, i);
    if (end > region.end) throw new Error("row extends past the end of " + name);
    const text = src.slice(i, end + 1);
    const m = /\bhandle:\s*"([^"]+)"/.exec(text);
    rows.push({ name: name, start: i, end: end, text: text, handle: m ? m[1] : null });
    i = end + 1;
  }
  return rows;
}

const region = arrayRegion(source, "BSKY_REPORTERS");
const rows = rowsInRegion(source, region, "BSKY_REPORTERS");

/* ---- 4. decide the edits -------------------------------------------------------------- */
/* The provenance label is the FILE, not the file's timestamp. WHY (2026-09-19): this tool runs
 * inside live-audit.yml, whose push trigger includes assets/js/data.js. If the label embedded each
 * run's `generated` value, every run would rewrite the label, the commit would fire another run,
 * and the audit would loop forever. The evidence file carries its own `generated` timestamp, so the
 * provenance is still exact; and the row keeps its own `checkedAt`, which this tool never touches. */
const stampLabel = "data/live/reporter_verify.json";
/* A stored date may be an ISO string OR the literal `null` that "checked, not yet measured" writes.
 * Matching only quoted strings is what produced the duplicate-key bug described in the header. */
const AT_LITERAL = /latestPostAt:\s*(?:null|"[^"]*")/;
const SRC_LITERAL = /latestPostAtSource:\s*(?:null|"[^"]*")/;
const edits = [];        // {start, end, text}
const plannedDate = new Map();   // handle → the date this run intends to store
const report = { updated: [], current: [], noEvidence: [], registryAhead: [], noObserved: [], repaired: [], duplicateAhead: [] };

for (const row of rows) {
  if (!row.handle) { continue; }
  const key = row.handle.toLowerCase();
  const m = measured.get(key);
  const cur = (row.text.match(/latestPostAt:\s*"([^"]*)"/) || [])[1] || null;
  /* Two `latestPostAt:` keys in one row is ALWAYS a defect: only the last one is read. Rows that
   * were written before this file existed carry the unquoted `null`, and a row that has both is a
   * row this tool damaged on its first run. Repair beats refusal here because the value being
   * replaced is one this tool owns — but the repair is counted and reported, never silent. */
  const atCount = (row.text.match(/latestPostAt:/g) || []).length;
  const needsRepair = atCount > 1;
  if (!m) { report.noEvidence.push(row.handle + (cur ? " (registry has " + cur + ")" : "")); continue; }
  if (!needsRepair) {
    if (cur === m.at) { report.current.push(row.handle); continue; }
    if (cur && Date.parse(cur) >= Date.parse(m.at)) { report.registryAhead.push(row.handle + " (registry " + cur + " ≥ evidence " + m.at + ")"); continue; }
  } else if (cur && Date.parse(cur) > Date.parse(m.at)) {
    /* Duplicate keys AND the stored date is fresher than the evidence. Repairing would walk a newer
     * read backwards, so the row is left for a human and named in the report. Two `latestPostAt`
     * keys is still ALWAYS a defect — it is reported, never ignored. */
    report.duplicateAhead.push(row.handle + " (stored " + cur + " is newer than evidence " + m.at + ")");
    continue;
  } else {
    report.repaired.push(row.handle + " (" + atCount + " latestPostAt keys → 1)");
  }
  /* Locate the observed block inside this row (tolerating `observed:{`). */
  const obsMatch = /observed:\s*\{/.exec(row.text);
  const obsRel = obsMatch ? obsMatch.index : -1;
  if (obsRel < 0) {
    /* No observed block at all: insert one right after the row's opening brace. Valid JS, and
     * the field order shift is the only change (asserted below). */
    report.noObserved.push(row.handle);
    plannedDate.set(key, m.at);
    edits.push({
      start: row.start + 1, end: row.start + 1,
      text: ' observed: { latestPostAt: "' + m.at + '", latestPostAtSource: "' + stampLabel + '" },'
    });
    continue;
  }
  const obsOpen = row.start + obsRel + obsMatch[0].length - 1;
  const obsClose = matchingBrace(source, obsOpen);
  const cs = (row.text.match(/checkedAt:\s*"([^"]*)"/) || [])[1] || null;
  let body = source.slice(obsOpen + 1, obsClose);
  if (needsRepair) {
    /* Drop every existing pair, then write exactly one of each below. The comma/whitespace
     * normalisation is what keeps the result evaluable; if it is ever wrong the evaluability check
     * downstream aborts the run instead of writing a broken file. */
    body = body.replace(/latestPostAtSource:\s*(?:null|"[^"]*")\s*,?/g, "")
      .replace(/latestPostAt:\s*(?:null|"[^"]*")\s*,?/g, "");
    /* Whitespace cleanup is safe here and only here: an `observed` block holds dates, counts and
     * verification flags — the free-text fields (bio quotes, notes) live outside it. */
    body = body.replace(/^\s*,\s*/, " ").replace(/,\s*,/g, ",").replace(/\{\s*,/, "{ ")
      .replace(/,\s*\}/, " }").replace(/[ \t]{2,}/g, " ");
  }
  if (AT_LITERAL.test(body)) {
    body = body.replace(AT_LITERAL, 'latestPostAt: "' + m.at + '"');
  } else {
    body = ' latestPostAt: "' + m.at + '",' + body;
  }
  if (SRC_LITERAL.test(body)) {
    body = body.replace(SRC_LITERAL, 'latestPostAtSource: "' + stampLabel + '"');
  } else {
    body = body.replace(/(latestPostAt:\s*"[^"]*")/, '$1, latestPostAtSource: "' + stampLabel + '"');
  }
  edits.push({ start: obsOpen + 1, end: obsClose, text: body });
  plannedDate.set(key, m.at);
  report.updated.push(row.handle + " → " + m.at + (m.status ? " (" + m.status + ")" : "") +
    (cs ? " [checkedAt kept: " + cs + "]" : "") + (needsRepair ? " [duplicate key repaired]" : ""));
}

/* ---- 5. apply, then PROVE the identity fields did not move ----------------------------- */
let next = source;
for (const e of edits.sort((a, b) => b.start - a.start)) {
  next = next.slice(0, e.start) + e.text + next.slice(e.end);
}
let after;
try {
  after = loadRegistry(next);
} catch (e) {
  console.error("✗ the edit would produce invalid JavaScript (" + e.message + ") — nothing written.");
  process.exit(1);
}
function fingerprint(reg) {
  return reg.BSKY_REPORTERS.map(r => [r.name, r.handle, r.outlet, r.role, r.team, r.feed, r.conf, r.bskyVerified, r.evidenceQuote,
    r.identityRefused === true, r.observed ? [r.observed.postsCount, r.observed.followersCount, r.observed.profileIndexedAt, r.observed.verificationValid] : null].join("|"));
}
const fBefore = fingerprint(before), fAfter = fingerprint(after);
if (fBefore.length !== fAfter.length || fBefore.some((x, i) => x !== fAfter[i])) {
  console.error("✗ identity-field check FAILED: the edit changed something other than the measured date. Nothing written.");
  for (let i = 0; i < Math.max(fBefore.length, fAfter.length); i++) {
    if (fBefore[i] !== fAfter[i]) { console.error("  row " + i + "\n   before: " + fBefore[i] + "\n   after:  " + fAfter[i]); break; }
  }
  process.exit(1);
}
/* The strong proof: every row this tool planned to write must EVALUATE to the planned date with
 * the planned source. "The row changed" is not the same question — a duplicate key means a row can
 * change and still hold the wrong value, which is exactly how the first version of this tool
 * shipped a silent no-op to Boston. */
for (const r of after.BSKY_REPORTERS) {
  const want = plannedDate.get(String(r.handle || "").toLowerCase());
  if (!want) continue;
  const got = r.observed ? r.observed.latestPostAt : undefined;
  const gotSrc = r.observed ? r.observed.latestPostAtSource : undefined;
  if (got !== want || gotSrc !== stampLabel) {
    console.error("✗ measured-date check FAILED for " + r.handle + ": the row evaluates to " +
      JSON.stringify(got) + " / " + JSON.stringify(gotSrc) + " but " + want + " was planned. Nothing written.");
    process.exit(1);
  }
}
/* And the only observed fields that may differ are the two this tool owns. */
const owned = (r) => (r.observed ? [r.observed.latestPostAt, r.observed.latestPostAtSource] : null);
const changedOwned = before.BSKY_REPORTERS.filter((r, i) => JSON.stringify(owned(r)) !== JSON.stringify(after.BSKY_REPORTERS[i] && owned(after.BSKY_REPORTERS[i])));
if (changedOwned.length !== report.updated.length + report.noObserved.length) {
  console.error("✗ measured-date check FAILED: " + changedOwned.length + " row(s) changed but " +
    (report.updated.length + report.noObserved.length) + " were planned. Nothing written.");
  process.exit(1);
}
const sameContent = next === source;

/* ---- 6. report / write ---------------------------------------------------------------- */
console.log("backfill_registry_recency: evidence " + evidenceStamp + " · " + rows.length + " registry rows inspected");
console.log("  measured dates available : " + measured.size);
console.log("  rows brought up to date  : " + (report.updated.length + report.noObserved.length) +
  (report.noObserved.length ? " (" + report.noObserved.length + " needed an observed block created)" : ""));
console.log("  already current          : " + report.current.length);
console.log("  no evidence for handle    : " + report.noEvidence.length + " (held out of collection, or not in the allow-list)");
if (report.registryAhead.length) console.log("  registry ahead of CI (kept): " + report.registryAhead.length);
if (report.duplicateAhead.length) {
  console.log("  DUPLICATE KEYS + newer date : " + report.duplicateAhead.length + " (left for manual repair)");
  for (const r of report.duplicateAhead) console.log("    ! " + r);
}
if (report.repaired.length) {
  console.log("  duplicate keys repaired  : " + report.repaired.length);
  for (const r of report.repaired) console.log("    · " + r);
}
for (const u of report.updated.slice(0, 60)) console.log("    · " + u);
if (report.updated.length > 60) console.log("    · … and " + (report.updated.length - 60) + " more");

if (CHECK) {
  if (report.duplicateAhead.length) {
    console.error("✗ " + report.duplicateAhead.length + " row(s) carry duplicate latestPostAt keys with a newer " +
      "stored date — fix them by hand; a duplicate key means the file does not read what it looks like it reads.");
    process.exit(1);
  }
  if (sameContent) { console.log("✓ registry is already in sync with the measurement of record."); process.exit(0); }
  console.error("✗ registry is BEHIND data/live/reporter_verify.json — run: node tools/backfill_registry_recency.js");
  process.exit(1);
}
if (DRY) { console.log("--dry-run: nothing written."); process.exit(0); }
if (sameContent) { console.log("✓ nothing to write."); process.exit(0); }
fs.writeFileSync(DATA_FILE, next);
console.log("✓ wrote " + path.relative(ROOT, DATA_FILE) + " (identity fields unchanged; only latestPostAt/latestPostAtSource moved)");
