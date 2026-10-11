// GET /api/signups?key=ADMIN_KEY — list subscribers (v3) and any v2 signups (needs ADMIN_KEY env var + a Redis store)
import { send, query } from "../lib/http.js";
import { redis, hasStore } from "../lib/store.js";
import { allSubs } from "../lib/subs.js";
import { mask } from "../lib/alerts.js";
export default async function handler(req, res) {
  const key = process.env.ADMIN_KEY;
  if (!key || query(req).get("key") !== key) return send(res, 403, { error: "not allowed (set ADMIN_KEY in Vercel env vars, then pass ?key=...)" });
  if (!hasStore()) return send(res, 200, { count: 0, signups: [], note: "No Redis store connected; signups are in Vercel Logs (search SIGNUP)." });
  const subs = await allSubs();
  const legacy = ((await redis("LRANGE", "signups", 0, -1)) || []).map((r) => JSON.parse(r));
  const full = query(req).get("full") === "1";
  send(res, 200, { count: subs.length, subscribers: subs.map((s) => ({ id: s.id, push: s.ntfy ? (full ? s.ntfy : mask(s.ntfy)) : null, phone: s.phone && (full ? s.phone : mask(s.phone)), email: s.email && (full ? s.email : mask(s.email)), cats: s.cats, drops: s.drops.map((d) => d.name), links: s.links, remind: s.remind, tz: s.tz, created_at: s.created_at, removed: !!s.removed_at })), v2_signups: legacy.length });
}
