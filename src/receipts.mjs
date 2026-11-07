/**
 * SPL:ACN run-receipt checks — offline verification of signed run receipts.
 * Dual license: AGPL-3.0-or-later OR Slid Phi Labs Commercial. See /LICENSE.
 *
 * Every staged ACN run step emits a signed JSON receipt of the shape
 * { stage, ok, tool, toolVersion, sha256/size/tx }. This module checks
 * that shape with no network: presence and types of the envelope fields
 * plus at least one integrity anchor (sha256 digest, byte size, or
 * settlement tx). Signature math stays server-side; this answers "is
 * this receipt complete and well-formed" before you trust or file it.
 * Pure: no network, no disk. Fail-closed — anything odd is a problem,
 * never a pass.
 */

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Verify one receipt object (or its JSON text).
 * Returns { ok, problems[], receipt? }. ok is true only when
 * problems is empty; receipt echoes the parsed object on success.
 */
export function verifyReceipt(input) {
  const problems = [];
  let r = input;
  if (typeof r === "string") {
    const t = r.trim();
    if (!t) return { ok: false, problems: ["empty receipt"] };
    try {
      r = JSON.parse(t);
    } catch {
      return { ok: false, problems: ["not JSON and not a readable file path (let the caller load files)"] };
    }
  }
  if (!r || typeof r !== "object" || Array.isArray(r)) {
    return { ok: false, problems: ["receipt must be a JSON object"] };
  }
  if (!isNonEmptyString(r.stage)) problems.push("missing stage (string, e.g. plan, run, settle)");
  if (typeof r.ok !== "boolean") problems.push("missing ok (boolean)");
  if (!isNonEmptyString(r.tool)) problems.push("missing tool (string, e.g. spl_compress)");
  if (!isNonEmptyString(r.toolVersion)) problems.push("missing toolVersion (string)");
  const hasSha =
    typeof r.sha256 === "string" && /^[0-9a-fA-F]{64}$/.test(r.sha256.trim());
  const hasSize =
    typeof r.size === "number" && Number.isFinite(r.size) && r.size >= 0;
  const hasTx = isNonEmptyString(r.tx);
  if (typeof r.sha256 !== "undefined" && !hasSha) {
    problems.push("sha256 present but not a 64-hex digest");
  }
  if (typeof r.size !== "undefined" && !hasSize) {
    problems.push("size present but not a non-negative number");
  }
  if (!hasSha && !hasSize && !hasTx) {
    problems.push("no integrity anchor: need sha256, size, or tx");
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, problems, receipt: r };
}

/**
 * One human line for a verified receipt object.
 * Call only with output of verifyReceipt that passed.
 */
export function summarizeReceipt(r) {
  const anchor = typeof r.sha256 === "string"
    ? "sha256:" + r.sha256.slice(0, 12) + "…"
    : typeof r.tx === "string"
      ? "tx:" + r.tx.slice(0, 16) + "…"
      : "size:" + r.size;
  return `${r.ok ? "ok" : "FAILED"} stage=${r.stage} tool=${r.tool} v=${r.toolVersion} ${anchor}`;
}
