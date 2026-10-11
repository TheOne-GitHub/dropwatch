// /api/unsubscribe?id=<sub>&t=<token>[&ch=email|sms|all] — the link at the bottom of every alert email.
// GET shows a confirm button (so mail scanners that pre-open links don't unsubscribe people);
// POST (the button, or a mail app's one-click List-Unsubscribe-Post) does it.
import { html, query, send } from "../lib/http.js";
import { hasStore } from "../lib/store.js";
import { unsubscribe, getSub } from "../lib/subs.js";

export default async function handler(req, res) {
  const q = query(req), id = q.get("id") || "", t = q.get("t") || "", ch = ["email", "sms", "all"].includes(q.get("ch")) ? q.get("ch") : "all";
  if (!hasStore()) return html(res, 200, "Nothing to unsubscribe", "<p>Alerts aren't active on this site yet, so you aren't getting any.</p>");
  if (req.method === "POST") {
    const sub = await unsubscribe(id, t, ch);
    if (!sub) return html(res, 400, "Link not recognised", "<p>That unsubscribe link didn't match a subscription. For texts, reply STOP to any alert.</p>");
    return html(res, 200, "You're unsubscribed", `<p>${ch === "email" ? "No more alert emails." : ch === "sms" ? "No more alert texts." : "No more alerts, by text or email."} Signing up again on the site turns them back on.</p>`);
  }
  const sub = await getSub(id);
  if (!sub || sub.token !== t) return html(res, 400, "Link not recognised", "<p>That unsubscribe link didn't match a subscription. For texts, reply STOP to any alert.</p>");
  const what = ch === "email" ? "alert emails" : ch === "sms" ? "alert texts" : "all alerts";
  return html(res, 200, "Unsubscribe?", `<p>Stop ${what} from dropwatch?</p><form method="post"><button type="submit">Yes, unsubscribe</button></form>`);
}
