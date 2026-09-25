"use strict";

const { inferTeamBefore } = require("../models/teams");
const { alertsFromText, buildAlert, statusFromText } = require("../models/alert");

function feedUrl(handle, limit) {
  return "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=" +
    encodeURIComponent(handle) + "&limit=" + (limit || 15);
}

function postUrl(handle, uri) {
  const rkey = String(uri || "").split("/").pop();
  return "https://bsky.app/profile/" + handle + "/post/" + rkey;
}

function isOwnPost(item, handle) {
  if (!item || !item.post) return false;
  if (item.reason) return false;
  const author = (item.post.author || {}).handle;
  return !!author && author.toLowerCase() === String(handle).toLowerCase();
}

function authorVerified(post) {
  const v = post && post.author && post.author.verification;
  if (!v) return false;
  if (v.verifiedStatus && v.verifiedStatus !== "valid") return false;
  const list = v.verifications || [];
  return list.some(x => x && x.isValid !== false);
}

function alertsFromFeed(data, account, opts) {
  const now = opts && opts.nowMs;
  const sport = account.sport;
  const allow = opts && opts.clubs ? new Set(opts.clubs) : null;
  const out = [];
  for (const item of (data && data.feed) || []) {
    if (!isOwnPost(item, account.handle)) continue;
    const post = item.post;
    const rec = post.record || {};
    const text = String(rec.text || "");
    if (!statusFromText(text) && !/injur|ruled out|questionable|doubtful|evaluated|carted/i.test(text)) continue;
    const pieces = alertsFromText({ text });
    const verified = !!(account.bskyVerified || authorVerified(post));
    for (const piece of pieces) {
      const team = account.team || inferTeamBefore(text, piece.player_name, sport);
      if (!team) continue;
      if (allow && !allow.has(team)) continue;
      out.push(buildAlert({
        source: "bluesky",
        sport,
        team,
        player_name: piece.player_name,
        status: piece.status,
        timestamp_source: rec.createdAt || post.indexedAt || null,
        verbatim_text: text,
        source_url: postUrl(account.handle, post.uri),
        verified,
        game_id: (opts && opts.game_id) || null
      }, now));
    }
  }
  return out;
}

module.exports = { feedUrl, postUrl, isOwnPost, alertsFromFeed, authorVerified };
