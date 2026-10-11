// node --test test/   — alert engine (synthetic clock + data, in-memory store, mock sender) and the shipped page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { useMemoryStore, redis } from "../lib/store.js";
import { upsertSub, optOut } from "../lib/subs.js";
import { runAlerts } from "../lib/alerts.js";
import { mockSender } from "../lib/senders.js";

const T0 = Date.parse("2026-10-15T13:00:00Z"); // 9:00 AM ET Thursday
const drop = (id, kind, at, extra = {}) => ({ id, kind, tags: [kind], name: id, at, store: "Store", shop: "https://example.org/" + id, ...extra });
const board = (extra = []) => [
  drop("sup-w9", "street", "2026-10-15T15:00:00Z"),      // 11 AM ET today
  drop("aj1", "kicks", "2026-10-15T13:50:00Z"),          // 50 min out
  { id: "nis:ps5", kind: "games", tags: ["games"], name: "PS5 Slim", at: null, restock: true, status: "out", store: "restock watch", shop: "https://example.org/ps5" },
  ...extra,
];

test("first run is a baseline; reminders still fire; nothing twice", async () => {
  useMemoryStore();
  await upsertSub({ phone: "5550100001", cats: ["kicks", "street", "games"], tz: "America/New_York" });
  const s = mockSender();
  const r1 = await runAlerts({ drops: board(), now: T0, sender: s });
  assert.equal(r1.baseline_run, true);
  assert.equal(s.outbox.length, 1);
  assert.match(s.outbox[0].body, /1 HOUR: aj1/);
  assert.match(s.outbox[0].body, /TODAY: sup-w9/);
  assert.match(s.outbox[0].body, /Reply STOP/);
  const r2 = await runAlerts({ drops: board(), now: T0 + 15 * 60000, sender: s });
  assert.equal(r2.sent, 0);
});

test("restock flip and brand-new drop fire on the next run", async () => {
  useMemoryStore();
  await upsertSub({ email: "a@demo.test", cats: ["games", "collect"], remind: { before1h: false, morning: false } });
  const s = mockSender();
  await runAlerts({ drops: board(), now: T0, sender: s });
  assert.equal(s.outbox.length, 0);
  const b2 = board([drop("pk-new", "collect", "2026-10-20T14:00:00Z")]);
  b2[2] = { ...b2[2], status: "in_stock", store: "Walmart · Amazon", price: "$499" };
  await runAlerts({ drops: b2, now: T0 + 15 * 60000, sender: s });
  assert.equal(s.outbox.length, 1);
  assert.match(s.outbox[0].text, /RESTOCK: PS5 Slim in stock at Walmart, Amazon/);
  assert.match(s.outbox[0].text, /NEW COLLECTIBLES DROP: pk-new/);
  assert.match(s.outbox[0].unsub, /\/api\/unsubscribe\?id=.+&t=.+&ch=email/);
  await runAlerts({ drops: b2, now: T0 + 30 * 60000, sender: s });
  assert.equal(s.outbox.length, 1, "no repeat");
});

test("single 1-hour and restock texts use the team copy and stay within 160 chars", async () => {
  useMemoryStore();
  await upsertSub({ phone: "5550100009", cats: ["kicks"], remind: { before1h: true, morning: false } });
  const s = mockSender();
  await runAlerts({ drops: board(), now: T0, sender: s, siteUrl: "https://dropwatch-livid.vercel.app" });
  assert.equal(s.outbox.length, 1);
  assert.match(s.outbox[0].body, /^\[DROP\] aj1 drops in 1 hour on Store! be ready: https:\/\/dropwatch-livid\.vercel\.app\/go\/[a-f0-9]{8}\nReply STOP to opt out$/);
  const { smsSingle } = await import("../lib/alerts.js");
  const long = smsSingle({ type: "restock", item: "PS5 Bundle: Disc Slim 1TB w/Fortnite Flowering Chaos Limited Edition", stores: "Walmart, Amazon", short: "https://dropwatch-livid.vercel.app/go/abcdef12" });
  assert.ok(long.length <= 160, long.length + " " + long);
  assert.match(long, /^\[RESTOCK\] PS5 Bundle.*\.\.\. is back in stock at Walmart, Amazon! (https:\/\/)?dropwatch-livid\.vercel\.app\/go\/abcdef12\nReply STOP to opt out$/);
});

test("opt-out is honored, and a failed send is retried later", async () => {
  useMemoryStore();
  await upsertSub({ phone: "+15550100002", cats: ["kicks"] });
  await optOut("sms", "+15550100002");
  const s = mockSender();
  await runAlerts({ drops: board(), now: T0, sender: s });
  assert.equal(s.outbox.length, 0);
  useMemoryStore();
  await upsertSub({ phone: "+15550100002", cats: ["kicks"] });
  let fail = true;
  const flaky = { sms: async (to, b) => (fail ? { ok: false, error: "boom" } : s.sms(to, b)), email: s.email };
  await runAlerts({ drops: board(), now: T0, sender: flaky });
  fail = false;
  await runAlerts({ drops: board(), now: T0 + 60000, sender: flaky });
  assert.equal(s.outbox.length, 1);
});

test("no storage -> alerts report inactive, nothing thrown", async () => {
  const { dropMemoryStore } = await import("../lib/store.js");
  dropMemoryStore();
  delete process.env.KV_REST_API_URL; delete process.env.UPSTASH_REDIS_REST_URL;
  const r = await runAlerts({ drops: board(), now: T0, sender: mockSender() });
  assert.equal(r.active, false);
});

test("page ships the v3 alerts UI and keeps v2", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /<meta name="viewport" content="width=device-width/);
  assert.match(html, /<title>dropwatch/);
  for (const id of ["ping-phone", "ping-email", "r-1h", "r-am", "open-alerts", "watch-url"]) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(html.includes('name="cat" value="games"'));
  assert.ok(html.includes('class="tabs" role="tablist"'));
  for (const m of html.matchAll(/(?:src|href)="(\/?[a-z][^":#]*\.(?:css|js))"/g)) assert.ok(existsSync(new URL("../public/" + m[1].replace(/^\//, ""), import.meta.url)), m[1]);
  assert.ok(!/lorem|TODO|placeholder text/i.test(html));
  assert.ok(existsSync(new URL("../.github/workflows/alerts.yml", import.meta.url)));
});
