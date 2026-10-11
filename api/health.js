import { send } from "../lib/http.js";
import { hasStore } from "../lib/store.js";
export default function handler(req, res) { send(res, 200, { ok: true, store: hasStore() ? "redis" : "none (signups go to logs)", ticketmaster: !!process.env.TICKETMASTER_API_KEY, cron_secret: !!process.env.CRON_SECRET }); }
