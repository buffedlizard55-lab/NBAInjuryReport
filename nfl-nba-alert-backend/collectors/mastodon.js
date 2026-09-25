"use strict";

const { inferTeamBefore, teamByAbbr } = require("../models/teams");
const { alertsFromText, buildAlert, statusFromText } = require("../models/alert");

const INSTANCE = "https://mastodon.social";

function tagUrl(tag, limit) {
  return INSTANCE + "/api/v1/timelines/tag/" + encodeURIComponent(tag) + "?limit=" + (limit || 20);
}

function tagsFor(sport, clubs) {
  const tags = sport === "nfl" ? ["nflinjury", "nfl"] : ["nbainjury", "nba"];
  for (const abbr of clubs || []) {
    const t = teamByAbbr(abbr, sport);
    if (t && t.name) tags.push(t.name.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  }
  return [...new Set(tags)].slice(0, 4);
}

function stripHtml(s) {
  return String(s || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isBlockedMirror(status) {
  const url = String(status && (status.url || status.uri) || "");
  if (/twitter\.com|x\.com|\/\/t\.co\b/i.test(url)) return true;
  const content = String(status && status.content || "");
  if (/twitter\.com|x\.com/i.test(content) && /twitter\.com|x\.com/i.test(url)) return true;
  return false;
}

function alertsFromStatuses(statuses, sport, opts) {
  const now = opts && opts.nowMs;
  const allow = opts && opts.clubs ? new Set(opts.clubs) : null;
  const out = [];
  for (const st of statuses || []) {
    if (isBlockedMirror(st)) continue;
    const text = stripHtml(st.content || st.spoiler_text || "");
    if (!statusFromText(text)) continue;
    const pieces = alertsFromText({ text });
    for (const piece of pieces) {
      const team = inferTeamBefore(text, piece.player_name, sport);
      if (!team) continue;
      if (allow && !allow.has(team)) continue;
      out.push(buildAlert({
        source: "mastodon",
        sport,
        team,
        player_name: piece.player_name,
        status: piece.status,
        timestamp_source: st.created_at || null,
        verbatim_text: text.slice(0, 500),
        source_url: st.url || st.uri || null,
        verified: false,
        game_id: (opts && opts.game_id) || null
      }, now));
    }
  }
  return out;
}

module.exports = { INSTANCE, tagUrl, tagsFor, stripHtml, isBlockedMirror, alertsFromStatuses };
