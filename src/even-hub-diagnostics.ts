export const EVEN_HUB_EVENT_STORAGE_KEY = "openclaw-even-g2-node-even-hub-events";
export const EVEN_HUB_EVENT_ENDPOINT = "/__openclaw-even-g2-node/even-hub-event";
export const EVEN_HUB_EVENT_QUERY_PARAM = "evenHubEventLog";
export const LEGACY_RAW_INPUT_EVENT_QUERY_PARAM = "rawInputLog";
export const MAX_EVEN_HUB_EVENTS = 24;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type EvenHubEventLog = {
  id: number;
  at: string;
  deltaMs: number | null;
  action: string;
  payload: JsonValue;
};

function typeName(value: object) {
  const constructor = (value as { constructor?: { name?: unknown } }).constructor;
  return typeof constructor?.name === "string" && constructor.name ? constructor.name : "Object";
}

function bytePreview(bytes: Uint8Array) {
  return Array.from(bytes.slice(0, 24), (byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

export function jsonSafeValue(value: unknown, seen = new WeakSet<object>(), depth = 0): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value === undefined) return { $type: "undefined" };
  if (typeof value === "bigint") return { $type: "bigint", value: value.toString() };
  if (typeof value === "symbol") return { $type: "symbol", value: String(value) };
  if (typeof value === "function") return { $type: "function", name: value.name || null };
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return { $type: typeName(value), circular: true };
  if (depth >= 8) return { $type: typeName(value), truncated: "max-depth" };
  seen.add(value);
  if (value instanceof ArrayBuffer) {
    return {
      $type: "ArrayBuffer",
      byteLength: value.byteLength,
      previewHex: bytePreview(new Uint8Array(value)),
    };
  }
  if (ArrayBuffer.isView(value)) {
    const view = value;
    return {
      $type: typeName(view),
      byteLength: view.byteLength,
      previewHex: bytePreview(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)),
    };
  }
  if (value instanceof Blob) {
    return {
      $type: typeName(value),
      size: value.size,
      mimeType: value.type || null,
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 64).map((item) => jsonSafeValue(item, seen, depth + 1));
  }
  const object = value as Record<string, unknown>;
  const entries = Object.entries(object)
    .filter(([, entryValue]) => entryValue !== undefined)
    .slice(0, 128);
  return Object.fromEntries(entries.map(([key, entryValue]) => [key, jsonSafeValue(entryValue, seen, depth + 1)]));
}

export function evenHubEventPayload(event: unknown): JsonValue {
  return jsonSafeValue(event);
}

export function parseEvenHubEventLogs(value: unknown, limit = MAX_EVEN_HUB_EVENTS) {
  return Array.isArray(value)
    ? value.filter((item): item is EvenHubEventLog => typeof item === "object" && item !== null).slice(0, limit)
    : [];
}

export function shouldMirrorEvenHubEventsToDevServer() {
  return import.meta.env.DEV && globalThis.location?.protocol !== "file:";
}

function eventDiagnosticsEnabledFromUrl(url: string) {
  const params = new URL(url).searchParams;
  return params.get(EVEN_HUB_EVENT_QUERY_PARAM) === "1" || params.get(LEGACY_RAW_INPUT_EVENT_QUERY_PARAM) === "1";
}

export function evenHubEventDiagnosticsEnabled() {
  if (import.meta.env.DEV) return true;
  try {
    return eventDiagnosticsEnabledFromUrl(globalThis.location.href);
  } catch {
    return false;
  }
}

export function evenHubEventUiDiagnosticsEnabled() {
  try {
    return eventDiagnosticsEnabledFromUrl(globalThis.location.href);
  } catch {
    return false;
  }
}

export function evenHubEventDiagnosticLog(...args: unknown[]) {
  if (evenHubEventDiagnosticsEnabled()) globalThis["console"].info(...args);
}
