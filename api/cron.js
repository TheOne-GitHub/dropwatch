// GET /api/cron — called by Vercel Cron (see vercel.json). Re-scrapes every source and stores the snapshot
// (when a Redis store is connected). If CRON_SECRET is set, Vercel sends it as a Bearer token and we require it.
import { freshDrops } from "./drops.js";
import { send } from "../lib/http.js";
import { hasStore } from "../lib/store.js";

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return send(res, 401, { error: "unauthorized" });
  const d = await freshDrops({ force: true });
  send(res, 200, { ok: true, updated_at: d.updated_at, total: d.total, counts: d.counts, sources: d.sources, stored: hasStore(), served_from: d.served_from });
}
