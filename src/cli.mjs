#!/usr/bin/env node
/**
 * spl-acn — multifaceted terminal for the SPL:ACN MCP API.
 * Dual license: AGPL-3.0-or-later OR Slid Phi Labs Commercial. See /LICENSE.
 *
 *   spl-acn card                        # server card
 *   spl-acn catalog [query]             # standing SKUs, optionally filtered
 *   spl-acn prices                      # one-line price table
 *   spl-acn quote gb=10                 # price quote without raw JSON
 *   spl-acn call <tool> [json-args]     # any MCP tool
 *   spl-acn warrant issue|verify ...    # spend-capped warrants
 *   spl-acn receipt check <file|json>   # offline receipt verification
 *   spl-acn batch <plan.json>           # staged tool calls, stops closed
 *   spl-acn demo                        # offline walkthrough, no key
 *   spl-acn ask "..."                   # plain English (smart layer)
 *
 * Flags: --endpoint URL, --api-key KEY, --timeout MS, --retries N, --json
 * (or SPL_ACN_ENDPOINT / SPL_ACN_KEY / SPL_ACN_TIMEOUT / SPL_ACN_RETRIES).
 * A JSON config file (~/.spl-acn.json or SPL_ACN_CONFIG) supplies the same
 * defaults; precedence is flags, then env, then config. The CLI never
 * writes secrets — put the key in the file yourself, chmod 600.
 * JSON on stdout, errors on stderr. Codes: 0 ok, 1 call refused, 2 bad CLI.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMcpClient, MCP_SDK_VERSION } from "./client.mjs";
import { verifyReceipt, summarizeReceipt } from "./receipts.mjs";
import { demoScript } from "./demo.mjs";
import { catalogItems, itemPrice, matchItems } from "./catalog.mjs";

export const CLI_VERSION = MCP_SDK_VERSION;

const COMMANDS = [
  "card", "catalog", "prices", "quote", "call",
  "warrant", "receipt", "batch", "demo", "ask",
];

export function usage() {
  return [
    "spl-acn — SPL:ACN MCP terminal (card, catalog, call, and friends)",
    "",
    "Usage:",
    "  spl-acn card                    # server card",
    "  spl-acn catalog [query]         # standing SKUs via spl_catalog, filtered",
    "  spl-acn prices                  # one-line price table",
    '  spl-acn quote gb=10             # price via spl_quote (bytes=, product=, op=)',
    "  spl-acn call <tool> [json]      # any MCP tool with JSON args",
    "  spl-acn warrant issue cap-usd=5 tool=spl_compress   # spend-capped warrant",
    "  spl-acn warrant verify <id>     # check a warrant",
    "  spl-acn receipt check <file|json>  # verify a run receipt offline",
    "  spl-acn batch <plan.json>       # staged calls, stops closed on refusal",
    "  spl-acn demo                    # offline walkthrough, no network",
    '  spl-acn ask "..."               # plain English, e.g. ask "how much is chamber"',
    "",
    "Flags: --endpoint URL --api-key KEY --timeout MS --retries N --json",
    "Env: SPL_ACN_ENDPOINT, SPL_ACN_KEY, SPL_ACN_TIMEOUT, SPL_ACN_RETRIES, SPL_ACN_CONFIG.",
    "Paid tools answer payment_required with accepts — pay, then retry.",
  ].join("\n");
}

/** Best-effort config file: {} when missing, unreadable, or malformed. */
export function loadConfig(env = {}) {
  try {
    const p =
      (env && typeof env.SPL_ACN_CONFIG === "string" && env.SPL_ACN_CONFIG) ||
      path.join(os.homedir(), ".spl-acn.json");
    const raw = fs.readFileSync(p, "utf8");
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function num(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/** Split argv into globals, key=value pairs, and positionals. */
function parseArgs(argv) {
  const flags = {};
  const kv = {};
  const positional = [];
  const args = argv.slice();
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--endpoint" || a === "--api-key" || a === "--timeout" || a === "--retries") {
      const v = args[(i += 1)];
      if (v == null || (typeof v === "string" && v.startsWith("--"))) {
        return { error: "missing value: " + a };
      }
      flags[a.slice(2)] = v;
    } else if (a === "--json") {
      flags.json = true;
    } else if (a === "--help" || a === "-h") {
      flags.help = true;
    } else if (typeof a === "string" && a.startsWith("--")) {
      // Not a global: treat --key value / --key=value as a command
      // argument (so `quote --gb 10` works like `quote gb=10`).
      const bare = a.slice(2);
      const eq = bare.indexOf("=");
      if (eq > 0) {
        kv[bare.slice(0, eq)] = bare.slice(eq + 1);
      } else {
        const v = args[i + 1];
        if (v == null || (typeof v === "string" && v.startsWith("--"))) {
          return { error: "unknown flag: " + a };
        }
        kv[bare] = v;
        i += 1;
      }
    } else if (typeof a === "string" && !a.startsWith("-") && a.includes("=") && !a.startsWith("=")) {
      const eq = a.indexOf("=");
      kv[a.slice(0, eq)] = a.slice(eq + 1);
    } else {
      positional.push(a);
    }
  }
  return { flags, kv, positional };
}

function stripText(r, jsonOnly) {
  if (jsonOnly && r && typeof r === "object") {
    const { text, ...rest } = r;
    return rest;
  }
  return r;
}

/**
 * Run one invocation. Returns { code, json?, text?, error? }; the thin
 * main wrapper below prints. fetchFn/env injectable so tests run offline.
 */
export async function run(argv = [], opts = {}) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const env = (opts && typeof opts.env === "object" ? opts.env : null) || process.env;
  const parsed = parseArgs(args);
  if (parsed.error) return { code: 2, error: parsed.error };
  const { flags, kv, positional } = parsed;
  if (flags.help) return { code: 0, text: usage() };
  const [cmd, ...rest] = positional;
  if (cmd == null) return { code: 2, error: "need a command", text: usage() };
  if (!COMMANDS.includes(cmd)) {
    return { code: 2, error: "unknown command: " + cmd, text: usage() };
  }
  const cfg = loadConfig(env);
  const timeoutMs =
    num(flags.timeout) ?? num(env.SPL_ACN_TIMEOUT) ?? num(cfg.timeoutMs) ?? num(cfg.timeout);
  const maxRetries =
    num(flags.retries) ?? num(env.SPL_ACN_RETRIES) ?? num(cfg.maxRetries) ?? num(cfg.retries);
  const client = createMcpClient({
    ...(flags.endpoint || env.SPL_ACN_ENDPOINT || cfg.endpoint ? { endpoint: flags.endpoint || env.SPL_ACN_ENDPOINT || cfg.endpoint } : {}),
    ...(flags["api-key"] || env.SPL_ACN_KEY || cfg.apiKey || cfg.key ? { apiKey: flags["api-key"] || env.SPL_ACN_KEY || cfg.apiKey || cfg.key } : {}),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(maxRetries === undefined ? {} : { maxRetries }),
    ...(opts && typeof opts.fetchFn === "function" ? { fetchFn: opts.fetchFn } : {}),
  });
  const jsonOnly = !!flags.json;

  if (cmd === "demo") {
    const d = demoScript();
    return stripText({ code: 0, text: d.say.join("\n"), json: d.json }, jsonOnly);
  }
  if (cmd === "card") {
    const r = await client.card();
    return stripText(r.ok ? { code: 0, json: r } : { code: 1, json: r }, jsonOnly);
  }
  if (cmd === "catalog") {
    const r = await client.callTool("spl_catalog", {});
    if (!r.ok) return stripText({ code: 1, json: r }, jsonOnly);
    if (!rest[0]) return stripText({ code: 0, json: r }, jsonOnly);
    const items = catalogItems(r.result);
    const matches = matchItems(items, rest[0]);
    return stripText({
      code: 0,
      text: `${matches.length} of ${items.length} listing(s) match "${rest[0]}".`,
      json: { ok: true, query: rest[0], total: items.length, matches },
    }, jsonOnly);
  }
  if (cmd === "prices") {
    const r = await client.callTool("spl_catalog", {});
    if (!r.ok) return stripText({ code: 1, json: r }, jsonOnly);
    const prices = [];
    for (const it of catalogItems(r.result)) {
      const p = itemPrice(it);
      if (p) prices.push({ name: it.name || it.sku || it.id, sku: it.sku, price: p.label });
    }
    const lines = prices.length
      ? prices.map((p) => `${p.name} — ${p.price}${p.sku ? ` (${p.sku})` : ""}`)
      : ["No priced listings in the catalog."];
    return stripText({ code: 0, text: lines.join("\n"), json: { ok: true, prices } }, jsonOnly);
  }
  if (cmd === "quote") {
    const gb = num(kv.gb ?? kv.gigabytes);
    const bytes = num(kv.bytes) ?? (gb !== undefined ? gb * 1e9 : undefined);
    if (bytes === undefined) return { code: 2, error: "quote needs gb= or bytes= (e.g. quote gb=10)" };
    const qargs = { bytes, ...(kv.product ? { product: kv.product } : {}), ...(kv.op ? { op: kv.op } : {}) };
    const r = await client.callTool("spl_quote", qargs);
    if (!r.ok) return stripText({ code: 1, json: r }, jsonOnly);
    const total = r.result && typeof r.result === "object"
      ? (r.result.usd ?? r.result.total ?? r.result.price) : undefined;
    const line = total !== undefined && total !== null
      ? `Quote: $${total} for ${bytes} bytes${kv.product ? ` (${kv.product})` : ""}.`
      : `Quote ready for ${bytes} bytes — full result below.`;
    return stripText({ code: 0, text: line, json: r }, jsonOnly);
  }
  if (cmd === "warrant") {
    const [sub, ...wrest] = rest;
    if (sub === "issue") {
      const cap = num(kv["cap-usd"] ?? kv.cap ?? kv.capUsd);
      const tool = kv.tool;
      if (cap === undefined) return { code: 2, error: "warrant issue needs cap-usd= (e.g. warrant issue cap-usd=5 tool=spl_compress)" };
      if (!tool) return { code: 2, error: "warrant issue needs tool= (which tool may spend)" };
      const r = await client.callTool("spl_warrant_issue", { capUsd: cap, tool });
      if (!r.ok) return stripText({ code: 1, json: r }, jsonOnly);
      return stripText({ code: 0, text: `Warrant issued: $${cap} cap on ${tool}. Full warrant below.`, json: r }, jsonOnly);
    }
    if (sub === "verify") {
      const id = wrest[0] || kv.id;
      if (!id) return { code: 2, error: "warrant verify needs an id" };
      const r = await client.callTool("spl_warrant_verify", { id });
      if (!r.ok) return stripText({ code: 1, json: r }, jsonOnly);
      return stripText({ code: 0, text: `Warrant ${id} answer below.`, json: r }, jsonOnly);
    }
    return { code: 2, error: "warrant needs issue or verify" };
  }
  if (cmd === "receipt") {
    const [sub, ...rrest] = rest;
    if (sub !== "check" || !rrest[0]) return { code: 2, error: "receipt needs: receipt check <file|json>" };
    let raw = rrest[0];
    try {
      if (!/^\s*[\[{]/.test(raw)) raw = fs.readFileSync(raw, "utf8");
    } catch {
      return { code: 2, error: "cannot read receipt file: " + rrest[0] };
    }
    const v = verifyReceipt(raw);
    if (!v.ok) {
      return stripText({ code: 1, text: "Receipt refused:\n- " + v.problems.join("\n- "), json: v }, jsonOnly);
    }
    return stripText({ code: 0, text: summarizeReceipt(v.receipt), json: v }, jsonOnly);
  }
  if (cmd === "batch") {
    if (!rest[0]) return { code: 2, error: "batch needs a plan file (JSON {steps:[{tool,args}]})" };
    let plan;
    try {
      plan = JSON.parse(fs.readFileSync(rest[0], "utf8"));
    } catch {
      return { code: 2, error: "cannot read plan file: " + rest[0] };
    }
    const steps = Array.isArray(plan) ? plan : plan.steps;
    if (!Array.isArray(steps) || steps.length === 0) {
      return { code: 2, error: "plan needs a non-empty steps array" };
    }
    const results = [];
    for (let i = 0; i < steps.length; i += 1) {
      const s = steps[i] || {};
      if (!s.tool) {
        return stripText({ code: 1, text: `Step ${i + 1} refused: missing tool. Stopped closed — nothing after ran.`, json: { ok: false, completed: i, total: steps.length, results } }, jsonOnly);
      }
      const r = await client.callTool(s.tool, s.args || {});
      results.push({ step: i + 1, tool: s.tool, ok: r.ok, ...(r.ok ? { result: r.result } : { reason: r.reason }) });
      if (!r.ok) {
        return stripText({
          code: 1,
          text: `Step ${i + 1} (${s.tool}) refused (${r.reason || "unknown"}). Stopped closed — ${steps.length - i - 1} step(s) never ran.`,
          json: { ok: false, completed: i, total: steps.length, results },
        }, jsonOnly);
      }
    }
    return stripText({
      code: 0,
      text: `Batch clean: ${results.length}/${steps.length} steps ran.`,
      json: { ok: true, completed: results.length, total: steps.length, results },
    }, jsonOnly);
  }
  if (cmd === "ask") return runAsk(client, rest, jsonOnly);
  const [tool, rawArgs] = rest;
  if (!tool) return { code: 2, error: "need a tool name" };
  let parsedArgs = {};
  if (rawArgs !== undefined) {
    try {
      parsedArgs = JSON.parse(rawArgs);
    } catch {
      return { code: 2, error: "bad JSON args" };
    }
  }
  const r = await client.callTool(tool, parsedArgs);
  return stripText(r.ok ? { code: 0, json: r } : { code: 1, json: r }, jsonOnly);
}

async function runAsk(client, rest, jsonOnly) {
  const { ask } = await import("./ask.mjs");
  const text = rest.join(" ");
  const out = await ask(client, text);
  const lines = [...(out.say || [])];
  if (out.equivalent) lines.push("code: " + out.equivalent);
  return stripText({ code: out.code, text: lines.join("\n"), ...(out.json === undefined ? {} : { json: out.json }) }, jsonOnly);
}

const isMain =
  typeof process !== "undefined" &&
  process.argv &&
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  const r = await run(process.argv.slice(2));
  if (r.text) console.log(r.text);
  if (r.json !== undefined) console.log(JSON.stringify(r.json, null, 2));
  if (r.error) console.error("spl-acn: " + r.error);
  process.exit(r.code);
}
