/* Alert engine: pleasant WebAudio chime + Browser Notifications + persistent alert log.
 * No external audio files needed. Sound ON/OFF persisted in localStorage. */
"use strict";

const AlertEngine = (() => {
  const LS_SOUND = "nba-alerts-sound-on";
  const LS_LOG = "nba-alerts-log-v1";
  let audioCtx = null;
  let lastChimeAt = 0;
  let soundOn = (localStorage.getItem(LS_SOUND) ?? "on") === "on";

  function ctx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  /* Two voices, both pure WebAudio (no file download, nothing to fail offline):
   *   standard  — soft two-note bell E5 -> A5 with a faint octave shimmer (~1.1 s)
   *   high      — the same bell plus a rising A5 -> C#6 -> E6 arpeggio, so an ordinary listing and
   *               a HIGH LINEUP IMPACT absence are audibly different without being alarming.
   * Both are deliberately gentle: an injury alert can arrive twenty times a night and a harsh
   * klaxon would just get muted. */
  function playNotes(notes) {
    try {
      const ac = ctx();
      if (!ac) return false;
      const t0 = ac.currentTime;
      for (const n of notes) {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = n.type || "sine";
        osc.frequency.value = n.f;
        gain.gain.setValueAtTime(0.0001, t0 + n.t);
        gain.gain.exponentialRampToValueAtTime(n.g, t0 + n.t + (n.attack || 0.03));
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.t + n.d);
        osc.connect(gain).connect(ac.destination);
        osc.start(t0 + n.t);
        osc.stop(t0 + n.t + n.d + 0.05);
      }
      return true;
    } catch (e) {
      console.warn("chime failed", e);
      return false;
    }
  }

  function playChime() {
    return playNotes([
      { f: 659.25, t: 0.00, d: 0.55, g: 0.22 },  // E5
      { f: 880.00, t: 0.16, d: 0.70, g: 0.20 },  // A5
      { f: 1318.5, t: 0.16, d: 0.45, g: 0.05 }   // E6 shimmer
    ]);
  }

  /* High-impact voice: a slightly slower, resolving three-note figure (A5 -> C#6 -> E6). */
  function playHighImpactChime() {
    const ok = playNotes([
      { f: 880.00, t: 0.00, d: 0.40, g: 0.20 },  // A5
      { f: 1108.7, t: 0.18, d: 0.45, g: 0.19 },  // C#6
      { f: 1318.5, t: 0.36, d: 0.85, g: 0.22 },  // E6
      { f: 1760.0, t: 0.36, d: 0.60, g: 0.05 }   // A6 shimmer
    ]);
    return ok;
  }

  function testSound() {
    const ok = playChime();
    log("🔔 Sound test played (standard alert voice)" + (ok ? "" : " (audio unavailable in this browser)"), null);
    renderLog();
    return ok;
  }

  function testHighImpactSound() {
    const ok = playHighImpactChime();
    log("🔔⚡ Sound test played (HIGH LINEUP IMPACT voice)" + (ok ? "" : " (audio unavailable in this browser)"), null);
    renderLog();
    return ok;
  }

  let testAlertToggle = 0;
  function testLiveAlert() {
    testAlertToggle = (testAlertToggle + 1) % 2;
    if (testAlertToggle === 1) {
      // Test 1: Primary offensive starter ruled OUT officially
      const item = {
        key: "test-official-out-" + Date.now(),
        title: "Stephen Curry (GSW) — Ruled OUT tonight vs. Thunder with left ankle sprain",
        detail: "Starting PG and primary offensive option (28.4 PPG, 32.5 MPG, +6.4 on-court +/-). Official league injury report filing.",
        sev: "out",
        sevLabel: "OUT (Official NBA Report)",
        team: "GSW",
        player: "Stephen Curry",
        url: "https://official.nba.com/nba-injury-report-2025-26-season/",
        observedAt: new Date().toISOString(),
        ts: new Date().toISOString(),
        alertEligible: true,
        impact: {
          impact: "high",
          grade: "high",
          score: 88,
          offenseTier: "primary",
          impactLabel: "HIGH — primary offensive starter is off the floor · 28.4 ppg, +6.4 on-court +/-"
        }
      };
      fire(item);
      if (typeof Wire !== "undefined" && Wire.push) {
        Wire.push({
          key: item.key, ts: item.ts, sev: item.sev, sevLabel: item.sevLabel, layer: "official-nba",
          text: item.title, detail: item.detail, url: item.url, team: item.team, player: item.player,
          source: "Official NBA report (live test alert)"
        });
        Wire.render([]);
      }
      return { type: "official-out", title: item.title };
    } else {
      // Test 2: In-game ongoing exit, offensive player questionable to return
      const item = {
        key: "test-ingame-exit-" + Date.now(),
        title: "Jayson Tatum (BOS) — Left game in 2Q to locker room; QUESTIONABLE TO RETURN vs. Heat",
        detail: "In-game exit reported from court. Starting forward, primary scoring option (27.1 PPG, 35.8 MPG).",
        sev: "questionable",
        sevLabel: "QUESTIONABLE TO RETURN (in-game)",
        team: "BOS",
        player: "Jayson Tatum",
        url: "https://www.espn.com/nba/scoreboard",
        observedAt: new Date().toISOString(),
        ts: new Date().toISOString(),
        alertEligible: true,
        impact: {
          impact: "high",
          grade: "high",
          score: 91,
          offenseTier: "primary",
          impactLabel: "HIGH — primary offensive option exited ongoing game · questionable to return"
        }
      };
      fire(item);
      if (typeof Wire !== "undefined" && Wire.push) {
        Wire.push({
          key: item.key, ts: item.ts, sev: item.sev, sevLabel: item.sevLabel, layer: "in-game",
          text: item.title, detail: item.detail, url: item.url, team: item.team, player: item.player,
          source: "Live in-game monitor (live test alert)"
        });
        Wire.render([]);
      }
      return { type: "ingame-exit", title: item.title };
    }
  }

  function setSoundOn(v) {
    soundOn = !!v;
    if (soundOn) ctx(); // user gesture unlocks browser audio
    localStorage.setItem(LS_SOUND, soundOn ? "on" : "off");
    return soundOn;
  }
  function isSoundOn() { return soundOn; }

  /* --- Browser notifications --- */
  function notifPermission() {
    if (!("Notification" in window)) return "unsupported";
    return Notification.permission;
  }
  async function requestNotifPermission() {
    if (!("Notification" in window)) return "unsupported";
    try { return await Notification.requestPermission(); }
    catch (e) { return Notification.permission; }
  }
  function notify(title, body, url) {
    if (!("Notification" in window) || Notification.permission !== "granted") return false;
    try {
      const n = new Notification(title, { body: body || "", tag: "nba-injury-" + Date.now() });
      if (url) n.onclick = () => { window.open(url, "_blank"); n.close(); };
      return true;
    } catch (e) { console.warn("notify failed", e); return false; }
  }

  /* --- Alert log (persisted, newest first, capped at 100) --- */
  function getLog() {
    try { return JSON.parse(localStorage.getItem(LS_LOG) || "[]"); }
    catch (e) { return []; }
  }
  function log(message, url) {
    const entries = getLog();
    entries.unshift({ ts: new Date().toISOString(), message, url: url || null });
    localStorage.setItem(LS_LOG, JSON.stringify(entries.slice(0, 100)));
  }
  function clearLog() { localStorage.removeItem(LS_LOG); renderLog(); }
  function renderLog() {
    const el = document.getElementById("alertLog");
    if (!el) return;
    const entries = getLog();
    if (!entries.length) {
      el.innerHTML = '<div class="muted small">No alerts yet. New injury alerts will appear here with links for manual review.</div>';
      return;
    }
    el.innerHTML = entries.slice(0, 30).map(e => {
      const when = new Date(e.ts).toLocaleString();
      const msg = escapeHtml(e.message);
      const link = e.url ? ` <a href="${escapeHtml(e.url)}" target="_blank" rel="noopener">review&nbsp;↗</a>` : "";
      return `<div class="alert-entry"><time>${escapeHtml(when)}</time>${msg}${link}</div>`;
    }).join("");
  }

  /* Main entry: fire an alert for a wire item. Respects sound toggle.
   *
   * Freshness has TWO different meanings and conflating them once silenced real alerts:
   *   - a social post's publication time must be recent, otherwise an old post that resurfaces in
   *     an account feed would re-alert (so those items are judged by `ts`);
   *   - an injury-board or official-report CHANGE is an event at the moment we observe it — the
   *     source's own editorial timestamp can legitimately be hours older (ESPN stamps a listing
   *     with the report date; the NBA PDF is published hours before tip). Judging those by `ts`
   *     suppressed genuine OUT designations. Items that carry `observedAt` are judged on it.
   */
  /* High lineup impact is a claim by the impact model (assets/js/role.js, model v2): the item
   * carries either a full assessment (`impact.impact` / `impact.grade`) or the flattened board
   * shape (`impact.tier`). Both are read here so no producer can silently lose its escalation. */
  /* Impact readers accept EVERY shape the producers actually use, because a missed read here is
   * a high-impact absence announced with the ordinary chime (or not announced as high at all):
   *   - a full LineupImpact assessment            -> im.grade        (social layer)
   *   - the board's flattened clone               -> im.tier         (injuries.js)
   *   - a bare grade string                       -> im === "high"  (archived rows)
   *   - a flattened record with top-level fields  -> item.grade     (tools/poll_watch.js output)
   */
  function impactGrade(item) {
    const im = item && item.impact;
    if (!im) return (item && typeof item.grade === "string") ? item.grade : null;
    if (typeof im === "string") return im;
    return im.grade || im.impact || im.tier || (item && item.grade) || null;
  }
  function offenseTier(item) {
    const im = item && item.impact;
    if (im && typeof im === "object" && im.offenseTier) return im.offenseTier;
    return (item && item.offenseTier) || null;
  }
  function impactScore(item) {
    const im = item && item.impact;
    if (im && typeof im === "object" && typeof im.score === "number") return im.score;
    return (item && typeof item.score === "number") ? item.score : null;
  }

  function fire(item) {
    // One policy for ALL producers. A filter never silently drops the audit log.
    const filters = typeof App !== "undefined" && App.getFilters ? App.getFilters() : null;
    const allowed = !filters || (filters.sevs?.[item.sev] !== false &&
      (!filters.team || filters.team === "ALL" || item.team === filters.team));
    const judged = item.observedAt || item.ts;
    const maxAge = item.maxAgeMs || 30 * 60 * 1000;
    const fresh = !judged || isFresh(judged, maxAge);
    const high = impactGrade(item) === "high";
    const off = offenseTier(item);
    const score = impactScore(item);
    const offenseBit = off === "primary" ? "[PRIMARY OFFENSIVE OPTION] " : off === "secondary" ? "[2nd OPTION] " : "";
    const impact = high ? "⚡ HIGH LINEUP IMPACT" + (score == null ? "" : " " + score + "/100") + " " + offenseBit : "";
    const label = `${impact}[${item.sevLabel}] ${item.title}`;
    const ageNote = item.observedAt && item.ts && item.ts !== item.observedAt
      ? ` (source timestamp ${item.ts}; observed ${item.observedAt})` : "";
    if (item.alertEligible === false || !allowed || !fresh) {
      log("(silent: evidence, age or filter) " + label, item.url); renderLog(); return false;
    }
    log("🚨 " + label + ageNote, item.url);
    renderLog();
    if (soundOn && Date.now() - lastChimeAt > 1500) {
      /* HIGH LINEUP IMPACT gets its own voice so the room can tell the two apart without
       * looking at the screen; both are governed by the same ON/OFF switch. */
      if (high) playHighImpactChime(); else playChime();
      lastChimeAt = Date.now();
    }
    notify((high ? "⚡ HIGH LINEUP IMPACT — " : "") + "NBA Injury Alert — " + item.sevLabel,
      [item.title, item.detail].filter(Boolean).join(" — "), item.url);
    return true;
  }

  function isFresh(iso, maxAge = 20 * 60 * 1000) {
    const age = Date.now() - Date.parse(iso);
    return Number.isFinite(age) && age >= -60000 && age <= maxAge;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  return { isFresh, playChime, playHighImpactChime, testSound, testHighImpactSound, testLiveAlert, setSoundOn, isSoundOn, notifPermission, requestNotifPermission, notify, log, clearLog, renderLog, getLog, fire, impactGrade, offenseTier, impactScore, escapeHtml };
})();
