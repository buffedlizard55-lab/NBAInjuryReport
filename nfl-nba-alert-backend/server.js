"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { createStore } = require("./db/store");
const { createRuntime, startLoop } = require("./loop");
const { handle } = require("./api/routes");

const PUBLIC = path.join(__dirname, "public");

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  let rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  if (rel.includes("..")) return false;
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) return false;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.writeHead(200, {
    "content-type": contentType(file),
    "cache-control": "no-store",
    "access-control-allow-origin": "*"
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

function createServer(opts) {
  const store = (opts && opts.store) || createStore(process.env);
  const runtime = createRuntime(store, opts && opts.deps);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      handle(req, res, { store, runtime }).catch(err => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      });
      return;
    }
    if (!serveStatic(req, res)) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  });
  return { server, store, runtime };
}

function main() {
  const noLoop = process.argv.includes("--no-loop") || process.env.NO_LOOP === "1";
  const port = Number(process.env.PORT) || 8787;
  const host = process.env.HOST || "0.0.0.0";
  const { server, runtime, store } = createServer();
  server.listen(port, host, () => {
    console.log("[" + new Date().toISOString() + "] listening http://" + host + ":" + port + " db=" + store.kind + " loop=" + !noLoop);
  });
  if (!noLoop) startLoop(runtime);
}

if (require.main === module) main();

module.exports = { createServer, main };
