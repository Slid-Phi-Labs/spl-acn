/**
 * SPL:ACN MCP API client — one runtime for the hosted Agent Commerce Network.
 * Dual license: AGPL-3.0-or-later OR Slid Phi Labs Commercial. See /LICENSE.
 *
 * Reads the server card, calls MCP tools, and speaks the lab's envelopes:
 * claim-token auth on paid seats, x402 402 answers surfaced as
 * payment_required instead of throws. Pure except through the injectable
 * fetchFn: no default network beyond the call itself, no disk.
 * Fail-closed throughout — bad input, tool errors, and transport faults
 * all refuse with a reason, never a half result.
 *
 * Resilience (opt-in): timeoutMs aborts slow calls as timed_out, and
 * maxRetries replays transport faults where NO response arrived
 * (network_failed). A POST is never replayed after a timeout — the
 * server may already have executed it, and replaying a paid tool could
 * charge twice — unless the caller supplies an idempotency key, which
 * is sent as an Idempotency-Key header and makes the retry safe.
 * A call the server already answered is never replayed.
 *
 * Endpoints (S2-F2/F3): the canonical path is /api/mcp. A custom
 * endpoint must be https on a known host unless localTest is set;
 * a trailing /mcp path is normalized to /api/mcp.
 */

export const MCP_SDK_VERSION = "0.3.1";
export const MCP_ENDPOINT = "https://www.slidphilabs.com/api/mcp";
export const DEFAULT_TIMEOUT_MS = 30000;
export const MCP_CANONICAL_PATH = "/api/mcp";
export const MCP_ALLOWED_HOSTS = ["www.slidphilabs.com", "slidphilabs.com"];
export const MAX_ARGS_JSON_BYTES = 1048576;

/**
 * Validate a custom endpoint. Without localTest, only https URLs on a
 * known host are accepted. A /mcp path is normalized to /api/mcp so both
 * documented spellings reach the canonical route.
 */
export function validateEndpoint(raw, { localTest = false } = {}) {
  if (typeof raw !== "string" || !raw) return { ok: false, reason: "bad_endpoint" };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "bad_endpoint" };
  }
  if (!localTest) {
    if (url.protocol !== "https:") return { ok: false, reason: "insecure_endpoint" };
    if (!MCP_ALLOWED_HOSTS.includes(url.hostname.toLowerCase())) {
      return { ok: false, reason: "endpoint_host_mismatch" };
    }
  }
  let endpoint = raw;
  if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
    url.pathname = MCP_CANONICAL_PATH;
    endpoint = url.toString();
  }
  return { ok: true, endpoint };
}

function text(v) {
  return v == null ? "" : String(v);
}

/**
 * Create a client. endpoint defaults to the hosted card; apiKey is the
 * spl1.* claim token for paid seats (omit it for free tools); fetchFn
 * defaults to the global fetch and is stubbed in tests. timeoutMs caps
 * one attempt (0 disables, default 30s); maxRetries replays only
 * no-response transport faults (default 0, fail fast). localTest lifts
 * the https/known-host endpoint check for local development.
 * idempotencyKey, when set, is sent on POSTs and allows a timed-out
 * POST to be retried safely (single-call commands only).
 */
export function createMcpClient(opts = {}) {
  const endpoint =
    typeof opts.endpoint === "string" && opts.endpoint ? opts.endpoint : MCP_ENDPOINT;
  const apiKey = typeof opts.apiKey === "string" && opts.apiKey ? opts.apiKey : null;
  const fetchFn =
    typeof opts.fetchFn === "function"
      ? opts.fetchFn
      : typeof fetch === "function"
        ? fetch.bind(globalThis)
        : null;
  const timeoutMs =
    typeof opts.timeoutMs === "number" && Number.isFinite(opts.timeoutMs) && opts.timeoutMs >= 0
      ? opts.timeoutMs
      : DEFAULT_TIMEOUT_MS;
  const maxRetries =
    Number.isInteger(opts.maxRetries) && opts.maxRetries > 0 ? opts.maxRetries : 0;
  const localTest = opts.localTest === true;
  const clientKey =
    typeof opts.idempotencyKey === "string" && opts.idempotencyKey
      ? opts.idempotencyKey
      : null;
  const checked = validateEndpoint(endpoint, { localTest });
  const endpointError = checked.ok ? null : checked.reason;
  const finalEndpoint = checked.ok ? checked.endpoint : endpoint;

  async function once({ method = "GET", body, bodyText, idempotencyKey } = {}) {
    if (!fetchFn) return { ok: false, reason: "no_fetch", retryable: true };
    const init = {
      method,
      headers: {
        ...(body === undefined && bodyText === undefined ? {} : { "content-type": "application/json" }),
        ...(apiKey ? { authorization: "Bearer " + apiKey } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      ...(bodyText !== undefined
        ? { body: bodyText }
        : body === undefined
          ? {}
          : { body: JSON.stringify(body) }),
    };
    let res;
    try {
      const pending = fetchFn(finalEndpoint, init);
      // Swallow late rejections so a won timeout race never surfaces
      // as an unhandled rejection after we have already refused.
      if (pending && typeof pending.then === "function") pending.then(() => {}, () => {});
      if (!timeoutMs) {
        res = await pending;
      } else {
        let timer = null;
        try {
          res = await Promise.race([
            pending,
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error("__spl_acn_timeout")), timeoutMs);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
    } catch (err) {
      if (err && err.message === "__spl_acn_timeout") {
        return { ok: false, reason: "timed_out", retryable: true };
      }
      return { ok: false, reason: "network_failed", retryable: true };
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      return { ok: false, reason: "bad_response", status: res.status };
    }
    return { ok: true, res, data };
  }

  async function send(args, { allowTimeoutRetry = true } = {}) {
    let attempts = 0;
    for (;;) {
      attempts += 1;
      const out = await once(args);
      const mayRetry = out.reason === "network_failed" || (out.reason === "timed_out" && allowTimeoutRetry);
      if (!out.retryable || !mayRetry || attempts > maxRetries) {
        const { retryable, ...rest } = out;
        return attempts > 1 ? { ...rest, attempts } : rest;
      }
    }
  }

  return {
    endpoint: finalEndpoint,
    endpointError,

    /** Read the server card (GET). */
    async card() {
      if (endpointError) return { ok: false, reason: endpointError };
      const out = await send();
      if (!out.ok) return out;
      if (!out.res.ok || !out.data || typeof out.data !== "object") {
        return { ok: false, reason: "card_failed", status: out.res.status };
      }
      return { ok: true, card: out.data };
    },

    /**
     * Call one MCP tool by name. 402 answers come back as payment_required.
     * callOpts: idempotencyKey (safe retry of a timed-out POST),
     * maxArgsBytes (override for the argument size cap).
     */
    async callTool(name, args = {}, callOpts = {}) {
      if (endpointError) return { ok: false, reason: endpointError };
      const tool = text(name).trim();
      if (!tool) return { ok: false, reason: "bad_tool" };
      if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) {
        return { ok: false, reason: "bad_args" };
      }
      const key =
        typeof callOpts.idempotencyKey === "string" && callOpts.idempotencyKey
          ? callOpts.idempotencyKey
          : clientKey;
      const cap =
        Number.isInteger(callOpts.maxArgsBytes) && callOpts.maxArgsBytes > 0
          ? callOpts.maxArgsBytes
          : MAX_ARGS_JSON_BYTES;
      const bodyText = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: tool, arguments: args || {} },
      });
      if (bodyText.length > cap) {
        return { ok: false, reason: "args_too_large", bytes: bodyText.length, maxBytes: cap };
      }
      const out = await send(
        {
          method: "POST",
          bodyText,
          idempotencyKey: key,
        },
        { allowTimeoutRetry: !!key }
      );
      if (!out.ok) return out;
      if (out.res.status === 402) {
        return {
          ok: false,
          reason: "payment_required",
          ...(out.data && typeof out.data === "object" && out.data.accepts ? { accepts: out.data.accepts } : {}),
        };
      }
      if (!out.res.ok) return { ok: false, reason: "call_failed", status: out.res.status };
      const data = out.data;
      if (!data || typeof data !== "object") return { ok: false, reason: "bad_response" };
      if (data.error) {
        return {
          ok: false,
          reason: "tool_error",
          ...(typeof data.error.code === "number" ? { code: data.error.code } : {}),
          ...(typeof data.error.message === "string" ? { message: data.error.message } : {}),
        };
      }
      if (!("result" in data)) return { ok: false, reason: "bad_response" };
      return { ok: true, result: data.result };
    },
  };
}
