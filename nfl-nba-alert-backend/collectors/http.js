"use strict";

const UA = "NBAInjuryReport-alert-backend/1.0 (+https://github.com/buffedlizard55-lab/NBAInjuryReport)";

function log(collector, msg) {
  const line = "[" + new Date().toISOString() + "] " + collector + " " + msg;
  console.log(line);
  return line;
}

async function fetchText(url, opts) {
  const ms = (opts && opts.timeoutMs) || 12000;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: Object.assign({
        "user-agent": UA,
        "accept": "application/json, application/rss+xml, application/xml, text/xml, */*"
      }, (opts && opts.headers) || {})
    });
    const text = await res.text();
    return {
      url,
      ok: res.ok,
      status: res.status,
      ms: Date.now() - t0,
      bytes: Buffer.byteLength(text),
      text,
      error: res.ok ? null : "HTTP " + res.status
    };
  } catch (e) {
    const cause = e && e.cause && (e.cause.code || e.cause.message);
    return {
      url,
      ok: false,
      status: 0,
      ms: Date.now() - t0,
      bytes: 0,
      text: "",
      error: (e && e.name === "AbortError") ? "timeout" : (cause ? String(cause) : (e && e.message) || "fetch failed")
    };
  } finally {
    clearTimeout(to);
  }
}

async function fetchJson(url, opts) {
  const res = await fetchText(url, opts);
  if (!res.ok) return Object.assign(res, { json: null });
  try {
    return Object.assign(res, { json: JSON.parse(res.text) });
  } catch (e) {
    return Object.assign(res, { ok: false, json: null, error: "invalid json" });
  }
}

module.exports = { UA, log, fetchText, fetchJson };
