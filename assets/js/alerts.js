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

  /* Pleasant two-tone chime: soft sine bell at E5 -> A5 with gentle decay,
   * plus a faint octave shimmer. ~1.1s total. */
  function playChime() {
    try {
      const ac = ctx();
      if (!ac) return false;
      const t0 = ac.currentTime;
      const notes = [
        { f: 659.25, t: 0.00, d: 0.55, g: 0.22 },  // E5
        { f: 880.00, t: 0.16, d: 0.70, g: 0.20 },  // A5
        { f: 1318.5, t: 0.16, d: 0.45, g: 0.05 }   // E6 shimmer
      ];
      for (const n of notes) {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = "sine";
        osc.frequency.value = n.f;
        gain.gain.setValueAtTime(0.0001, t0 + n.t);
        gain.gain.exponentialRampToValueAtTime(n.g, t0 + n.t + 0.03);
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

  function testSound() {
    const ok = playChime();
    log("🔔 Sound test played" + (ok ? "" : " (audio unavailable in this browser)"), null);
    renderLog();
    return ok;
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
  function fire(item) {
    // One policy for ALL producers. A filter never silently drops the audit log.
    const filters = typeof App !== "undefined" && App.getFilters ? App.getFilters() : null;
    const allowed = !filters || (filters.sevs?.[item.sev] !== false &&
      (!filters.team || filters.team === "ALL" || item.team === filters.team));
    const judged = item.observedAt || item.ts;
    const maxAge = item.maxAgeMs || 30 * 60 * 1000;
    const fresh = !judged || isFresh(judged, maxAge);
    const impact = item.impact && (item.impact.impact === "high" || item.impact.tier === "high" || (item.impact.role && item.impact.role.tier === "starter" && (item.sev === "out" || item.sev === "doubtful"))) ? "⚡ HIGH LINEUP IMPACT " : "";
    const label = `${impact}[${item.sevLabel}] ${item.title}`;
    const ageNote = item.observedAt && item.ts && item.ts !== item.observedAt
      ? ` (source timestamp ${item.ts}; observed ${item.observedAt})` : "";
    if (item.alertEligible === false || !allowed || !fresh) {
      log("(silent: evidence, age or filter) " + label, item.url); renderLog(); return false;
    }
    log("🚨 " + label + ageNote, item.url);
    renderLog();
    if (soundOn && Date.now() - lastChimeAt > 1500) { playChime(); lastChimeAt = Date.now(); }
    notify("NBA Injury Alert — " + item.sevLabel, [item.title, item.detail].filter(Boolean).join(" — "), item.url);
    return true;
  }

  function isFresh(iso, maxAge = 20 * 60 * 1000) {
    const age = Date.now() - Date.parse(iso);
    return Number.isFinite(age) && age >= -60000 && age <= maxAge;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  return { isFresh, playChime, testSound, setSoundOn, isSoundOn, notifPermission, requestNotifPermission, notify, log, clearLog, renderLog, getLog, fire, escapeHtml };
})();
