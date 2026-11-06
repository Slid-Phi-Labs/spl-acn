/** spl-acn ask tests. Dual license: AGPL-3.0-or-later OR Slid Phi Labs Commercial. See /LICENSE. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli.mjs";
import { ask } from "../src/ask.mjs";
import { createMcpClient, MCP_ENDPOINT } from "../src/client.mjs";

function stubFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, method: (opts && opts.method) || "GET" });
    const hit = routes.find(
      (r) => url === r.url && ((opts && opts.method) || "GET") === r.method,
    );
    if (!hit) return { ok: false, status: 404, json: async () => ({ error: "not_found" }) };
    return { ok: hit.status < 300, status: hit.status, json: async () => hit.body };
  };
  fn.calls = calls;
  return fn;
}

const client = (fetchFn) => createMcpClient({ fetchFn, endpoint: MCP_ENDPOINT });

test("ask help answers with no network", async () => {
  const fetchFn = stubFetch([]);
  const out = await ask(client(fetchFn), "what can you do");
  assert.equal(out.code, 0);
  assert.ok(out.say.join("\n").includes("catalog"));
  assert.equal(fetchFn.calls.length, 0);
});

test("ask unknown answers with no network", async () => {
  const fetchFn = stubFetch([]);
  const out = await ask(client(fetchFn), "sing me a song");
  assert.equal(out.code, 2);
  assert.equal(fetchFn.calls.length, 0);
});

test("ask price quotes the matching sku", async () => {
  const fetchFn = stubFetch([
    { method: "POST", url: MCP_ENDPOINT, status: 200, body: { jsonrpc: "2.0", id: 1, result: { plans: [{ sku: "chamber-year", name: "Chamber Year", usd: 200 }] } } },
  ]);
  const out = await ask(client(fetchFn), "how much is chamber year");
  assert.equal(out.code, 0);
  assert.ok(out.say.join(" ").includes("200"));
  assert.equal(out.equivalent, "spl-acn catalog");
});

test("ask call parses key=value args", async () => {
  const fetchFn = stubFetch([
    { method: "POST", url: MCP_ENDPOINT, status: 200, body: { jsonrpc: "2.0", id: 1, result: { ok: true } } },
  ]);
  const out = await ask(client(fetchFn), "call spl_quote gb=10");
  assert.equal(out.code, 0);
  assert.equal(out.equivalent, 'spl-acn call spl_quote \'{"gb":"10"}\'');
});

test("ask call explains payment in words", async () => {
  const fetchFn = stubFetch([
    { method: "POST", url: MCP_ENDPOINT, status: 402, body: { accepts: [{ rail: "x402", amount: "0.02" }] } },
  ]);
  const out = await ask(client(fetchFn), "run spl_fetch with url=https://example.com");
  assert.equal(out.code, 1);
  assert.ok(out.say.join(" ").includes("payment"));
});

test("ask compression words route to spl_compress with no network", async () => {
  const fetchFn = stubFetch([]);
  const out = await ask(client(fetchFn), "compress my logs please");
  assert.equal(out.code, 2);
  assert.equal(out.heard, "compress-hint");
  assert.ok(out.say.join(" ").includes("spl_compress"));
  assert.equal(fetchFn.calls.length, 0);
});

test("ask CLI facet prints words plus the code command", async () => {
  const fetchFn = stubFetch([
    { method: "GET", url: MCP_ENDPOINT, status: 200, body: { name: "spl-acn" } },
  ]);
  const r = await run(["ask", "who", "are", "you"], { fetchFn, env: {} });
  assert.equal(r.code, 0);
  assert.ok(r.text.includes("spl-acn card"));
});
