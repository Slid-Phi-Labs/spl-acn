/** S2-F1..F4: paid-POST retry, endpoint, path and arg-size hardening. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMcpClient,
  validateEndpoint,
  MCP_ENDPOINT,
  MCP_ALLOWED_HOSTS,
  MCP_CANONICAL_PATH,
  MAX_ARGS_JSON_BYTES,
} from "../src/client.mjs";

const OK_RPC = { jsonrpc: "2.0", id: 1, result: { ok: true } };

function hang() {
  return new Promise(() => {});
}

function stubTimeoutThen(calls) {
  const fn = async (url, opts = {}) => {
    calls.push({ url, headers: opts.headers || {} });
    if (calls.length === 1) return hang();
    return { ok: true, status: 200, json: async () => OK_RPC };
  };
  return fn;
}

test("F1: a timed-out paid POST is NOT retried without an idempotency key", async () => {
  const calls = [];
  const c = createMcpClient({ fetchFn: stubTimeoutThen(calls), timeoutMs: 20, maxRetries: 3 });
  const r = await c.callTool("spl_compress", { data_b64: "eA==" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "timed_out");
  assert.equal(calls.length, 1, "exactly one attempt: the server may already have charged");
});

test("F1: with an idempotency key the timed-out POST retries with the header", async () => {
  const calls = [];
  const c = createMcpClient({ fetchFn: stubTimeoutThen(calls), timeoutMs: 20, maxRetries: 3 });
  const r = await c.callTool("spl_compress", { data_b64: "eA==" }, { idempotencyKey: "op-123" });
  assert.equal(r.ok, true);
  assert.ok(calls.length > 1, "retried once a key makes it safe");
  for (const call of calls) {
    assert.equal(call.headers["Idempotency-Key"], "op-123");
  }
});

test("F1: network failures (no response arrived) still retry without a key", async () => {
  const calls = [];
  const fetchFn = async () => {
    calls.push(1);
    if (calls.length === 1) throw new Error("socket hangup");
    return { ok: true, status: 200, json: async () => OK_RPC };
  };
  const c = createMcpClient({ fetchFn, timeoutMs: 0, maxRetries: 2 });
  const r = await c.callTool("spl_compress", {});
  assert.equal(r.ok, true);
  assert.equal(calls.length, 2);
});

test("F2: http endpoints are refused without localTest", async () => {
  const calls = [];
  const c = createMcpClient({ endpoint: "http://localhost:3000/api/mcp", fetchFn: async () => { calls.push(1); throw new Error("must not dial"); } });
  const r = await c.callTool("spl_catalog", {});
  assert.equal(r.ok, false);
  assert.equal(r.reason, "insecure_endpoint");
  assert.equal(calls.length, 0);
});

test("F2: unknown https hosts are refused without localTest", async () => {
  const calls = [];
  const c = createMcpClient({ endpoint: "https://evil.example/api/mcp", fetchFn: async () => { calls.push(1); throw new Error("must not dial"); } });
  const card = await c.card();
  assert.equal(card.ok, false);
  assert.equal(card.reason, "endpoint_host_mismatch");
  assert.equal(calls.length, 0);
});

test("F2: localTest allows http loopback", async () => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({ name: "local" }) };
  };
  const c = createMcpClient({ endpoint: "http://localhost:3000/api/mcp", localTest: true, fetchFn });
  const r = await c.card();
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
});

test("F2: default endpoint validates against the allowlist", () => {
  assert.ok(MCP_ALLOWED_HOSTS.includes("www.slidphilabs.com"));
  assert.equal(validateEndpoint(MCP_ENDPOINT).ok, true);
});

test("F3: a /mcp path is normalized to the canonical /api/mcp", async () => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({ name: "local" }) };
  };
  const c = createMcpClient({ endpoint: "https://www.slidphilabs.com/mcp", fetchFn });
  assert.equal(c.endpoint, "https://www.slidphilabs.com" + MCP_CANONICAL_PATH);
  await c.card();
  assert.equal(calls[0], "https://www.slidphilabs.com" + MCP_CANONICAL_PATH);
});

test("F4: oversized arguments refuse before any network", async () => {
  const calls = [];
  const c = createMcpClient({ fetchFn: async () => { calls.push(1); throw new Error("must not dial"); } });
  const big = { data_b64: "eA==".repeat(MAX_ARGS_JSON_BYTES) };
  const r = await c.callTool("spl_compress", big);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "args_too_large");
  assert.ok(r.bytes > r.maxBytes);
  assert.equal(calls.length, 0);
});

test("F4: the cap is overridable per call", async () => {
  const fetchFn = async () => ({ ok: true, status: 200, json: async () => OK_RPC });
  const c = createMcpClient({ fetchFn });
  const r = await c.callTool("spl_compress", { x: "y" }, { maxArgsBytes: 10 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "args_too_large");
});
