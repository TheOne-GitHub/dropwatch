// /api/unsubscribe?id=<sub>&t=<token>[&ch=email|sms|ntfy|all] — the link at the bottom of every alert email and the
// "Stop alerts" button on every push. /api/unsubscribe?topic=<ntfy topic> stops push alerts to that topic (the site's
// "Stop push alerts" button uses it; the topic is the secret, so whoever holds it may stop it).
// GET shows a confirm button (so mail scanners that pre-open links don't unsubscribe people);
// POST (the button, the site, or a mail app's one-click List-Unsubscribe-Post) does it.
import { html, query, send } from "../lib/http.js";
import { hasStore } from "../lib/store.js";
import { unsubscribe, unsubscribeTopic, getSub, normTopic } from "../lib/subs.js";

const BAD = "<p>That unsubscribe link didn't match a subscription. For texts, reply STOP to any alert.</p>";
const DONE = { email: "No more alert emails.", sms: "No more alert texts.", ntfy: "No more push alerts.", all: "No more alerts, by push, text or email." };
const WHAT = { email: "alert emails", sms: "alert texts", ntfy: "push alerts", all: "all alerts" };

export default async function handler(req, res) {
  const q = query(req), id = q.get("id") || "", t = q.get("t") || "";
  const topic = q.get("topic");
  const ch = topic ? "ntfy" : ["email", "sms", "ntfy", "all"].includes(q.get("ch")) ? q.get("ch") : "all";
  const wantsJson = /json/.test(String(req.headers?.accept || ""));
  if (!hasStore()) return wantsJson ? send(res, 200, { ok: true, note: "alerts not active" }) : html(res, 200, "Nothing to unsubscribe", "<p>Alerts aren't active on this site yet, so you aren't getting any.</p>");
  if (topic != null) {
    if (!normTopic(topic)) return wantsJson ? send(res, 422, { error: "bad topic" }) : html(res, 400, "Topic not recognised", "<p>That doesn't look like a dropwatch push topic.</p>");
    if (req.method === "POST") {
      await unsubscribeTopic(topic);
      return wantsJson ? send(res, 200, { ok: true, stopped: "ntfy" }) : html(res, 200, "You're unsubscribed", `<p>${DONE.ntfy} Signing up again on the site turns them back on. You can also remove the topic in the ntfy app.</p>`);
    }
    return html(res, 200, "Unsubscribe?", `<p>Stop push alerts from dropwatch?</p><form method="post"><button type="submit">Yes, unsubscribe</button></form>`);
  }
  if (req.method === "POST") {
    const sub = await unsubscribe(id, t, ch);
    if (!sub) return wantsJson ? send(res, 400, { error: "not recognised" }) : html(res, 400, "Link not recognised", BAD);
    return wantsJson ? send(res, 200, { ok: true, stopped: ch }) : html(res, 200, "You're unsubscribed", `<p>${DONE[ch]} Signing up again on the site turns them back on.</p>`);
  }
  const sub = await getSub(id);
  if (!sub || sub.token !== t) return html(res, 400, "Link not recognised", BAD);
  return html(res, 200, "Unsubscribe?", `<p>Stop ${WHAT[ch]} from dropwatch?</p><form method="post"><button type="submit">Yes, unsubscribe</button></form>`);
}
