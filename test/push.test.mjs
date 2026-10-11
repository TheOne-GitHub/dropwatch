// node --test test/   — v3.2 free push (ntfy): engine, copy, opt-out, signup/test/unsubscribe/health routes, sender wire format.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { useMemoryStore, dropMemoryStore, redis } from "../lib/store.js";
import { upsertSub, normTopic, newTopic, unsubscribeTopic, getSub } from "../lib/subs.js";
import { runAlerts, composePush, pushSingle } from "../lib/alerts.js";
import { mockSender, sendNtfy, ntfyReady } from "../lib/senders.js";

const T0 = Date.parse("2026-10-15T13:00:00Z"); // 9:00 AM ET Thursday
const drop = (id, kind, at, extra = {}) => ({ id, kind, tags: [kind], name: id, at, store: "Store", shop: "https://example.org/" + id, ...extra });
const board = () => [
  drop("aj1", "kicks", "2026-10-15T13:50:00Z"),
  { id: "nis:ps5", kind: "games", tags: ["games"], name: "PS5 Slim", at: null, restock: true, status: "out", store: "restock watch", shop: "https://example.org/ps5" },
];
const TOPIC = "dropwatch-testtopic1234";

function fakeRes() {
  return { statusCode: 200, headers: {}, out: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; },
    end(b) { this.out = String(b || ""); }, json() { return JSON.parse(this.out); } };
}
function fakeReq(method, url, body, headers = {}) {
  const buf = body == null ? [] : [Buffer.from(JSON.stringify(body))];
  return { method, url, headers: { host: "dropwatch-livid.vercel.app", "content-type": "application/json", ...headers }, body, async *[Symbol.asyncIterator]() { yield* buf; } };
}

test("topics: random, long, validated", () => {
  const a = newTopic(), b = newTopic();
  assert.match(a, /^dropwatch-[a-z0-9]{12}$/);
  assert.notEqual(a, b);
  assert.equal(normTopic(a), a);
  assert.equal(normTopic("https://ntfy.sh/" + a), a);
  assert.equal(normTopic("short"), null);
  assert.equal(normTopic("has space in it!!"), null);
  assert.equal(ntfyReady(), true); // on with no env vars at all
});

test("push subscriber gets Tomo's copy, full link, Click opens the drop, nothing twice", async () => {
  useMemoryStore();
  await upsertSub({ ntfy: TOPIC, cats: ["kicks", "games"], tz: "America/New_York" });
  const s = mockSender();
  const r1 = await runAlerts({ drops: board(), now: T0, sender: s });
  assert.equal(r1.sent, 1);
  const m = s.outbox[0];
  assert.equal(m.channel, "ntfy");
  assert.equal(m.to, TOPIC);
  assert.equal(m.message, "[DROP] aj1 drops in 1 hour on Store! be ready: https://example.org/aj1");
  assert.equal(m.click, "https://example.org/aj1");
  assert.match(m.title, /Drops in 1 hour/);
  assert.match(m.unsub, /\/api\/unsubscribe\?id=.+&t=.+&ch=ntfy$/);
  const r2 = await runAlerts({ drops: board(), now: T0 + 15 * 60000, sender: s });
  assert.equal(r2.sent, 0);
  // restock flip -> [RESTOCK] copy, no 160 squeeze, no STOP line
  const b = board(); b[1] = { ...b[1], status: "in_stock", store: "Walmart · Amazon · Target · Best Buy · GameStop" };
  await runAlerts({ drops: b, now: T0 + 30 * 60000, sender: s });
  assert.equal(s.outbox.length, 2);
  assert.equal(s.outbox[1].message, "[RESTOCK] PS5 Slim is back in stock at Walmart, Amazon, Target, Best Buy, GameStop! https://example.org/ps5");
  assert.ok(!/STOP/.test(s.outbox[1].message));
});

test("one person on push + text + email gets one message per channel", async () => {
  useMemoryStore();
  await upsertSub({ ntfy: TOPIC, phone: "5550100009", email: "x@demo.test", cats: ["kicks"] });
  const s = mockSender();
  await runAlerts({ drops: board(), now: T0, sender: s });
  assert.deepEqual(s.outbox.map((m) => m.channel).sort(), ["email", "ntfy", "sms"]);
  assert.match(s.outbox.find((m) => m.channel === "sms").body, /Reply STOP/);
});

test("unsubscribing a topic stops push; signing up again turns it back on", async () => {
  useMemoryStore();
  await upsertSub({ ntfy: TOPIC, cats: ["kicks"] });
  await unsubscribeTopic(TOPIC);
  const s = mockSender();
  assert.equal((await runAlerts({ drops: board(), now: T0, sender: s })).sent, 0);
  await upsertSub({ ntfy: TOPIC, cats: ["kicks"] });
  assert.equal((await runAlerts({ drops: board(), now: T0, sender: s })).sent, 1);
});

test("unsubscribe-all then re-signup is active again", async () => {
  useMemoryStore();
  const { sub } = await upsertSub({ ntfy: TOPIC, cats: ["kicks"] });
  const { unsubscribe } = await import("../lib/subs.js");
  await unsubscribe(sub.id, sub.token, "all");
  await upsertSub({ ntfy: TOPIC, cats: ["kicks"] });
  assert.equal((await getSub(sub.id)).removed_at, undefined);
  assert.equal((await runAlerts({ drops: board(), now: T0, sender: mockSender() })).sent, 1);
});

test("daily cap applies to push like the other channels", async () => {
  useMemoryStore();
  const { sub } = await upsertSub({ ntfy: TOPIC, cats: ["kicks"] });
  await redis("SET", `cap:${sub.id}:ntfy:2026-10-15`, "8");
  const r = await runAlerts({ drops: board(), now: T0, sender: mockSender() });
  assert.equal(r.sent, 0);
  assert.equal(r.messages[0].result, "daily cap reached");
  assert.ok(!(await redis("EXISTS", `sent:${sub.id}:ntfy:r1h:aj1:2026-10-15T13:50:00Z`))); // claim released for a later retry
});

test("composePush: multi-alert body, morning-of keeps its line", () => {
  const items = [
    { type: "r1h", item: "A", store: "S", url: "https://x.test/a", line: "1 HOUR: A" },
    { type: "am", line: "TODAY: B · 11:00 AM EDT · S", url: "https://x.test/b" },
  ];
  const p = composePush(items, { id: "i", token: "t" }, "https://site.test");
  assert.equal(p.title, "2 drop alerts");
  assert.match(p.message, /^\[DROP\] A drops in 1 hour on S! be ready: https:\/\/x\.test\/a\n\nTODAY: B · 11:00 AM EDT · S\nhttps:\/\/x\.test\/b$/);
  assert.equal(p.click, "https://x.test/a");
  assert.equal(pushSingle({ type: "am" }), null);
});

test("sendNtfy: POST <server>/<topic> with Title/Click/Tags/Actions, ASCII-safe headers, NTFY_SERVER override", async () => {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return new Response(JSON.stringify({ id: "abc" }), { status: 200 }); };
  try {
    let r = await sendNtfy(TOPIC, { title: "Drops in 1 hour: Pokémon · ETB", message: "body ✓", click: "https://example.org/x", tags: ["alarm_clock"], unsub: "https://s.test/api/unsubscribe?id=1&t=2&ch=ntfy" });
    assert.deepEqual(r, { ok: true, id: "abc" });
    assert.equal(calls[0].url, "https://ntfy.sh/" + TOPIC);
    assert.equal(calls[0].opts.method, "POST");
    assert.equal(calls[0].opts.headers.Title, "Drops in 1 hour: Pokemon - ETB");
    assert.equal(calls[0].opts.headers.Click, "https://example.org/x");
    assert.equal(calls[0].opts.headers.Tags, "alarm_clock");
    assert.equal(calls[0].opts.headers.Actions, "view, Stop alerts, https://s.test/api/unsubscribe?id=1&t=2&ch=ntfy");
    assert.equal(calls[0].opts.body, "body ✓");
    process.env.NTFY_SERVER = "https://push.example.org/";
    await sendNtfy(TOPIC, { message: "m" });
    assert.equal(calls[1].url, "https://push.example.org/" + TOPIC);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "limit reached" }), { status: 429 });
    r = await sendNtfy(TOPIC, { message: "m" });
    assert.equal(r.ok, false); assert.match(r.error, /429/);
    assert.equal((await sendNtfy("bad", { message: "m" })).ok, false);
  } finally { globalThis.fetch = real; delete process.env.NTFY_SERVER; }
});

test("routes: health counts push as a channel; signup takes a topic; unsubscribe by topic; test route to=ntfy:", async () => {
  useMemoryStore();
  const health = (await import("../api/health.js")).default;
  let res = fakeRes(); await health(fakeReq("GET", "/api/health"), res);
  const h = res.json();
  assert.equal(h.alerts.active, true); assert.equal(h.alerts.push, true); assert.equal(h.alerts.sms, false);

  const signup = (await import("../api/signup.js")).default;
  res = fakeRes(); await signup(fakeReq("POST", "/api/signup", { ntfy: TOPIC, cats: ["kicks"] }), res);
  const j = res.json();
  assert.equal(res.statusCode, 200); assert.equal(j.alerts_active, true); assert.equal(j.push.subscribe_url, "https://ntfy.sh/" + TOPIC);
  res = fakeRes(); await signup(fakeReq("POST", "/api/signup", { ntfy: "nope", cats: ["kicks"] }), res);
  assert.equal(res.statusCode, 422);

  const unsub = (await import("../api/unsubscribe.js")).default;
  res = fakeRes(); await unsub(fakeReq("POST", "/api/unsubscribe?topic=" + TOPIC, null, { accept: "application/json" }), res);
  assert.equal(res.statusCode, 200);
  assert.ok(await redis("EXISTS", "optout:ntfy:" + TOPIC));

  const t = (await import("../api/alerts/test.js")).default;
  process.env.ADMIN_KEY = "k";
  const real = globalThis.fetch, posted = [];
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith("https://ntfy.sh/")) { posted.push({ url, opts }); return new Response(JSON.stringify({ id: "t1" }), { status: 200 }); }
    throw new Error("offline in tests");
  };
  try {
    res = fakeRes(); await t(fakeReq("GET", `/api/alerts/test?key=k&to=ntfy:${TOPIC}`), res);
    const tr = res.json();
    assert.equal(tr.channel, "ntfy"); assert.equal(tr.result.ok, true);
    assert.equal(posted[0].url, "https://ntfy.sh/" + TOPIC);
    res = fakeRes(); await t(fakeReq("GET", `/api/alerts/test?key=k&to=ntfy:bad`), res);
    assert.equal(res.statusCode, 422);
  } finally { globalThis.fetch = real; delete process.env.ADMIN_KEY; dropMemoryStore(); }
});

test("page: push is the first, default channel; ntfy app + topic links present", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const i = html.indexOf('id="via-push"');
  assert.ok(i > 0 && i < html.indexOf('id="via-sms"') && i < html.indexOf('id="via-email"'));
  assert.match(html, /id="via-push" checked/);
  assert.ok(html.includes("https://apps.apple.com/us/app/ntfy/id1625396347"));
  assert.ok(html.includes("https://play.google.com/store/apps/details?id=io.heckel.ntfy"));
  for (const id of ["push-topic", "push-link", "push-copy", "push-stop", "ping-phone", "ping-email"]) assert.ok(html.includes(`id="${id}"`), id);
  const js = readFileSync(new URL("../public/script.js", import.meta.url), "utf8");
  assert.match(js, /ntfy:usePush\?topic:null/);
  assert.match(js, /\/api\/unsubscribe\?topic=/);
});
