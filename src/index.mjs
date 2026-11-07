/** SPL:ACN MCP API SDK entry. Dual license: AGPL-3.0-or-later OR Slid Phi Labs Commercial. See /LICENSE. */
export { createMcpClient, MCP_SDK_VERSION, MCP_ENDPOINT, DEFAULT_TIMEOUT_MS } from "./client.mjs";
export { verifyReceipt, summarizeReceipt } from "./receipts.mjs";
export { DEMO_CARD, DEMO_CATALOG, DEMO_QUOTE, demoScript } from "./demo.mjs";
