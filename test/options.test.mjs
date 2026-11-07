/** spl-acn 0.3.0 option tests: quote, filter, warrant, receipt, batch, demo, prices, resilience, config. Dual license: AGPL-3.0-or-later OR Slid Phi Labs Commercial. See /LICENSE. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run, usage, loadConfig } from "../src/cli.mjs";
import { ask } from "../src/ask.mjs";
import { createMcpClient, MCP_ENDPOINT } from "../src/client.mjs";
import { verifyReceipt, summarizeReceipt } from "../src/receipts.mjs";

function stubFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, method: (opts && opts.method) || "GET", body: (opts && opts.body) || null });
    const hit = routes.find(
      (r) => url === r.url && ((opts && opts.method) || "GET") === r.method,
    );
    if (!hit) return { ok: false, status: 404, json: async () => ({ error: "not_found" }) };
    return { ok: hit.status < 300, status: hit.status, json: async () => hit.body };
  };
  fn.calls = calls;
  return fn;
}

const CATALOG = {
  method: "POST", url: MCP_ENDPOINT, status: 200,
  body: {
    jsonrpc: "2.0", id: 1,
    result: { plans: [{ sku: "chamber-year", name: "Chamber Year", usd: 200 }, { sku: "depot-gb", name: "Depot GB", usd_per_gb: 0.02 }] },
  },
};

const client = (fetchFn, extra = {}) => createMcpClient({ fetchFn, endpoint: MCP_ENDPOINT, ...extra });

// 1. quote — first-class price quotes without raw JSON
test("quote builds spl_quote args from gb=", async () => {
  const fetchFn = stubFetch([
    { method: "POST", url: MCP_ENDPOINT, status: 200, body: { jsonrpc: "2.0", id: 1, result: { usd: 0.2 } } },
  ]);
  const r = await run(["quote", "gb=10"], { fetchFn, env: {} });
  assert.equal(r.code, 0);
  assert.ok(r.text.includes("$0.2"));
  const sent = JSON.parse(fetchFn.calls[0].body);
  assert.equal(sent.params.name, "spl_quote");
  assert.equal(sent.params.arguments.bytes, 1e10);
});

test("quote needs a size and refuses before the network", async () => {
  const fetchFn = stubFetch([]);
  const r = await run(["quote", "product=chamber"], { fetchFn, env: {} });
  assert.equal(r.code, 2);
  assert.equal(fetchFn.calls.length, 0);
});

// 2. catalog filter
test("catalog query filters SKUs by name", async () => {
  const r = await run(["catalog", "chamber"], { fetchFn: stubFetch([CATALOG]), env: {} });
  assert.equal(r.code, 0);
  assert.equal(r.json.matches.length, 1);
  assert.equal(r.json.matches[0].sku, "chamber-year");
  assert.equal(r.json.total, 2);
});

// 3. warrant issue / verify
test("warrant issue caps spend on one tool", async () => {
  const fetchFn = stubFetch([
    { method: "POST", url: MCP_ENDPOINT, status: 200, body: { jsonrpc: "2.0", id: 1, result: { id: "w_1", capUsd: 5 } } },
  ]);
  const r = await run(["warrant", "issue", "cap-usd=5", "tool=spl_compress"], { fetchFn, env: {} });
  assert.equal(r.code, 0);
  const sent = JSON.parse(fetchFn.calls[0].body);
  assert.equal(sent.params.name, "spl_warrant_issue");
  assert.equal(sent.params.arguments.capUsd, 5);
});

test("warrant verify checks one id", async () => {
  const fetchFn = stubFetch([
    { method: "POST", url: MCP_ENDPOINT, status: 200, body: { jsonrpc: "2.0", id: 1, result: { id: "w_1", valid: true } } },
  ]);
  const r = await run(["warrant", "verify", "w_1"], { fetchFn, env: {} });
  assert.equal(r.code, 0);
  const sent = JSON.parse(fetchFn.calls[0].body);
  assert.deepEqual(sent.params.arguments, { id: "w_1" });
});

// 4. receipt verification, offline
test("good receipt verifies and summarizes", () => {
  const v = verifyReceipt({ stage: "run", ok: true, tool: "spl_compress", toolVersion: "1.2.0", sha256: "a".repeat(64) });
  assert.equal(v.ok, true);
  assert.ok(summarizeReceipt(v.receipt).includes("spl_compress"));
});

test("bad receipt lists every problem", () => {
  const v = verifyReceipt({ stage: "", ok: "yes", tool: "spl_x" });
  assert.equal(v.ok, false);
  assert.ok(v.problems.length >= 3);
});

test("receipt check refuses a malformed file with exit 1", async () => {
  const r = await run(["receipt", "check", '{"tool":"x"}'], { fetchFn: stubFetch([]), env: {} });
  assert.equal(r.code, 1);
  assert.ok(r.text.includes("Receipt refused"));
});

// 5. batch staged runs stop closed
test("batch runs steps in order and reports clean", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spl-acn-"));
  const plan = path.join(dir, "plan.json");
  fs.writeFileSync(plan, JSON.stringify({ steps: [{ tool: "spl_quote", args: { gb: 1 } }, { tool: "spl_catalog", args: {} }] }));
  const fetchFn = stubFetch([
    { method: "POST", url: MCP_ENDPOINT, status: 200, body: { jsonrpc: "2.0", id: 1, result: { ok: true } } },
  ]);
  const r = await run(["batch", plan], { fetchFn, env: {} });
  assert.equal(r.code, 0);
  assert.equal(r.json.completed, 2);
  assert.equal(fetchFn.calls.length, 2);
});

test("batch stops at the first refusal and later steps never run", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spl-acn-"));
  const plan = path.join(dir, "plan.json");
  fs.writeFileSync(plan, JSON.stringify({ steps: [{ tool: "spl_pay", args: {} }, { tool: "spl_quote", args: {} }] }));
  const fetchFn = stubFetch([
    { method: "POST", url: MCP_ENDPOINT, status: 402, body: { accepts: [] } },
  ]);
  const r = await run(["batch", plan], { fetchFn, env: {} });
  assert.equal(r.code, 1);
  assert.equal(r.json.completed, 0);
  assert.equal(fetchFn.calls.length, 1);
});

// 6. timeouts and retries
test("slow server refuses as timed_out", async () => {
  const fetchFn = async () => new Promise(() => {});
  const c = createMcpClient({ fetchFn, timeoutMs: 20 });
  const r = await c.card();
  assert.equal(r.ok, false);
  assert.equal(r.reason, "timed_out");
});

test("transport fault retries then succeeds, answered calls never replay", async () => {
  let n = 0;
  const fetchFn = async () => {
    n += 1;
    if (n === 1) throw new Error("boom");
    return { ok: true, status: 200, json: async () => ({ name: "spl-acn" }) };
  };
  const c = createMcpClient({ fetchFn, maxRetries: 2 });
  const r = await c.card();
  assert.equal(r.ok, true);
  assert.equal(n, 2);
});

test("answered 500 surfaces without replay", async () => {
  const fetchFn = stubFetch([
    { method: "GET", url: MCP_ENDPOINT, status: 500, body: { note: "down" } },
  ]);
  const c = createMcpClient({ fetchFn, maxRetries: 3 });
  const r = await c.card();
  assert.equal(r.ok, false);
  assert.equal(r.reason, "card_failed");
  assert.equal(fetchFn.calls.length, 1);
});

// 7. demo needs no network and no key
test("demo walks through offline with zero fetch calls", async () => {
  const fetchFn = async () => { throw new Error("must stay offline"); };
  const r = await run(["demo"], { fetchFn, env: {} });
  assert.equal(r.code, 0);
  assert.ok(r.text.includes("spl-acn card"));
  assert.equal(r.json.demo, true);
});

// 8. config file supplies the endpoint
test("config file endpoint is used", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spl-acn-"));
  const cfg = path.join(dir, "acn.json");
  fs.writeFileSync(cfg, JSON.stringify({ endpoint: "https://example.invalid/mcp" }));
  const fetchFn = stubFetch([
    { method: "GET", url: "https://example.invalid/mcp", status: 200, body: { name: "spl-acn" } },
  ]);
  const r = await run(["card"], { fetchFn, env: { SPL_ACN_CONFIG: cfg } });
  assert.equal(r.code, 0);
  assert.equal(loadConfig({ SPL_ACN_CONFIG: cfg }).endpoint, "https://example.invalid/mcp");
});

test("missing config file is silently ignored", () => {
  assert.deepEqual(loadConfig({ SPL_ACN_CONFIG: path.join(os.tmpdir(), "spl-acn-nope.json") }), {});
});

// 9. ask intents: quote-bytes, warrant, receipt, batch, demo
test("ask quotes a byte size in words", async () => {
  const fetchFn = stubFetch([
    { method: "POST", url: MCP_ENDPOINT, status: 200, body: { jsonrpc: "2.0", id: 1, result: { usd: 0.04 } } },
  ]);
  const out = await ask(client(fetchFn), "how much to compress 2 gb");
  assert.equal(out.code, 0);
  assert.equal(out.heard, "quote");
  assert.ok(out.equivalent.includes("bytes=2000000000"));
  assert.ok(out.say.join(" ").includes("$0.04"));
});

test("ask warrant and receipt hints need no network", async () => {
  const fetchFn = stubFetch([]);
  const w = await ask(client(fetchFn), "what is a warrant");
  assert.equal(w.heard, "warrant-hint");
  const v = await ask(client(fetchFn), "check this receipt for me");
  assert.equal(v.heard, "receipt-hint");
  assert.equal(fetchFn.calls.length, 0);
});

test("ask demo answers offline", async () => {
  const fetchFn = stubFetch([]);
  const out = await ask(client(fetchFn), "show me a demo");
  assert.equal(out.code, 0);
  assert.equal(out.heard, "demo");
  assert.equal(fetchFn.calls.length, 0);
});

// 10. prices table and --json
test("prices prints a one-line table", async () => {
  const r = await run(["prices"], { fetchFn: stubFetch([CATALOG]), env: {} });
  assert.equal(r.code, 0);
  assert.ok(r.text.includes("Chamber Year — $200 (chamber-year)"));
  assert.equal(r.json.prices.length, 2);
});

test("--json strips human text", async () => {
  const r = await run(["catalog", "--json"], { fetchFn: stubFetch([CATALOG]), env: {} });
  assert.equal(r.code, 0);
  assert.equal(r.text, undefined);
  assert.ok(r.json.result);
});

test("usage names every command", () => {
  for (const c of ["catalog", "prices", "quote", "warrant", "receipt", "batch", "demo"]) {
    assert.match(usage(), new RegExp(c));
  }
});

// Live server shape: MCP content block with a JSON string of products
const LIVE_CATALOG = {
  method: "POST", url: MCP_ENDPOINT, status: 200,
  body: {
    jsonrpc: "2.0", id: 1,
    result: {
      content: [{
        type: "text",
        text: JSON.stringify({
          products: [
            { sku: "chamber-year", name: "Chamber · annual cloak license", amount_usd: "200.00" },
            { sku: "rider-solo", name: "Rider · Solo seat", amount_usd: "12.00" },
          ],
        }),
      }],
    },
  },
};

test("live content-block catalog filters and prices", async () => {
  const f = await run(["catalog", "rider"], { fetchFn: stubFetch([LIVE_CATALOG]), env: {} });
  assert.equal(f.code, 0);
  assert.equal(f.json.matches.length, 1);
  assert.equal(f.json.matches[0].sku, "rider-solo");
  const p = await run(["prices"], { fetchFn: stubFetch([LIVE_CATALOG]), env: {} });
  assert.equal(p.code, 0);
  assert.ok(p.text.includes("Rider · Solo seat — $12.00 (rider-solo)"));
});

test("ask quotes from the live content-block shape", async () => {
  const out = await ask(client(stubFetch([LIVE_CATALOG])), "how much is rider-solo");
  assert.equal(out.code, 0);
  assert.ok(out.say.join(" ").includes("$12.00"));
});
