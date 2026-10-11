// Dry run: which alerts would fire RIGHT NOW against the live board — in-memory store + mock sender, nothing is sent.
// Usage: node scripts/dry-run.mjs [site-url]     (default https://dropwatch-livid.vercel.app)
// "Previous run" state is seeded from the bundled data/seed.js snapshot, so restock flips and new drops since that
// snapshot show up the way they would on a real 15-minute run. Then it runs a second time to prove dedupe.
import { useMemoryStore, redis, setJSON } from "../lib/store.js";
import { upsertSub } from "../lib/subs.js";
import { runAlerts } from "../lib/alerts.js";
import { mockSender } from "../lib/senders.js";
import SEED from "../data/seed.js";

const site = process.argv[2] || "https://dropwatch-livid.vercel.app";
const live = await (await fetch(site + "/api/drops", { signal: AbortSignal.timeout(20000) })).json();
const drops = live.drops || [];
console.log(`live board: ${drops.length} drops (served_from=${live.served_from}, updated ${live.updated_at})`);
console.log(`previous-run state: bundled snapshot from ${SEED.updated_at} (${SEED.drops.length} drops)\n`);

useMemoryStore();
// previous run = the seed snapshot
await redis("SET", "seen:init", SEED.updated_at);
await redis("SADD", "seen:ids", ...SEED.drops.filter((d) => !d.restock && d.at).map((d) => d.id));
for (const d of SEED.drops.filter((x) => x.restock))
  await setJSON("stock:" + d.id, { stores: d.status === "in_stock" ? String(d.store).split(" · ") : [], status: d.status });

const now = Date.now();
const soonest = drops.filter((d) => !d.restock && d.at && Date.parse(d.at) > now)[0];
const tracker = drops.find((d) => d.restock && d.status !== "in_stock") || drops.find((d) => d.restock);
const demo = [
  { ntfy: "dropwatch-demopush0001", tz: "America/New_York", cats: ["kicks", "games"] },
  { phone: "+15550100001", tz: "America/New_York", cats: ["kicks", "ye", "street", "collect", "games", "tix"] },
  { email: "everything@demo.test", tz: "America/Los_Angeles", cats: ["games"] },
  { phone: "+15550100003", email: "one-drop@demo.test", tz: "America/New_York", drop: soonest && { id: soonest.id, name: soonest.name, url: soonest.shop, at: soonest.at } },
  { phone: "+15550100004", tz: "America/Chicago", drop: tracker && { id: tracker.id, name: tracker.name, url: tracker.shop } },
];
for (const d of demo) await upsertSub(d);
console.log("demo subscribers: (0) Kicks + Consoles by free push, (1) all tabs by SMS, (2) Consoles tab by email, (3) just \"" + (soonest && soonest.name) + "\" by SMS+email, (4) just \"" + (tracker && tracker.name) + "\" restocks\n");

const sender = mockSender();
const r1 = await runAlerts({ drops, now, sender, siteUrl: site });
console.log("RUN 1 events:", JSON.stringify(r1.events, null, 1));
console.log(`RUN 1: ${r1.sent} message(s) sent to the mock sender`);
for (const m of r1.messages) console.log(`\n--- ${m.channel} → ${m.to}  [${m.result}]\n    alerts: ${m.alerts.join(" | ")}`);
for (const o of sender.outbox) console.log(`\n=== ${o.channel.toUpperCase()} to ${o.to}${o.subject ? "\nSubject: " + o.subject : ""}\n${o.channel === "sms" ? o.body : o.channel === "ntfy" ? "Title: " + o.title + "\n" + o.message + "\n(tap opens " + o.click + ")" : o.text}`);

const r2 = await runAlerts({ drops, now: now + 60000, sender, siteUrl: site });
console.log(`\nRUN 2 (one minute later, same data): ${r2.sent} message(s) — dedupe ${r2.sent === 0 ? "OK" : "FAILED"}`);

// Same real board, clock moved forward to the next real drop: what goes out the morning of it and 1 hour before.
if (soonest) {
  const T = Date.parse(soonest.at);
  for (const [label, at] of [["MORNING OF (8:05 AM ET)", Date.parse(new Date(T).toLocaleString("en-US", { timeZone: "America/New_York" }).split(",")[0] + " 08:05 EDT")], ["55 MIN BEFORE", T - 55 * 60000]]) {
    const s2 = mockSender();
    const r = await runAlerts({ drops, now: at, sender: s2, siteUrl: site, dry: false });
    console.log(`\n### clock set to ${new Date(at).toISOString()} — ${label} "${soonest.name}": ${r.sent} message(s)`);
    for (const o of s2.outbox) console.log(`=== ${o.channel.toUpperCase()} to ${o.to}${o.subject ? "  Subject: " + o.subject : ""}\n${o.channel === "sms" ? o.body : o.channel === "ntfy" ? "Title: " + o.title + "\n" + o.message + "\n(tap opens " + o.click + ")" : o.text.split("\n\nAll drops")[0]}\n`);
  }
}
