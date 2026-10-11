// GET /api/signups?key=ADMIN_KEY — list saved signups (needs ADMIN_KEY env var + a Redis store)
import { send, query } from "../lib/http.js";
import { redis, hasStore } from "../lib/store.js";
export default async function handler(req, res) {
  const key = process.env.ADMIN_KEY;
  if (!key || query(req).get("key") !== key) return send(res, 403, { error: "not allowed (set ADMIN_KEY in Vercel env vars, then pass ?key=...)" });
  if (!hasStore()) return send(res, 200, { count: 0, signups: [], note: "No Redis store connected; signups are in Vercel Logs (search SIGNUP)." });
  const rows = (await redis("LRANGE", "signups", 0, -1)) || [];
  send(res, 200, { count: rows.length, signups: rows.map((r) => JSON.parse(r)) });
}
