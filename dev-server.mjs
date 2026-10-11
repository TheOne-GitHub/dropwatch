// Local dev server: serves public/ and routes /api/<name> to api/<name>.js — same handlers Vercel runs.
// Usage: node dev-server.mjs  (PORT=3000 by default)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
const root = new URL(".", import.meta.url).pathname;
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml" };
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  try {
    const m = u.pathname.match(/^\/api\/([a-z0-9-]+)\/?$/);
    if (m) { const mod = await import(join(root, "api", m[1] + ".js")); return await mod.default(req, res); }
    let p = normalize(u.pathname).replace(/^(\.\.[/\\])+/, ""); if (p.endsWith("/")) p += "index.html";
    const buf = await readFile(join(root, "public", p));
    res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" }); res.end(buf);
  } catch (e) { res.writeHead(e.code === "ENOENT" || e.code === "ERR_MODULE_NOT_FOUND" ? 404 : 500, { "content-type": "text/plain" }); res.end(String(e.message || e)); }
}).listen(process.env.PORT || 3000, () => console.log("dropwatch dev on http://localhost:" + (process.env.PORT || 3000)));
