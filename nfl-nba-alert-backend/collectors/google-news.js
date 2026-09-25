"use strict";

const { teamByAbbr, inferTeamBefore } = require("../models/teams");
const { alertsFromText, buildAlert, statusFromText, extractNames } = require("../models/alert");

function searchUrl(query) {
  return "https://news.google.com/rss/search?q=" + encodeURIComponent(query) +
    "&hl=en-US&gl=US&ceid=US:en";
}

function teamQuery(abbr, sport) {
  const t = teamByAbbr(abbr, sport);
  return '"' + (t.query || t.displayName || abbr) + '" injury when:1d';
}

function decode(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block, name) {
  const re = new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i");
  const m = block.match(re);
  return m ? m[1].trim() : "";
}

function parseRss(xml) {
  const items = [];
  const re = /<item\b[\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(String(xml || "")))) {
    const block = m[0];
    const title = decode(tag(block, "title"));
    const link = decode(tag(block, "link"));
    const pubDate = decode(tag(block, "pubDate"));
    const description = decode(tag(block, "description"));
    const source = decode(tag(block, "source"));
    if (!title && !description) continue;
    items.push({ title, link, pubDate, description, source });
  }
  return items;
}

function alertsFromItems(items, sport, opts) {
  const now = opts && opts.nowMs;
  const teamHint = opts && opts.team;
  const allow = opts && opts.clubs ? new Set(opts.clubs) : null;
  const out = [];
  for (const item of items || []) {
    const text = [item.title, item.description].filter(Boolean).join(" — ");
    if (!statusFromText(text) && !/injur|ruled out|questionable|doubtful/i.test(text)) continue;
    const names = extractNames(item.title || "") ;
    const pieces = alertsFromText({ text, names: names.length ? names : undefined });
    for (const piece of pieces) {
      const team = inferTeamBefore(text, piece.player_name, sport) || teamHint;
      if (!team) continue;
      if (allow && !allow.has(team)) continue;
      const ts = item.pubDate ? new Date(item.pubDate).toISOString() : null;
      if (item.pubDate && Number.isNaN(Date.parse(item.pubDate))) continue;
      out.push(buildAlert({
        source: "google-news",
        sport,
        team,
        player_name: piece.player_name,
        status: piece.status,
        timestamp_source: ts,
        verbatim_text: text.slice(0, 500),
        source_url: item.link || null,
        verified: false,
        game_id: (opts && opts.game_id) || null
      }, now));
    }
  }
  return out;
}

module.exports = { searchUrl, teamQuery, parseRss, alertsFromItems, decode };
