// GET /go/<code> (rewritten to /api/go?c=<code> in vercel.json) — short links used inside alert texts.
import { query } from "../lib/http.js";
import { redis, hasStore } from "../lib/store.js";
export default async function handler(req, res) {
  const c = String(query(req).get("c") || "").replace(/[^a-f0-9]/g, "").slice(0, 16);
  let url = null;
  try { if (c && hasStore()) url = await redis("GET", "go:" + c); } catch {}
  res.statusCode = 302; res.setHeader("location", url && /^https?:\/\//.test(url) ? url : "/"); res.setHeader("cache-control", "public, max-age=300"); res.end();
}
