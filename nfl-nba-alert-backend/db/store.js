"use strict";

const path = require("path");
const { FileStore } = require("./file-store");
const { SupabaseStore } = require("./supabase-store");

function createStore(env) {
  const e = env || process.env;
  if (e.SUPABASE_URL && e.SUPABASE_KEY) {
    return new SupabaseStore({ url: e.SUPABASE_URL, key: e.SUPABASE_KEY });
  }
  const dir = e.DATA_DIR || path.join(__dirname, "..", "data");
  return new FileStore(dir);
}

module.exports = { createStore };
