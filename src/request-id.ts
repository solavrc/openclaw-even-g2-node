export function createRequestId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
    return `req-${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
