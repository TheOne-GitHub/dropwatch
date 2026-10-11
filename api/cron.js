// GET /api/cron — the heartbeat. Called every 15 min by GitHub Actions (.github/workflows/alerts.yml) and once a day
// by Vercel Cron (vercel.json) as a backup. Refreshes the drop board (if the stored snapshot is > 10 min old), then
// runs the alert engine (lib/alerts.js). If CRON_SECRET is set, callers must send "Authorization: Bearer <CRON_SECRET>"
// (Vercel Cron does this automatically).
import { freshDrops } from "./drops.js";
import { send, siteUrl } from "../lib/http.js";
import { hasStore } from "../lib/store.js";
import { runAlerts } from "../lib/alerts.js";

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return send(res, 401, { error: "unauthorized" });
  const d = await freshDrops({ maxAgeMs: 10 * 60 * 1000 });
  let alerts;
  try { alerts = await runAlerts({ drops: d.drops || [], siteUrl: siteUrl(req) }); }
  catch (e) { alerts = { error: String(e.message || e) }; }
  const { messages, ...summary } = alerts || {};
  send(res, 200, { ok: true, updated_at: d.updated_at, total: d.total, counts: d.counts, sources: d.sources, stored: hasStore(), served_from: d.served_from,
    alerts: { ...summary, messages: (messages || []).map((m) => ({ channel: m.channel, to: m.to, alerts: m.alerts, result: m.result })) } });
}
