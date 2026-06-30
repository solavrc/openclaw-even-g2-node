import * as ed25519 from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { APP_VERSION } from "./app-version";
import { preprocessPcm16Mono } from "./voice-preprocess";

ed25519.hashes.sha512 = sha512;
ed25519.hashes.sha512Async = (message) => Promise.resolve(sha512(message));

const TALK_RELAY_FINAL_SILENCE_MS = 1200;
const GATEWAY_AUTH_URL_SETUP_PARAMS = new Set([
  "bootstrap",
  "bootstrap_token",
  "bootstraptoken",
  "setup",
  "setupcode",
  "setup_token",
  "setuptoken",
]);
const NODE_CATALOG_SOURCE = "__openclawNodeCatalogSource";

export type GatewayRole = "node" | "operator";

export type SetupCodePayload = {
  url: string;
  bootstrapToken?: string;
};

export type GatewayClientInfo = {
  id: GatewayClientId;
  displayName: string;
  version: string;
  platform: "even-g2";
  mode: "node" | "ui";
  instanceId: string;
  deviceFamily: "glasses";
  modelIdentifier: "Even G2";
};

export type GatewayClientId = "openclaw-even-g2-node" | "node-host";

export type DeviceIdentity = {
  deviceId: string;
  publicKeyRawBase64Url: string;
  privateKeyRawBase64Url: string;
  createdAtMs: number;
};

export type DeviceAuthEntry = {
  token: string;
  role: GatewayRole;
  scopes: string[];
  updatedAtMs: number;
};

export type GatewayFrame =
  | { type: "req"; id: string; method: string; params?: unknown }
  | { type: "res"; id: string; ok: boolean; payload?: unknown; error?: GatewayErrorShape }
  | { type: "event"; event: string; payload?: unknown; payloadJSON?: string };

export function gatewayRpcRequestEnvelope(id: string, method: string, params?: unknown): GatewayFrame {
  return {
    type: "req",
    id,
    method,
    ...(params === undefined || params === null ? {} : { params }),
  };
}

export function gatewayRpcRequestText(id: string, method: string, params?: unknown) {
  return JSON.stringify(gatewayRpcRequestEnvelope(id, method, params));
}

export type GatewayErrorShape = {
  code?: string;
  message?: string;
  details?: {
    code?: string;
    canRetryWithDeviceToken?: boolean;
    recommendedNextStep?: string;
    pauseReconnect?: boolean;
    reason?: string;
    requestId?: string;
    retryable?: boolean;
  };
};

export type GatewayConnectOptions = {
  url: string;
  token?: string;
  bootstrapToken?: string;
  role: GatewayRole;
  scopes: string[];
  caps: string[];
  commands: string[];
  permissions?: Record<string, boolean>;
  client: GatewayClientInfo;
  userAgent: string;
  identityStore?: DeviceIdentitySigner;
  authStore?: DeviceAuthStorage;
  WebSocketCtor?: GatewayWebSocketConstructor;
  onEvent?: (event: string, payload: unknown) => void;
  onOpen?: (hello: unknown, identity: DeviceIdentity) => void;
  onClose?: (event?: CloseEvent) => void;
  onError?: (error: Error) => void;
};

export type GatewayWebSocket = Pick<WebSocket, "addEventListener" | "close" | "readyState" | "send">;
export type GatewayWebSocketConstructor = new (url: string) => GatewayWebSocket;

export type DeviceIdentitySigner = {
  loadOrCreate(): Promise<DeviceIdentity>;
  sign(payload: string, identity: DeviceIdentity): Promise<string>;
};

export type DeviceAuthStorage = {
  load(deviceId: string, role: GatewayRole, gatewayUrl?: string): DeviceAuthEntry | null;
  remove?(deviceId: string, role: GatewayRole, gatewayUrl?: string): void;
  save(deviceId: string, role: GatewayRole, token: string, scopes: string[], gatewayUrl?: string): void;
};

export type RpcResult<T = unknown> = {
  ok: boolean;
  payload?: T;
  error?: GatewayErrorShape;
};

type PendingGatewayRequest = {
  reject: (error: Error) => void;
  resolveResult: (result: RpcResult) => void;
  timeout: ReturnType<typeof window.setTimeout>;
};

function gatewayEventPayload(frame: Extract<GatewayFrame, { type: "event" }>) {
  if (frame.payload !== undefined) return frame.payload;
  if (typeof frame.payloadJSON !== "string") return undefined;
  try {
    return JSON.parse(frame.payloadJSON) as unknown;
  } catch {
    return frame.payloadJSON;
  }
}

export const IDENTITY_STORAGE_KEY = "openclaw-even-g2-node-device-identity-v1";
export const AUTH_STORAGE_KEY = "openclaw-even-g2-node-device-auth-v1";
const DEFAULT_TRANSCRIPT_RAW_LIMIT = 160;
const MIN_TRANSCRIPT_MAX_CHARS = 60000;
const MAX_TRANSCRIPT_MAX_CHARS = 1000000;

function textEncoder() {
  return new TextEncoder();
}

function textDecoder() {
  return new TextDecoder();
}

export function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function sha256Hex(bytes: Uint8Array) {
  const digest = sha256(bytes);
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type RandomIdCrypto = {
  randomUUID?: () => string;
  getRandomValues?: Crypto["getRandomValues"];
};

export class GatewayConnectError extends Error {
  constructor(
    message: string,
    readonly gatewayError?: GatewayErrorShape,
  ) {
    super(message);
    this.name = "GatewayConnectError";
  }
}

function gatewayErrorFromConnectError(error: Error) {
  return error instanceof GatewayConnectError ? error.gatewayError : undefined;
}

function requestIdFromGatewayError(error: GatewayErrorShape | undefined) {
  const requestId = error?.details?.requestId;
  return typeof requestId === "string" && requestId.trim() ? requestId.trim() : "";
}

export function createGatewayRequestId(prefix = "req", webCrypto: RandomIdCrypto | undefined = globalThis.crypto) {
  if (typeof webCrypto?.randomUUID === "function") return webCrypto.randomUUID();
  if (typeof webCrypto?.getRandomValues === "function") {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
    return [
      hex.slice(0, 4).join(""),
      hex.slice(4, 6).join(""),
      hex.slice(6, 8).join(""),
      hex.slice(8, 10).join(""),
      hex.slice(10, 16).join(""),
    ].join("-");
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function parseSetupCode(input: string): SetupCodePayload {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("setup code is empty");
  if (/^wss?:\/\//i.test(trimmed)) return { url: trimmed };
  const decoded = textDecoder().decode(base64UrlDecode(trimmed));
  const parsed = JSON.parse(decoded) as { url?: unknown; bootstrapToken?: unknown };
  if (typeof parsed.url !== "string" || !/^wss?:\/\//i.test(parsed.url.trim())) {
    throw new Error("setup code does not contain a Gateway WebSocket URL");
  }
  return {
    url: parsed.url.trim(),
    bootstrapToken: typeof parsed.bootstrapToken === "string" ? parsed.bootstrapToken.trim() : undefined,
  };
}

export function normalizeSignedMetadata(value: string | undefined) {
  const trimmed = (value || "").trim();
  let out = "";
  for (const ch of trimmed) {
    const code = ch.charCodeAt(0);
    out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : ch;
  }
  return out;
}

export function buildDeviceAuthPayloadV3({
  deviceId,
  clientId,
  clientMode,
  role,
  scopes,
  signedAtMs,
  token,
  nonce,
  platform,
  deviceFamily,
}: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token?: string;
  nonce: string;
  platform?: string;
  deviceFamily?: string;
}) {
  return [
    "v3",
    deviceId,
    clientId,
    clientMode,
    role,
    scopes.join(","),
    String(signedAtMs),
    token || "",
    nonce,
    normalizeSignedMetadata(platform),
    normalizeSignedMetadata(deviceFamily),
  ].join("|");
}

export class BrowserDeviceIdentityStore {
  constructor(private readonly storage: Storage = localStorage) {}

  async loadOrCreate(): Promise<DeviceIdentity> {
    const loaded = await this.load();
    if (loaded) return loaded;
    const privateKey = ed25519.utils.randomSecretKey();
    const publicKey = await ed25519.getPublicKeyAsync(privateKey);
    const identity: DeviceIdentity = {
      deviceId: await sha256Hex(publicKey),
      publicKeyRawBase64Url: base64UrlEncode(publicKey),
      privateKeyRawBase64Url: base64UrlEncode(privateKey),
      createdAtMs: Date.now(),
    };
    this.storage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
    return identity;
  }

  async sign(payload: string, identity: DeviceIdentity) {
    const signature = await ed25519.signAsync(textEncoder().encode(payload), base64UrlDecode(identity.privateKeyRawBase64Url));
    return base64UrlEncode(signature);
  }

  private async load(): Promise<DeviceIdentity | null> {
    const raw = this.storage.getItem(IDENTITY_STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<DeviceIdentity>;
      if (!parsed.publicKeyRawBase64Url || !parsed.privateKeyRawBase64Url || !parsed.deviceId) return null;
      const derivedDeviceId = await sha256Hex(base64UrlDecode(parsed.publicKeyRawBase64Url));
      const identity: DeviceIdentity = {
        deviceId: derivedDeviceId,
        publicKeyRawBase64Url: parsed.publicKeyRawBase64Url,
        privateKeyRawBase64Url: parsed.privateKeyRawBase64Url,
        createdAtMs: typeof parsed.createdAtMs === "number" ? parsed.createdAtMs : Date.now(),
      };
      if (identity.deviceId !== parsed.deviceId) this.storage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
      return identity;
    } catch {
      return null;
    }
  }
}

export class BrowserDeviceAuthStore {
  constructor(private readonly storage: Storage = localStorage) {}

  load(deviceId: string, role: GatewayRole, gatewayUrl = ""): DeviceAuthEntry | null {
    const root = this.loadRoot();
    const entry = root[this.key(deviceId, role, gatewayUrl)];
    if (!entry?.token) return null;
    return {
      token: entry.token,
      role,
      scopes: Array.isArray(entry.scopes) ? entry.scopes.filter((scope) => typeof scope === "string").sort() : [],
      updatedAtMs: typeof entry.updatedAtMs === "number" ? entry.updatedAtMs : 0,
    };
  }

  save(deviceId: string, role: GatewayRole, token: string, scopes: string[], gatewayUrl = "") {
    const root = this.loadRoot();
    root[this.key(deviceId, role, gatewayUrl)] = {
      token: token.trim(),
      scopes: [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))].sort(),
      updatedAtMs: Date.now(),
    };
    this.storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(root));
  }

  remove(deviceId: string, role: GatewayRole, gatewayUrl = "") {
    const root = this.loadRoot();
    delete root[this.key(deviceId, role, gatewayUrl)];
    if (Object.keys(root).length) this.storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(root));
    else this.storage.removeItem(AUTH_STORAGE_KEY);
  }

  private key(deviceId: string, role: GatewayRole, gatewayUrl: string) {
    return `${deviceId.trim().toLowerCase()}.${role}.${normalizedGatewayAuthUrl(gatewayUrl)}`;
  }

  private loadRoot(): Record<string, { token?: string; scopes?: string[]; updatedAtMs?: number }> {
    const raw = this.storage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, { token?: string; scopes?: string[]; updatedAtMs?: number }> : {};
    } catch {
      return {};
    }
  }
}

export function normalizedGatewayAuthUrl(gatewayUrl: string) {
  const trimmed = gatewayUrl.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (GATEWAY_AUTH_URL_SETUP_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return trimmed.toLowerCase();
  }
}

export function clearBrowserDeviceCredentials(storage: Storage = localStorage) {
  storage.removeItem(IDENTITY_STORAGE_KEY);
  storage.removeItem(AUTH_STORAGE_KEY);
}

export function buildEvenG2ClientInfo(mode: "node" | "ui", instanceId: string, id: GatewayClientId = "openclaw-even-g2-node"): GatewayClientInfo {
  return {
    id,
    displayName: "Even G2",
    version: APP_VERSION,
    platform: "even-g2",
    mode,
    instanceId,
    deviceFamily: "glasses",
    modelIdentifier: "Even G2",
  };
}

type ConnectAuthPlan = {
  auth?: { token: string } | { bootstrapToken: string };
  authSource: "shared-token" | "device-token" | "bootstrap-token" | "none";
  scopes: string[];
  signatureToken: string;
};

function connectAuthPlan(options: GatewayConnectOptions, storedAuth?: DeviceAuthEntry | null): ConnectAuthPlan {
  const explicitToken = options.token?.trim() || "";
  const storedToken = storedAuth?.token?.trim() || "";
  const bootstrapToken = options.bootstrapToken?.trim() || "";
  const authToken = explicitToken || storedToken;
  const auth = authToken
    ? { token: authToken }
    : bootstrapToken
      ? { bootstrapToken }
      : undefined;
  const authSource = authToken ? (explicitToken ? "shared-token" : "device-token") : bootstrapToken ? "bootstrap-token" : "none";
  return {
    auth,
    authSource,
    scopes: authSource === "bootstrap-token" && options.role === "node" ? [] : options.scopes,
    signatureToken: authToken || bootstrapToken || "",
  };
}

async function buildConnectParamsWithAuthPlan(input: {
  identity: DeviceIdentity;
  nonce: string;
  options: GatewayConnectOptions;
  storedAuth?: DeviceAuthEntry | null;
}) {
  const authPlan = connectAuthPlan(input.options, input.storedAuth);
  const signedAtMs = Date.now();
  const payload = buildDeviceAuthPayloadV3({
    deviceId: input.identity.deviceId,
    clientId: input.options.client.id,
    clientMode: input.options.client.mode,
    role: input.options.role,
    scopes: authPlan.scopes,
    signedAtMs,
    token: authPlan.signatureToken,
    nonce: input.nonce,
    platform: input.options.client.platform,
    deviceFamily: input.options.client.deviceFamily,
  });
  const identityStore = input.options.identityStore || new BrowserDeviceIdentityStore();
  const signature = await identityStore.sign(payload, input.identity);
  return {
    authSource: authPlan.authSource,
    params: {
      minProtocol: 3,
      maxProtocol: 4,
      client: input.options.client,
      ...(input.options.caps.length ? { caps: input.options.caps } : {}),
      ...(input.options.commands.length ? { commands: input.options.commands } : {}),
      ...(input.options.permissions && Object.keys(input.options.permissions).length ? { permissions: input.options.permissions } : {}),
      role: input.options.role,
      ...(authPlan.scopes.length ? { scopes: authPlan.scopes } : {}),
      ...(authPlan.auth ? { auth: authPlan.auth } : {}),
      locale: typeof navigator === "undefined" ? "en-US" : navigator.language || "en-US",
      userAgent: input.options.userAgent,
      device: {
        id: input.identity.deviceId,
        publicKey: input.identity.publicKeyRawBase64Url,
        signature,
        signedAt: signedAtMs,
        nonce: input.nonce,
      },
    },
  };
}

export async function buildConnectParams({
  identity,
  nonce,
  options,
  storedAuth,
}: {
  identity: DeviceIdentity;
  nonce: string;
  options: GatewayConnectOptions;
  storedAuth?: DeviceAuthEntry | null;
}) {
  return (await buildConnectParamsWithAuthPlan({ identity, nonce, options, storedAuth })).params;
}

export class GatewayWsSession {
  private ws: GatewayWebSocket | null = null;
  private hello: unknown = null;
  private readonly pending = new Map<string, PendingGatewayRequest>();
  private readonly identityStore: DeviceIdentitySigner;
  private readonly authStore: DeviceAuthStorage;
  private closed = false;
  private generation = 0;
  private lastConnectAuthSource: ConnectAuthPlan["authSource"] = "none";
  private lastConnectNonce = "";
  private retriedStoredTokenFailureWithBootstrap = false;

  constructor(private readonly options: GatewayConnectOptions) {
    this.identityStore = options.identityStore || new BrowserDeviceIdentityStore();
    this.authStore = options.authStore || new BrowserDeviceAuthStore();
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN && this.hello !== null;
  }

  async connect() {
    const WebSocketCtor = this.options.WebSocketCtor || WebSocket;
    const generation = this.generation + 1;
    this.generation = generation;
    this.closed = false;
    this.lastConnectAuthSource = "none";
    this.lastConnectNonce = "";
    this.retriedStoredTokenFailureWithBootstrap = false;
    const identity = await this.identityStore.loadOrCreate();
    if (!this.isCurrentGeneration(generation)) return;
    const ws = new WebSocketCtor(this.options.url);
    if (!this.isCurrentGeneration(generation)) {
      ws.close();
      return;
    }
    this.ws = ws;
    ws.addEventListener("message", (event) => {
      if (!this.isCurrentSocket(ws, generation)) return;
      void this.handleMessage(String(event.data), identity, ws, generation);
    });
    ws.addEventListener("close", (event) => {
      if (!this.isCurrentSocket(ws, generation)) return;
      this.closed = true;
      this.ws = null;
      this.hello = null;
      this.rejectPending(new Error(closeReasonFromEvent(event) || "gateway session closed"));
      this.options.onClose?.(event);
    });
    ws.addEventListener("error", () => {
      if (!this.isCurrentSocket(ws, generation)) return;
      this.options.onError?.(new Error("gateway websocket error"));
    });
  }

  close() {
    this.closed = true;
    this.generation += 1;
    const ws = this.ws;
    this.ws = null;
    this.hello = null;
    this.rejectPending(new Error("gateway session closed"));
    ws?.close();
  }

  request<T = unknown>(method: string, params?: unknown, timeoutMs = 15000): Promise<T> {
    const id = createGatewayRequestId();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("gateway session is not open"));
    return new Promise<T>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        reject,
        resolveResult: (result) => {
          this.pending.delete(id);
          window.clearTimeout(timeout);
          if (result.ok) resolve(result.payload as T);
          else reject(new Error(result.error?.message || result.error?.code || `${method} failed`));
        },
        timeout,
      });
      ws.send(gatewayRpcRequestText(id, method, params));
    });
  }

  private isCurrentGeneration(generation: number) {
    return !this.closed && this.generation === generation;
  }

  private isCurrentSocket(ws: GatewayWebSocket, generation: number) {
    return this.ws === ws && this.isCurrentGeneration(generation);
  }

  private rejectPending(error: Error) {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      window.clearTimeout(pending.timeout);
      pending.reject(error);
    }
  }

  private resolvePending(id: string, result: RpcResult) {
    const pending = this.pending.get(id);
    if (!pending) return;
    pending.resolveResult(result);
  }

  sendRequestFrame(method: string, params?: unknown) {
    const id = createGatewayRequestId();
    this.ws?.send(gatewayRpcRequestText(id, method, params));
  }

  private async handleMessage(text: string, identity: DeviceIdentity, ws = this.ws, generation = this.generation) {
    if (ws && !this.isCurrentSocket(ws, generation)) return;
    if (!ws && this.closed) return;
    let frame: GatewayFrame;
    try {
      frame = JSON.parse(text) as GatewayFrame;
    } catch {
      return;
    }
    if (frame.type === "res") {
      if (frame.id === "__connect__" && frame.ok) {
        if (ws && !this.isCurrentSocket(ws, generation)) return;
        if (!ws && this.closed) return;
        this.hello = frame.payload;
        this.persistAuth(frame.payload, identity.deviceId);
        this.options.onOpen?.(frame.payload, identity);
      } else if (frame.id === "__connect__" && !frame.ok) {
        if (ws && !this.isCurrentSocket(ws, generation)) return;
        if (!ws && this.closed) return;
        if (await this.retryWithBootstrapAfterStoredTokenFailure(frame.error, identity, ws, generation)) return;
        this.options.onError?.(new GatewayConnectError(frame.error?.message || frame.error?.details?.code || frame.error?.code || "gateway connect failed", frame.error));
      }
      this.resolvePending(frame.id, { ok: frame.ok, payload: frame.payload, error: frame.error });
      return;
    }
    if (frame.type !== "event") return;
    const payload = gatewayEventPayload(frame);
    if (frame.event === "connect.challenge") {
      const nonce = typeof payload === "object" && payload && "nonce" in payload
        ? String((payload as { nonce?: unknown }).nonce || "")
        : "";
      if (!nonce) return;
      const connect = await buildConnectParamsWithAuthPlan({
        identity,
        nonce,
        options: this.options,
        storedAuth: this.authStore.load(identity.deviceId, this.options.role, this.options.url),
      });
      this.lastConnectAuthSource = connect.authSource;
      this.lastConnectNonce = nonce;
      if (ws) {
        if (!this.isCurrentSocket(ws, generation)) return;
        ws.send(gatewayRpcRequestText("__connect__", "connect", connect.params));
      } else {
        this.ws?.send(gatewayRpcRequestText("__connect__", "connect", connect.params));
      }
      return;
    }
    this.options.onEvent?.(frame.event, payload);
  }

  private shouldRetryWithBootstrapAfterStoredTokenFailure(error?: GatewayErrorShape) {
    if (this.retriedStoredTokenFailureWithBootstrap || this.lastConnectAuthSource !== "device-token") return false;
    if (!this.lastConnectNonce) return false;
    if (!this.options.bootstrapToken?.trim()) return false;
    if (gatewayErrorIsAuthPause(error)) return false;
    const normalized = [
      error?.code,
      error?.message,
      error?.details?.code,
      error?.details?.reason,
    ].filter(Boolean).join(" ").toLowerCase();
    if (normalized.includes("too many failed authentication attempts")) return false;
    return (
      normalized.includes("auth") ||
      normalized.includes("unauthorized") ||
      normalized.includes("token") ||
      normalized.includes("not approved") ||
      normalized.includes("approval") ||
      normalized.includes("pairing") ||
      normalized.includes("higher role") ||
      normalized.includes("role-upgrade") ||
      normalized.includes("role upgrade") ||
      normalized.includes("scope upgrade")
    );
  }

  private async retryWithBootstrapAfterStoredTokenFailure(
    error: GatewayErrorShape | undefined,
    identity: DeviceIdentity,
    ws: GatewayWebSocket | null,
    generation: number,
  ) {
    if (!this.shouldRetryWithBootstrapAfterStoredTokenFailure(error)) return false;
    this.retriedStoredTokenFailureWithBootstrap = true;
    this.authStore.remove?.(identity.deviceId, this.options.role, this.options.url);
    const connect = await buildConnectParamsWithAuthPlan({
      identity,
      nonce: this.lastConnectNonce,
      options: this.options,
      storedAuth: null,
    });
    this.lastConnectAuthSource = connect.authSource;
    if (ws) {
      if (!this.isCurrentSocket(ws, generation)) return true;
      ws.send(gatewayRpcRequestText("__connect__", "connect", connect.params));
    } else {
      this.ws?.send(gatewayRpcRequestText("__connect__", "connect", connect.params));
    }
    return true;
  }

  private persistAuth(payload: unknown, deviceId: string) {
    if (!payload || typeof payload !== "object" || !("auth" in payload)) return;
    const auth = (payload as { auth?: { deviceToken?: unknown; role?: unknown; scopes?: unknown; deviceTokens?: unknown } }).auth;
    if (!auth) return;
    const save = (role: unknown, token: unknown, scopes: unknown) => {
      if ((role === "node" || role === "operator") && typeof token === "string" && token.trim()) {
        const normalizedScopes = Array.isArray(scopes) ? scopes.filter((scope): scope is string => typeof scope === "string") : [];
        this.authStore.save(deviceId, role, token, normalizedScopes, this.options.url);
      }
    };
    save(auth.role || this.options.role, auth.deviceToken, auth.scopes);
    if (Array.isArray(auth.deviceTokens)) {
      for (const entry of auth.deviceTokens) {
        if (!entry || typeof entry !== "object") continue;
        const tokenEntry = entry as { role?: unknown; deviceToken?: unknown; scopes?: unknown };
        save(tokenEntry.role, tokenEntry.deviceToken, tokenEntry.scopes);
      }
    }
  }
}

function closeReasonFromEvent(event?: CloseEvent) {
  return typeof event?.reason === "string" ? event.reason.trim() : "";
}

function shouldPauseOperatorReconnect(reason: string) {
  const normalized = reason.toLowerCase();
  return (
    normalized.includes("auth") ||
    normalized.includes("unauthorized") ||
    normalized.includes("not approved") ||
    normalized.includes("approval") ||
    normalized.includes("pairing required") ||
    normalized.includes("higher role") ||
    normalized.includes("role-upgrade") ||
    normalized.includes("role upgrade") ||
    normalized.includes("scope upgrade")
  );
}

function gatewayErrorIsAuthPause(error?: GatewayErrorShape) {
  const normalized = [
    error?.code,
    error?.details?.code,
    error?.message,
    error?.details?.reason,
  ].filter(Boolean).join(" ").toLowerCase();
  return (
    normalized.includes("auth_paused") ||
    normalized.includes("authentication paused") ||
    normalized.includes("too many failed authentication attempts")
  );
}

function gatewayErrorRequestsReconnectPause(error?: GatewayErrorShape) {
  return Boolean(error?.details?.pauseReconnect || gatewayErrorIsAuthPause(error));
}

function makeTransportCloseEvent(reason = "") {
  if (typeof CloseEvent === "function") return new CloseEvent("close", { code: reason ? 1008 : 1000, reason });
  const event = new Event("close") as Event & Partial<CloseEvent>;
  Object.defineProperties(event, {
    code: { value: reason ? 1008 : 1000 },
    reason: { value: reason },
  });
  return event;
}

export type DirectTransportMessage =
  | { type: "ready"; service: "openclaw-gateway-direct" }
  | { type: "eveng2.runtime.status"; session?: string; node?: unknown }
  | { type: "eveng2.session.list.result"; sessions?: Array<Record<string, unknown>> }
  | { type: "eveng2.session.config.snapshot"; sessionKey?: string }
  | { type: "eveng2.session.switch.applied"; sessionKey?: string }
  | { type: "eveng2.session.create.failed"; error: string }
  | { type: "eveng2.session.transcript.snapshot"; sessionKey?: string; sessionId?: string | null; messages?: Array<Record<string, unknown>>; rawLimit?: number; rawCount?: number; hasFullHistory?: boolean; error?: string }
  | { type: "eveng2.session.send.ack"; sessionKey?: string; message?: string }
  | { type: "eveng2.session.voice.sent"; sessionKey?: string; idempotencyKey?: string }
  | { type: "voice.processing"; phase: "preprocess" | "upload" | "draft"; sessionKey?: string; targetSessionKey?: string; idempotencyKey?: string }
  | { type: "voice.draft.ready"; text: string; sessionKey?: string; targetSessionKey?: string; idempotencyKey?: string }
  | { type: "voice.draft.failed"; sessionKey?: string; targetSessionKey?: string; idempotencyKey?: string; error: string; code?: string }
  | { type: "eveng2.node.command"; id?: string; nodeId?: string; command?: string; params?: Record<string, unknown>; timeoutMs?: number }
  | { type: "eveng2.node.approval.required"; nodeId?: string; requestId?: string; approvalState?: string; commands?: string[] }
  | { type: "eveng2.node.approval.ready" }
  | { type: "eveng2.approval.request"; id?: string; requestId?: string; command?: string; cwd?: string | null; ask?: string | null; security?: string | null }
  | { type: "eveng2.approval.resolved"; id?: string; requestId?: string; decision?: string | null }
  | { type: "eveng2.approval.resolve.ack"; id?: string; requestId?: string; decision?: string | null; status: string; message?: string | null; error?: string }
  | { type: "error"; id?: string; error: string; requestId?: string; pauseReconnect?: boolean };

export type DirectTransportOptions = {
  setupCodeOrUrl: string;
  token?: string;
  selectedSessionKey?: string;
  instanceId?: string;
  storage?: Storage;
  WebSocketCtor?: GatewayWebSocketConstructor;
};

const FALLBACK_MAIN_SESSION_KEY = "agent:main:main";
const TALK_RELAY_FINAL_QUIET_MS = 500;
const TALK_RELAY_CLOSE_DRAIN_MS = 1800;

export type DirectVoiceStartConfig = {
  format?: {
    encoding?: string;
    sampleRateHz?: number;
    channels?: number;
  };
  transcriptionMode?: "attachment" | "talk-relay";
  transcriptionProvider?: string;
  sessionKey?: string;
  targetSessionKey?: string;
  draftTimeoutMs?: number;
  idempotencyKey?: string;
};

type DirectAppCommand =
  | { type: "eveng2.session.config.get" }
  | { type: "eveng2.session.list" }
  | { type: "eveng2.session.transcript.get"; sessionKey?: string; limit?: number }
  | { type: "eveng2.session.switch"; sessionKey?: string }
  | { type: "eveng2.session.create"; label?: string }
  | { type: "eveng2.session.send"; sessionKey?: string; message?: string; text?: string; idempotencyKey?: string }
  | { type: "eveng2.node.command.result"; id?: string; ok?: boolean; payload?: unknown; error?: unknown }
  | { type: "eveng2.node.approval.refresh" }
  | { type: "eveng2.approval.resolve"; id?: string; requestId?: string; decision?: string };

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asString).filter(Boolean) : [];
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map((item) => asObject(item)).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function sessionKeyFrom(value: Record<string, unknown>) {
  return asString(value.key) || asString(value.sessionKey) || asString(value.canonicalKey);
}

function looksLikeEvenG2Node(value: Record<string, unknown>) {
  const displayName = asString(value.displayName).toLowerCase();
  const platform = asString(value.platform).toLowerCase();
  const deviceFamily = asString(value.deviceFamily).toLowerCase();
  const clientId = asString(value.clientId).toLowerCase();
  const modelIdentifier = asString(value.modelIdentifier).toLowerCase();
  return (
    displayName === "even g2" ||
    platform === "even-g2" ||
    modelIdentifier.includes("even g2") ||
    clientId === "openclaw-even-g2-node" ||
    (clientId === "node-host" && deviceFamily === "glasses")
  );
}

function nodeDeviceId(value: Record<string, unknown>) {
  const device = asObject(value.device);
  return asString(value.deviceId) || asString(device?.id);
}

function isPendingNodeApproval(value: Record<string, unknown>) {
  const approvalState = asString(value.approvalState).toLowerCase();
  if (approvalState) return approvalState === "pending-approval" || approvalState === "pending-reapproval";
  return Boolean(asString(value.pendingRequestId) || asString(value.requestId));
}

function pendingNodeCatalogRow(value: Record<string, unknown>) {
  return {
    ...value,
    approvalState: asString(value.approvalState) || "pending-approval",
  };
}

function nodeCatalogRow(value: Record<string, unknown>, source: "nodes" | "paired" | "pending") {
  return {
    ...value,
    [NODE_CATALOG_SOURCE]: source,
  };
}

function isPendingCatalogSource(value: Record<string, unknown>) {
  return value[NODE_CATALOG_SOURCE] === "pending";
}

function nodeCatalogRows(payload: unknown) {
  const root = asObject(payload);
  const directRows = asObjectArray(root?.nodes).map((node) => nodeCatalogRow(node, "nodes"));
  const pairedRows = asObjectArray(root?.paired).map((node) => nodeCatalogRow(node, "paired"));
  const pendingRows = asObjectArray(root?.pending).map((node) => nodeCatalogRow(pendingNodeCatalogRow(node), "pending"));
  if (directRows.length || pendingRows.length || pairedRows.length) return [...directRows, ...pairedRows, ...pendingRows];
  return asObjectArray(payload);
}

function evenG2NodeSnapshotFromCatalogRow(value: Record<string, unknown>, fallbackDeviceId = "") {
  return {
    nodeId: asString(value.nodeId),
    deviceId: nodeDeviceId(value) || fallbackDeviceId,
    displayName: asString(value.displayName) || "Even G2",
    platform: asString(value.platform) || "even-g2",
    deviceFamily: asString(value.deviceFamily) || "glasses",
    modelIdentifier: asString(value.modelIdentifier) || "Even G2",
    nodeConnected: value.connected === true,
    connected: value.connected === true,
    paired: value.paired === true,
    approvalState: asString(value.approvalState),
    openclaw: {
      nodeEnabled: true,
      commands: asStringArray(value.commands).length ? asStringArray(value.commands) : asStringArray(value.pendingDeclaredCommands),
      lastError: null,
      lastConnectedAt: asString(value.connectedAt),
      lastDisconnectedAt: asString(value.disconnectedAt),
    },
  };
}

function suppressReadyApprovalStateWhilePending(
  snapshot: ReturnType<typeof evenG2NodeSnapshotFromCatalogRow>,
  pending: Record<string, unknown> | undefined,
) {
  if (!pending) return snapshot;
  const approvalState = asString(snapshot.approvalState).toLowerCase();
  if (approvalState !== "approved" && approvalState !== "ready") return snapshot;
  return {
    ...snapshot,
    approvalState: "",
  };
}

function sameCatalogNode(left: Record<string, unknown>, right: Record<string, unknown>) {
  const leftNodeId = asString(left.nodeId);
  const rightNodeId = asString(right.nodeId);
  if (leftNodeId && rightNodeId) return leftNodeId === rightNodeId;
  const leftDeviceId = nodeDeviceId(left);
  const rightDeviceId = nodeDeviceId(right);
  if (leftDeviceId && rightDeviceId) return leftDeviceId === rightDeviceId;
  return false;
}

function pendingCatalogRowMatchesCurrent(
  current: Record<string, unknown>,
  pending: Record<string, unknown>,
  runtimeCandidates: Record<string, unknown>[],
  pendingCandidates: Record<string, unknown>[],
) {
  if (sameCatalogNode(current, pending)) return true;
  if (asString(pending.nodeId) || nodeDeviceId(pending)) return false;
  return runtimeCandidates.every((node) => sameCatalogNode(current, node)) && pendingCandidates.length === 1;
}

function sourcePendingRowCanMatchCurrent(current: Record<string, unknown>, pending: Record<string, unknown>) {
  if (sameCatalogNode(current, pending)) return true;
  if (looksLikeEvenG2Node(pending)) return true;
  return isPendingNodeApproval(current) && !asString(pending.nodeId) && !nodeDeviceId(pending);
}

function preferredCatalogNode(nodes: Record<string, unknown>[]) {
  return [...nodes].sort((left, right) => {
    const leftScore =
      (left.connected === true ? 4 : 0) + (left.paired === true ? 2 : 0) + (left[NODE_CATALOG_SOURCE] === "paired" ? 1 : 0);
    const rightScore =
      (right.connected === true ? 4 : 0) + (right.paired === true ? 2 : 0) + (right[NODE_CATALOG_SOURCE] === "paired" ? 1 : 0);
    return rightScore - leftScore;
  })[0];
}

function messageTextFrom(value: Record<string, unknown>) {
  const direct = asString(value.text) || asString(value.message);
  if (direct) return direct;
  const content = value.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      const item = asObject(part);
      return item ? asString(item.text) || asString(item.content) : "";
    }).filter(Boolean).join("\n");
  }
  return "";
}

function transcriptMaxCharsForLimit(limit: number) {
  return Math.max(MIN_TRANSCRIPT_MAX_CHARS, Math.min(MAX_TRANSCRIPT_MAX_CHARS, Math.floor(limit) * 600));
}

function sessionUpdatedAtFrom(value: Record<string, unknown>) {
  const updatedAtMs = value.updatedAtMs;
  if (typeof updatedAtMs === "number" && Number.isFinite(updatedAtMs)) return updatedAtMs;
  const updatedAt = value.updatedAt;
  if (typeof updatedAt === "number" && Number.isFinite(updatedAt)) return updatedAt;
  if (typeof updatedAt === "string") {
    const parsed = Date.parse(updatedAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function approvalRequestMessageFromGatewayEvent(payload: unknown): Extract<DirectTransportMessage, { type: "eveng2.approval.request" }> | null {
  const root = asObject(payload);
  if (!root) return null;
  const request = asObject(root.request) || root;
  const id = asString(root.id) || asString(root.requestId) || asString(request.id) || asString(request.requestId);
  if (!id) return null;
  return {
    type: "eveng2.approval.request",
    id,
    requestId: id,
    command: asString(request.command) || asString(request.commandText) || asString(request.commandPreview),
    cwd: asString(request.cwd) || null,
    ask: asString(request.warningText) || asString(request.ask) || asString(request.summary) || null,
    security: asString(request.security) || null,
  };
}

export function approvalResolvedMessageFromGatewayEvent(payload: unknown): Extract<DirectTransportMessage, { type: "eveng2.approval.resolved" }> | null {
  const root = asObject(payload);
  if (!root) return null;
  const request = asObject(root.request) || root;
  const id = asString(root.id) || asString(root.requestId) || asString(request.id) || asString(request.requestId);
  if (!id) return null;
  return {
    type: "eveng2.approval.resolved",
    id,
    requestId: id,
    decision: asString(root.decision) || null,
  };
}

export class GatewayDirectTransport extends EventTarget {
  readonly CONNECTING = WebSocket.CONNECTING;
  readonly OPEN = WebSocket.OPEN;
  readonly CLOSING = WebSocket.CLOSING;
  readonly CLOSED = WebSocket.CLOSED;
  readyState: WebSocket["readyState"] = WebSocket.CONNECTING;

  private readonly setup: SetupCodePayload;
  private readonly instanceId: string;
  private readonly identityStore: BrowserDeviceIdentityStore;
  private readonly authStore: BrowserDeviceAuthStore;
  private nodeSession: GatewayWsSession | null = null;
  private operatorSession: GatewayWsSession | null = null;
  private voiceTransport: GatewayDirectVoiceTransport | null = null;
  private selectedSessionKey: string;
  private connectedDeviceId = "";
  private connectedNodeId = "";
  private nodeInvokeNodeIds = new Map<string, string>();
  private nodeSessionOpen = false;
  private operatorSessionOpen = false;
  private gatewayClientId: GatewayClientId = "openclaw-even-g2-node";
  private triedLegacyClientId = false;
  private nodeApprovalPollTimer: ReturnType<typeof setTimeout> | null = null;
  private nodeApprovalPending = false;

  constructor(private readonly options: DirectTransportOptions) {
    super();
    this.setup = parseSetupCode(options.setupCodeOrUrl);
    this.instanceId = options.instanceId || createGatewayRequestId("instance");
    this.selectedSessionKey = options.selectedSessionKey || "";
    const storage = options.storage || localStorage;
    this.identityStore = new BrowserDeviceIdentityStore(storage);
    this.authStore = new BrowserDeviceAuthStore(storage);
  }

  connect() {
    this.connectNode(this.gatewayClientId);
  }

  private connectNode(clientId: GatewayClientId) {
    const common = {
      url: this.setup.url,
      token: this.options.token,
      bootstrapToken: this.setup.bootstrapToken,
      identityStore: this.identityStore,
      authStore: this.authStore,
      WebSocketCtor: this.options.WebSocketCtor,
      userAgent: `OpenClawNode/${APP_VERSION} (Even G2)`,
    };
    const session = new GatewayWsSession({
      ...common,
      role: "node",
      scopes: [],
      caps: ["device", "talk", "canvas"],
      commands: ["device.status", "device.info", "device.health", "device.permissions", "talk.ptt.once", "canvas.present", "canvas.hide", "canvas.snapshot"],
      permissions: {},
      client: buildEvenG2ClientInfo("node", this.instanceId, clientId),
      onOpen: (_hello, identity) => {
        if (this.nodeSession !== session || this.readyState === WebSocket.CLOSED) {
          session.close();
          return;
        }
        this.connectedDeviceId = identity.deviceId;
        this.nodeSessionOpen = true;
        this.emit({
          type: "eveng2.runtime.status",
          session: this.selectedSessionKey,
          node: {
            deviceId: identity.deviceId,
            displayName: "Even G2",
            platform: "even-g2",
            deviceFamily: "glasses",
            modelIdentifier: "Even G2",
            nodeConnected: true,
            connected: true,
            foreground: { clientCount: 1 },
            openclaw: { nodeEnabled: true, commands: ["device.status", "device.info", "device.health", "device.permissions", "talk.ptt.once", "canvas.present", "canvas.hide", "canvas.snapshot"], lastError: null },
          },
        });
        this.connectOperator();
      },
      onEvent: (event, payload) => this.handleNodeEvent(event, payload),
      onError: (error) => {
        if (this.nodeSession !== session) return;
        this.handleNodeConnectError(error);
      },
      onClose: (event) => {
        if (this.nodeSession !== session) return;
        this.nodeSessionOpen = false;
        const reason = closeReasonFromEvent(event);
        if (reason) this.fail(new Error(reason));
        this.close(undefined, reason);
      },
    });
    this.nodeSession = session;
    void session.connect().catch((error: unknown) => this.fail(error instanceof Error ? error : new Error(String(error))));
  }

  close(_code?: number, reason = "") {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.nodeSessionOpen = false;
    this.operatorSessionOpen = false;
    this.clearNodeApprovalPoll();
    const voice = this.voiceTransport;
    const nodeSession = this.nodeSession;
    const operatorSession = this.operatorSession;
    this.voiceTransport = null;
    this.nodeSession = null;
    this.operatorSession = null;
    voice?.close();
    nodeSession?.close();
    operatorSession?.close();
    this.dispatchEvent(makeTransportCloseEvent(reason));
  }

  canSendNodeCommandResult() {
    return this.nodeSessionOpen && this.readyState !== WebSocket.CLOSED;
  }

  send(data: string) {
    let msg: DirectAppCommand;
    try {
      msg = JSON.parse(data) as DirectAppCommand;
    } catch {
      return;
    }
    void this.handleAppCommand(msg);
  }

  createVoiceTransport(config: DirectVoiceStartConfig) {
    const voice = new GatewayDirectVoiceTransport({
      gateway: this,
      config,
      getSessionKey: () => this.selectedSessionKey,
      request: async (method, params, timeoutMs) => {
        const session = this.openOperatorSession();
        if (!session) throw new Error("operator session is not connected");
        return session.request(method, params, timeoutMs);
      },
      onClose: () => {
        if (this.voiceTransport === voice) this.voiceTransport = null;
      },
    });
    this.voiceTransport = voice;
    return voice;
  }

  request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    const session = this.openOperatorSession();
    if (!session) return Promise.reject(new Error("operator session is not connected"));
    return session.request<T>(method, params, timeoutMs);
  }

  retryOperatorApproval() {
    if (this.readyState === WebSocket.CLOSED || !this.nodeSessionOpen || this.operatorSession) return false;
    this.connectOperator();
    return true;
  }

  private connectOperator() {
    this.operatorSessionOpen = false;
    if (this.readyState !== WebSocket.CLOSED) this.readyState = WebSocket.CONNECTING;
    const session = new GatewayWsSession({
      url: this.setup.url,
      token: this.options.token,
      bootstrapToken: this.setup.bootstrapToken,
      identityStore: this.identityStore,
      authStore: this.authStore,
      WebSocketCtor: this.options.WebSocketCtor,
      role: "operator",
      scopes: ["operator.approvals", "operator.read", "operator.talk.secrets", "operator.write"],
      caps: [],
      commands: [],
      permissions: {},
      client: buildEvenG2ClientInfo("ui", this.instanceId, this.gatewayClientId),
      userAgent: `OpenClawNode/${APP_VERSION} (Even G2)`,
      onOpen: (hello) => {
        if (this.operatorSession !== session || this.readyState === WebSocket.CLOSED) {
          session.close();
          return;
        }
        const snapshot = asObject(asObject(hello)?.snapshot);
        const defaults = asObject(snapshot?.sessionDefaults);
        const mainSessionKey = asString(defaults?.mainSessionKey);
        if (!this.selectedSessionKey) this.selectedSessionKey = mainSessionKey || FALLBACK_MAIN_SESSION_KEY;
        this.operatorSessionOpen = true;
        this.readyState = WebSocket.OPEN;
        this.dispatchEvent(new Event("open"));
        this.emit({ type: "ready", service: "openclaw-gateway-direct" });
        this.emit({ type: "eveng2.session.config.snapshot", sessionKey: this.selectedSessionKey });
        void session.request("sessions.subscribe", undefined, 5000).catch(() => undefined);
        this.scheduleNodeApprovalPoll(0);
      },
      onEvent: (event, payload) => {
        if (this.operatorSession !== session) return;
        this.handleOperatorEvent(event, payload);
      },
      onError: (error) => {
        if (this.operatorSession !== session) return;
        this.handleOperatorSessionError(error, session);
      },
      onClose: (event) => {
        if (this.operatorSession !== session) return;
        this.handleOperatorSessionClosed(event, session);
      },
    });
    this.operatorSession = session;
    void session.connect().catch((error: unknown) => {
      if (this.operatorSession !== session) return;
      this.handleOperatorSessionError(error instanceof Error ? error : new Error(String(error)), session);
    });
  }

  private openOperatorSession() {
    return this.operatorSessionOpen ? this.operatorSession : null;
  }

  private async handleAppCommand(msg: DirectAppCommand) {
    try {
      switch (msg.type) {
        case "eveng2.session.config.get":
          if (!this.openOperatorSession()) return;
          this.emit({ type: "eveng2.session.config.snapshot", sessionKey: this.selectedSessionKey });
          return;
        case "eveng2.session.list":
          if (!this.openOperatorSession()) return;
          await this.refreshSessions();
          return;
        case "eveng2.session.transcript.get":
          if (!this.openOperatorSession()) return;
          await this.refreshTranscript(msg.sessionKey || this.selectedSessionKey, msg.limit);
          return;
        case "eveng2.session.switch":
          if (!this.openOperatorSession()) return;
          if (msg.sessionKey) this.selectedSessionKey = msg.sessionKey;
          this.emit({ type: "eveng2.session.switch.applied", sessionKey: this.selectedSessionKey });
          await this.refreshTranscript(this.selectedSessionKey);
          return;
        case "eveng2.session.create":
          if (!this.openOperatorSession()) return;
          try {
            await this.createSession(msg.label);
          } catch (error) {
            this.emit({
              type: "eveng2.session.create.failed",
              error: error instanceof Error ? error.message : String(error),
            });
          }
          return;
        case "eveng2.session.send":
          if (!this.openOperatorSession()) return;
          await this.sendSessionMessage(msg);
          return;
        case "eveng2.node.command.result":
          if (!msg.id) {
            this.emit({ type: "error", error: "node command result is missing an id" });
            return;
          }
          {
            const nodeId = this.nodeInvokeNodeIds.get(msg.id) || "";
            this.nodeInvokeNodeIds.delete(msg.id);
            if (!nodeId) {
              this.emit({ type: "error", error: "node command result is missing node id context" });
              return;
            }
            this.nodeSession?.sendRequestFrame("node.invoke.result", {
              id: msg.id,
              nodeId,
              ok: msg.ok === true,
              ...(msg.ok === true ? { payload: msg.payload || {} } : { error: msg.error || { code: "UNAVAILABLE", message: "command failed" } }),
            });
          }
          return;
        case "eveng2.node.approval.refresh":
          if (!this.openOperatorSession()) return;
          await this.refreshNodeApprovalStatus();
          return;
        case "eveng2.approval.resolve":
          {
            const session = this.openOperatorSession();
            if (!session) return;
            await session.request("exec.approval.resolve", { id: msg.id || msg.requestId, decision: msg.decision });
          }
          this.emit({ type: "eveng2.approval.resolve.ack", id: msg.id, requestId: msg.requestId, decision: msg.decision, status: "accepted" });
          return;
      }
    } catch (error) {
      this.emit({ type: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async refreshSessions() {
    const payload = await this.openOperatorSession()?.request("sessions.list", {
      includeGlobal: true,
      includeUnknown: false,
      configuredAgentsOnly: true,
      includeDerivedTitles: true,
      includeLastMessage: true,
      limit: 50,
    });
    const root = asObject(payload);
    const rows = Array.isArray(root?.sessions) ? root.sessions : Array.isArray(root?.rows) ? root.rows : [];
    const sessions = rows.map((row) => asObject(row)).filter((row): row is Record<string, unknown> => Boolean(row)).map((row) => ({
      key: sessionKeyFrom(row),
      preview: asString(row.firstUserMessage)
        || asString(row.lastUserMessage)
        || asString(row.firstAgentMessage)
        || asString(row.firstAssistantMessage)
        || asString(row.lastAgentMessage)
        || asString(row.lastAssistantMessage)
        || asString(row.lastMessage)
        || asString(row.preview)
        || asString(row.title)
        || asString(row.displayName),
      label: asString(row.label) || asString(row.title),
      displayName: asString(row.displayName),
      groupChannel: asString(row.groupChannel),
      kind: asString(row.kind),
      firstUserMessage: asString(row.firstUserMessage) || asString(row.firstUserText),
      lastUserMessage: asString(row.lastUserMessage) || asString(row.lastUserText),
      firstAgentMessage: asString(row.firstAgentMessage) || asString(row.firstAssistantMessage) || asString(row.firstAssistantText),
      lastAgentMessage: asString(row.lastAgentMessage) || asString(row.lastAssistantMessage) || asString(row.lastAssistantText),
      lastMessage: asString(row.lastMessage),
      updatedAt: sessionUpdatedAtFrom(row),
    })).filter((session) => session.key);
    this.emit({ type: "eveng2.session.list.result", sessions });
  }

  private async refreshTranscript(sessionKey: string, limit = DEFAULT_TRANSCRIPT_RAW_LIMIT) {
    const safeLimit = Math.max(1, Math.floor(limit));
    try {
      const payload = await this.openOperatorSession()?.request("chat.history", { sessionKey, limit: safeLimit, maxChars: transcriptMaxCharsForLimit(safeLimit) });
      const root = asObject(payload);
      const messages = (Array.isArray(root?.messages) ? root.messages : []).map((message) => asObject(message)).filter((message): message is Record<string, unknown> => Boolean(message)).map((message) => ({
        id: asString(message.id) || asString(message.messageId),
        role: asString(message.role),
        text: messageTextFrom(message),
        timestamp: asString(message.timestamp) || asString(message.createdAt),
        provider: asString(message.provider),
        model: asString(message.model),
      }));
      this.emit({
        type: "eveng2.session.transcript.snapshot",
        sessionKey,
        sessionId: asString(root?.sessionId) || null,
        messages,
        rawLimit: safeLimit,
        rawCount: messages.length,
        hasFullHistory: messages.length < safeLimit,
      });
    } catch (error) {
      this.emit({
        type: "eveng2.session.transcript.snapshot",
        sessionKey,
        sessionId: null,
        messages: [],
        rawLimit: safeLimit,
        rawCount: 0,
        hasFullHistory: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async createSession(label = "Even G2") {
    const payload = await this.openOperatorSession()?.request("sessions.create", {
      parentSessionKey: this.selectedSessionKey,
      label,
    });
    const key = asString(asObject(payload)?.key) || asString(asObject(payload)?.sessionKey);
    if (key) this.selectedSessionKey = key;
    this.emit({ type: "eveng2.session.switch.applied", sessionKey: this.selectedSessionKey });
    await this.refreshSessions();
    await this.refreshTranscript(this.selectedSessionKey);
  }

  private async sendSessionMessage(msg: Extract<DirectAppCommand, { type: "eveng2.session.send" }>) {
    const sessionKey = msg.sessionKey || this.selectedSessionKey;
    const message = (msg.message || msg.text || "").trim();
    if (!message) {
      this.emit({ type: "error", error: "session message is empty" });
      return;
    }
    await this.openOperatorSession()?.request("chat.send", {
      sessionKey,
      message,
      ...(msg.idempotencyKey ? { idempotencyKey: msg.idempotencyKey } : {}),
    }, 30000);
    this.emit({ type: "eveng2.session.send.ack", sessionKey, message });
    await this.refreshTranscript(sessionKey);
  }

  private handleNodeEvent(event: string, payload: unknown) {
    if (event === "exec.approval.requested") {
      const message = approvalRequestMessageFromGatewayEvent(payload);
      if (message) this.emit(message);
      return;
    }
    if (event === "exec.approval.resolved") {
      const message = approvalResolvedMessageFromGatewayEvent(payload);
      if (message) this.emit(message);
      return;
    }
    if (event !== "node.invoke.request") return;
    const root = asObject(payload);
    if (!root) return;
    let parsedParams: Record<string, unknown> | null = null;
    if (typeof root.paramsJSON === "string") {
      try {
        parsedParams = asObject(JSON.parse(root.paramsJSON));
      } catch {
        parsedParams = null;
      }
    }
    const params = asObject(root.params) || parsedParams || {};
    const id = asString(root.id);
    const nodeId = asString(root.nodeId);
    if (id && nodeId) this.nodeInvokeNodeIds.set(id, nodeId);
    this.emit({
      type: "eveng2.node.command",
      id,
      nodeId,
      command: asString(root.command),
      params,
      timeoutMs: typeof root.timeoutMs === "number" ? root.timeoutMs : undefined,
    });
  }

  private handleOperatorEvent(event: string, payload: unknown) {
    const root = asObject(payload);
    if (event === "sessions.changed") {
      void this.refreshSessions();
      return;
    }
    if (event === "session.message" && root) {
      const sessionKey = asString(root.sessionKey);
      if (!sessionKey || sessionKey === this.selectedSessionKey) void this.refreshTranscript(this.selectedSessionKey);
      return;
    }
    if (event === "chat" && root) {
      const state = asString(root.state);
      if (state === "final" || state === "aborted" || state === "error") {
        void this.refreshTranscript(this.selectedSessionKey);
      }
      return;
    }
    if (event === "exec.approval.requested") {
      const message = approvalRequestMessageFromGatewayEvent(payload);
      if (message) this.emit(message);
      return;
    }
    if (event === "exec.approval.resolved") {
      const message = approvalResolvedMessageFromGatewayEvent(payload);
      if (message) this.emit(message);
      return;
    }
    if (event === "talk.event") {
      this.voiceTransport?.handleTalkEvent(payload);
      return;
    }
    if (event === "node.pair.requested" || event === "node.pair.resolved") {
      void this.refreshNodeApprovalStatus();
    }
  }

  private async refreshNodeApprovalStatus() {
    const session = this.openOperatorSession();
    if (!session) return;
    try {
      const payload = await session.request("node.list", {}, 5000);
      const nodes = nodeCatalogRows(payload);
      const candidates = nodes.filter((node) => looksLikeEvenG2Node(node));
      const allSourcePendingCandidates = nodes.filter((node) => isPendingCatalogSource(node));
      const runtimeCandidates = candidates.filter((node) => !isPendingCatalogSource(node));
      const current = this.nodeForCurrentDevice(runtimeCandidates);
      const sourcePendingCandidates = current
        ? allSourcePendingCandidates.filter((node) => sourcePendingRowCanMatchCurrent(current, node))
        : allSourcePendingCandidates.filter((node) => looksLikeEvenG2Node(node));
      const pendingCandidates = [...sourcePendingCandidates, ...runtimeCandidates.filter((node) => isPendingNodeApproval(node))];
      let pending = this.nodeForCurrentDevice(pendingCandidates);
      const matchingSourcePending = current
        ? sourcePendingCandidates.find((node) => pendingCatalogRowMatchesCurrent(current, node, runtimeCandidates, sourcePendingCandidates))
        : undefined;
      if (matchingSourcePending) pending = matchingSourcePending;
      const pendingMatchCandidates = pending && isPendingCatalogSource(pending) ? sourcePendingCandidates : pendingCandidates;
      if (current && pending && !pendingCatalogRowMatchesCurrent(current, pending, runtimeCandidates, pendingMatchCandidates)) {
        pending = undefined;
      }
      if (current) {
        this.rememberCatalogNode(current);
        const node = suppressReadyApprovalStateWhilePending(
          evenG2NodeSnapshotFromCatalogRow(current, this.connectedDeviceId),
          pending,
        );
        this.emit({
          type: "eveng2.runtime.status",
          session: this.selectedSessionKey,
          node,
        });
      }
      if (!pending) {
        if (this.nodeApprovalPending) this.emit({ type: "eveng2.node.approval.ready" });
        this.nodeApprovalPending = false;
        return;
      }
      this.nodeApprovalPending = true;
      this.emit({
        type: "eveng2.node.approval.required",
        nodeId: asString(pending.nodeId) || (current ? asString(current.nodeId) : ""),
        approvalState: asString(pending.approvalState),
        commands: asStringArray(pending.pendingDeclaredCommands).length
          ? asStringArray(pending.pendingDeclaredCommands)
          : asStringArray(pending.commands),
      });
    } catch {
      // Bounded operator tokens or older Gateways may not expose node catalog
      // reads. Connection and voice can still work, so keep this diagnostic-only.
    } finally {
      if (this.readyState !== WebSocket.CLOSED && this.openOperatorSession()) {
        this.scheduleNodeApprovalPoll(this.nodeApprovalPending ? 2500 : 15000);
      }
    }
  }

  private scheduleNodeApprovalPoll(delayMs: number) {
    this.clearNodeApprovalPoll();
    this.nodeApprovalPollTimer = setTimeout(() => {
      this.nodeApprovalPollTimer = null;
      void this.refreshNodeApprovalStatus();
    }, Math.max(0, delayMs));
  }

  private clearNodeApprovalPoll() {
    if (this.nodeApprovalPollTimer !== null) {
      clearTimeout(this.nodeApprovalPollTimer);
      this.nodeApprovalPollTimer = null;
    }
  }

  private fail(error: Error) {
    const gatewayError = gatewayErrorFromConnectError(error);
    const requestId = requestIdFromGatewayError(gatewayError);
    this.emit({
      type: "error",
      error: error.message,
      ...(requestId ? { requestId } : {}),
      ...(gatewayErrorRequestsReconnectPause(gatewayError) ? { pauseReconnect: true } : {}),
    });
  }

  private handleOperatorSessionError(error: Error, session: GatewayWsSession) {
    if (this.operatorSession !== session) return;
    if (this.nodeSessionOpen) {
      const gatewayError = gatewayErrorFromConnectError(error);
      const requestId = requestIdFromGatewayError(gatewayError);
      const pauseReconnect = gatewayErrorRequestsReconnectPause(gatewayError) || shouldPauseOperatorReconnect(error.message);
      if (this.readyState !== WebSocket.CLOSED) this.readyState = WebSocket.CONNECTING;
      this.operatorSessionOpen = false;
      this.operatorSession = null;
      session.close();
      this.emit({
        type: "error",
        error: error.message,
        ...(requestId ? { requestId } : {}),
        ...(pauseReconnect ? { pauseReconnect: true } : {}),
      });
      if (!pauseReconnect) this.close(undefined, error.message || "operator session failed");
      return;
    }
    this.fail(error);
  }

  private handleOperatorSessionClosed(event: CloseEvent | undefined, session: GatewayWsSession) {
    if (this.operatorSession !== session) return;
    const reason = closeReasonFromEvent(event);
    if (this.nodeSessionOpen) {
      if (this.readyState !== WebSocket.CLOSED) this.readyState = WebSocket.CONNECTING;
      this.operatorSessionOpen = false;
      this.operatorSession = null;
      const pauseReconnect = shouldPauseOperatorReconnect(reason);
      if (reason) {
        this.emit({
          type: "error",
          error: reason,
          ...(pauseReconnect ? { pauseReconnect: true } : {}),
        });
      }
      if (!pauseReconnect) this.close(undefined, reason || "operator session closed");
      return;
    }
    if (reason) this.fail(new Error(reason));
    this.close(undefined, reason);
  }

  private nodeForCurrentDevice(nodes: Record<string, unknown>[]) {
    if (this.connectedNodeId) {
      const byNodeId = preferredCatalogNode(nodes.filter((node) => asString(node.nodeId) === this.connectedNodeId));
      if (byNodeId) return byNodeId;
    }
    if (this.connectedDeviceId) {
      const byDeviceId = preferredCatalogNode(nodes.filter((node) => nodeDeviceId(node) === this.connectedDeviceId));
      if (byDeviceId) return byDeviceId;
      const rowsWithDeviceId = nodes.filter((node) => nodeDeviceId(node));
      if (!this.connectedNodeId && rowsWithDeviceId.length === 0 && nodes.length === 1) return preferredCatalogNode(nodes);
      const nodeIds = uniqueStrings(nodes.map((node) => asString(node.nodeId)));
      if (!this.connectedNodeId && rowsWithDeviceId.length === 0 && nodeIds.length === 1) return preferredCatalogNode(nodes);
    }
    if (this.connectedNodeId || this.connectedDeviceId) return undefined;
    return preferredCatalogNode(nodes);
  }

  private rememberCatalogNode(node: Record<string, unknown>) {
    const nodeId = asString(node.nodeId);
    if (nodeId) this.connectedNodeId = nodeId;
    const deviceId = nodeDeviceId(node);
    if (deviceId) this.connectedDeviceId = deviceId;
  }

  private handleNodeConnectError(error: Error) {
    if (this.shouldRetryWithLegacyClientId(error)) {
      this.triedLegacyClientId = true;
      this.gatewayClientId = "node-host";
      const previousSession = this.nodeSession;
      this.nodeSession = null;
      this.nodeSessionOpen = false;
      previousSession?.close();
      this.connectNode("node-host");
      return;
    }
    this.fail(error);
  }

  private shouldRetryWithLegacyClientId(error: Error) {
    if (this.gatewayClientId !== "openclaw-even-g2-node" || this.triedLegacyClientId || this.nodeSessionOpen) return false;
    const gatewayError = gatewayErrorFromConnectError(error);
    const haystack = [
      error.message,
      gatewayError?.code,
      gatewayError?.details?.code,
      gatewayError?.details?.reason,
    ].filter(Boolean).join(" ").toLowerCase();
    return (
      haystack.includes("client") ||
      haystack.includes("schema") ||
      haystack.includes("validation") ||
      haystack.includes("unknown") ||
      haystack.includes("enum")
    );
  }

  private emit(message: DirectTransportMessage) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
  }
}

type GatewayDirectVoiceTransportOptions = {
  gateway: GatewayDirectTransport;
  config: DirectVoiceStartConfig;
  getSessionKey(): string;
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  onClose(): void;
};

type TalkTranscriptSegment = {
  key?: string;
  text: string;
};

export class GatewayDirectVoiceTransport extends EventTarget {
  readonly CONNECTING = WebSocket.CONNECTING;
  readonly OPEN = WebSocket.OPEN;
  readonly CLOSING = WebSocket.CLOSING;
  readonly CLOSED = WebSocket.CLOSED;
  readyState: WebSocket["readyState"] = WebSocket.CONNECTING;
  private closed = false;
  private readonly chunks: Uint8Array[] = [];
  private audioAppendQueue: Promise<void> = Promise.resolve();
  private talkSessionId = "";
  private talkInputEncoding = "";
  private talkInputSampleRateHz = 0;
  private talkPartialText = "";
  private readonly talkFinalSegments: TalkTranscriptSegment[] = [];
  private talkLastTranscriptEventAtMs = 0;
  private talkCloseRequestedAtMs = 0;
  private talkSessionCloseRequested = false;
  private talkReady = false;
  private talkReadyResolve: (() => void) | null = null;
  private talkReadyReject: ((error: Error) => void) | null = null;

  constructor(private readonly options: GatewayDirectVoiceTransportOptions) {
    super();
  }

  async open() {
    try {
      assertVoiceAudioFormat(this.options.config);
      if (this.usesTalkRelay()) {
        await this.openTalkRelay();
        return;
      }
      this.readyState = WebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
      this.emit({ type: "transcription.started", transport: "openclaw-audio" });
    } catch (error) {
      this.fail(error);
    }
  }

  send(data: string | ArrayBuffer | ArrayBufferView | Blob) {
    if (typeof data === "string") {
      this.handleControl(data);
      return;
    }
    if (data instanceof Blob) {
      void data.arrayBuffer().then((buffer) => this.appendAudio(new Uint8Array(buffer))).catch((error: unknown) => this.fail(error));
      return;
    }
    const bytes = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    void this.appendAudio(bytes);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = WebSocket.CLOSED;
    this.resolveTalkReady();
    this.closeTalkSessionBestEffort();
    this.options.onClose();
    this.dispatchEvent(new Event("close"));
  }

  handleTalkEvent(payload: unknown) {
    if (!this.usesTalkRelay() || this.closed) return;
    const root = asObject(payload);
    if (!root) return;
    const payloadObject = asObject(root.payload);
    const dataObject = asObject(root.data);
    const eventObject = asObject(root.event);
    const candidates = [payloadObject, dataObject, eventObject, root].filter((item): item is Record<string, unknown> => Boolean(item));
    const eventTypeRaw = candidates
      .map((item) => asString(item.type) || asString(item.event) || asString(item.kind) || asString(item.name))
      .find((value) => Boolean(value && !["talk.event", "event"].includes(value.toLowerCase())))
      || candidates.map((item) => asString(item.type) || asString(item.event) || asString(item.kind) || asString(item.name)).find(Boolean);
    const eventType = eventTypeRaw?.toLowerCase() || "";
    const eventSessionId = candidates
      .map((item) => asString(item.transcriptionSessionId)
        || asString(item.transcription_session_id)
        || asString(item.relaySessionId)
        || asString(item.sessionId)
        || asString(item.session_id)
        || asString(item.id))
      .find(Boolean) || "";
    if (this.talkSessionId && eventSessionId && eventSessionId !== this.talkSessionId) return;
    if (eventType === "ready" || eventType.includes("session.ready")) {
      this.talkReady = true;
      this.resolveTalkReady();
      return;
    }
    if (eventType.includes("error")) {
      const message = candidates
        .map((item) => asString(item.message) || asString(item.error) || asString(item.reason))
        .find(Boolean) || "OpenClaw Talk transcription failed";
      if (this.talkReadyReject) {
        this.rejectTalkReady(new Error(message));
        return;
      }
      this.fail(new Error(message));
      return;
    }
    const text = talkTranscriptText(candidates).trim();
    if (!text) return;
    const isFinal = eventType.includes("done")
      || eventType.includes("final")
      || candidates.some((item) => item.final === true || item.isFinal === true);
    this.talkLastTranscriptEventAtMs = Date.now();
    if (isFinal) {
      this.talkPartialText = "";
      this.addTalkFinalSegment(text, talkTranscriptSegmentKey(candidates));
      this.emit({
        type: "transcript.partial",
        text: this.combinedTalkTranscript(),
        sessionKey: this.options.config.sessionKey || this.options.getSessionKey(),
        targetSessionKey: this.options.config.targetSessionKey,
        idempotencyKey: this.options.config.idempotencyKey,
      });
      return;
    }
    this.talkPartialText = text;
    this.emit({
      type: "transcript.partial",
      text: this.combinedTalkTranscript({ includePartial: true }),
      sessionKey: this.options.config.sessionKey || this.options.getSessionKey(),
      targetSessionKey: this.options.config.targetSessionKey,
      idempotencyKey: this.options.config.idempotencyKey,
    });
  }

  private handleControl(data: string) {
    let payload: { type?: string };
    try {
      payload = JSON.parse(data) as { type?: string };
    } catch {
      return;
    }
    if (payload.type === "utterance.finalize") void this.finalize();
  }

  private appendAudio(bytes: Uint8Array) {
    if (this.closed || this.readyState !== WebSocket.OPEN || !bytes.byteLength) return;
    try {
      const normalized = normalizeVoiceAudioForGateway(bytes, this.options.config);
      if (this.usesTalkRelay()) {
        this.queueTalkAudio(normalized);
        return;
      }
      this.chunks.push(normalized);
    } catch (error) {
      this.fail(error);
    }
  }

  private async finalize() {
    if (this.closed) return;
    if (this.usesTalkRelay()) {
      await this.finalizeTalkRelay();
      return;
    }
    try {
      const pcm = concatBytes(this.chunks.splice(0));
      const sessionKey = this.options.config.sessionKey || this.options.getSessionKey();
      const idempotencyKey = this.options.config.idempotencyKey || createGatewayRequestId("voice");
      const preprocessed = preprocessPcm16Mono(pcm, {
        sampleRateHz: this.options.config.format?.sampleRateHz || 16000,
      });
      if (!preprocessed.ok) {
        this.emit({
          type: "transcription.failed",
          code: preprocessed.reason === "too-short" ? "VOICE_TOO_SHORT" : "NO_SPEECH",
          error: preprocessed.reason === "too-short" ? "Recording was too short" : "No speech detected",
        });
        this.close();
        return;
      }
      const wav = pcm16ToWav({
        pcm: preprocessed.pcm,
        sampleRateHz: this.options.config.format?.sampleRateHz || 16000,
        channels: this.options.config.format?.channels || 1,
      });
      await this.options.request("chat.send", {
        sessionKey,
        message: "",
        attachments: [{
          type: "audio",
          mimeType: "audio/wav",
          fileName: "even-g2-voice.wav",
          content: bytesToBase64(wav),
        }],
        idempotencyKey,
      });
      this.emit({ type: "session.voice.sent", sessionKey, idempotencyKey });
      this.close();
    } catch (error) {
      this.fail(error);
    }
  }

  private usesTalkRelay() {
    return this.options.config.transcriptionMode === "talk-relay";
  }

  private async openTalkRelay() {
    const sessionKey = this.options.config.sessionKey || this.options.getSessionKey();
    const payload = await this.options.request("talk.session.create", {
      sessionKey,
      mode: "transcription",
      transport: "gateway-relay",
      brain: "none",
      ...(this.options.config.transcriptionProvider ? { provider: this.options.config.transcriptionProvider } : {}),
    }, 15000);
    const sessionId = talkSessionIdFrom(payload);
    if (!sessionId) throw new Error("OpenClaw Talk did not return a transcription session id");
    const audioConfig = talkAudioConfigFrom(payload);
    this.talkSessionId = sessionId;
    if (this.closed) {
      this.closeTalkSessionBestEffort();
      return;
    }
    this.talkInputEncoding = audioConfig.inputEncoding;
    this.talkInputSampleRateHz = audioConfig.inputSampleRateHz;
    await this.waitForTalkReady();
    if (this.closed) {
      this.closeTalkSessionBestEffort();
      return;
    }
    this.readyState = WebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
    this.emit({
      type: "transcription.started",
      transport: "openclaw-talk-relay",
      sessionKey,
      targetSessionKey: this.options.config.targetSessionKey,
      idempotencyKey: this.options.config.idempotencyKey,
    });
  }

  private queueTalkAudio(bytes: Uint8Array) {
    const sessionId = this.talkSessionId;
    if (!sessionId) return;
    const audio = audioBytesForTalkRelay(bytes, {
      sourceSampleRateHz: this.options.config.format?.sampleRateHz || 16000,
      inputEncoding: this.talkInputEncoding,
      inputSampleRateHz: this.talkInputSampleRateHz,
    });
    this.audioAppendQueue = this.audioAppendQueue
      .catch(() => undefined)
      .then(async () => {
        if (this.closed) return;
        await this.options.request("talk.session.appendAudio", {
          sessionId,
          audioBase64: bytesToBase64(audio),
          timestamp: Date.now(),
        }, 15000);
      })
      .catch((error: unknown) => {
        if (this.closed) return;
        this.fail(error);
      });
  }

  private async finalizeTalkRelay() {
    const sessionKey = this.options.config.sessionKey || this.options.getSessionKey();
    const idempotencyKey = this.options.config.idempotencyKey || createGatewayRequestId("voice");
    try {
      this.emitVoiceProcessing("draft", sessionKey, idempotencyKey);
      this.queueTalkAudio(pcm16SilenceBytes({
        durationMs: TALK_RELAY_FINAL_SILENCE_MS,
        sampleRateHz: this.options.config.format?.sampleRateHz || 16000,
      }));
      await this.audioAppendQueue.catch(() => undefined);
      if (this.closed) return;
      this.talkSessionCloseRequested = true;
      this.talkCloseRequestedAtMs = Date.now();
      await this.options.request("talk.session.close", {
        sessionId: this.talkSessionId,
      }, 15000);
      const text = await this.waitForTalkFinalText();
      if (!text) {
        this.emit({
          type: "transcription.failed",
          code: "NO_SPEECH",
          error: "No speech detected",
        });
        this.close();
        return;
      }
      if (!this.options.config.targetSessionKey) {
        this.emit({
          type: "transcript.final",
          text,
          sessionKey,
          idempotencyKey,
        });
        this.close();
        return;
      }
      this.emit({
        type: "voice.draft.ready",
        text,
        sessionKey,
        targetSessionKey: this.options.config.targetSessionKey,
        idempotencyKey,
      });
      this.close();
    } catch (error) {
      this.fail(error);
    }
  }

  private closeTalkSessionBestEffort() {
    const sessionId = this.talkSessionId;
    if (!this.usesTalkRelay() || !sessionId || this.talkSessionCloseRequested) return;
    this.talkSessionCloseRequested = true;
    void this.audioAppendQueue
      .catch(() => undefined)
      .then(() => this.options.request("talk.session.cancelTurn", {
        sessionId,
        reason: "client-cancelled",
      }, 5000))
      .catch(() => undefined);
  }

  private async waitForTalkFinalText() {
    const deadline = Date.now() + Math.max(2500, this.options.config.draftTimeoutMs || 8000);
    const closeDrainUntil = Date.now() + TALK_RELAY_CLOSE_DRAIN_MS;
    while (Date.now() < deadline && !this.closed) {
      const text = this.combinedTalkTranscript({ includePartial: true }).trim();
      const hasFinalText = this.talkFinalSegments.some((segment) => segment.text.trim());
      const hasPartialText = Boolean(this.talkPartialText.trim());
      const quietForMs = Date.now() - this.talkLastTranscriptEventAtMs;
      if (
        text
        && hasFinalText
        && !hasPartialText
        && Date.now() >= closeDrainUntil
        && (!this.talkLastTranscriptEventAtMs || quietForMs >= TALK_RELAY_FINAL_QUIET_MS)
      ) {
        return text;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return this.combinedTalkTranscript({ includePartial: true }).trim();
  }

  private addTalkFinalSegment(text: string, key = "") {
    const normalized = text.trim();
    if (!normalized) return;
    if (key) {
      const existing = this.talkFinalSegments.find((segment) => segment.key === key);
      if (existing) {
        existing.text = normalized;
        return;
      }
      this.talkFinalSegments.push({ key, text: normalized });
      return;
    }
    this.talkFinalSegments.push({ text: normalized });
  }

  private combinedTalkTranscript(options: { includePartial?: boolean } = {}) {
    const finalized = this.talkFinalSegments
      .map((segment) => segment.text.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    if (!options.includePartial) return finalized;
    const partial = this.talkPartialText.trim();
    if (!partial) return finalized;
    if (!finalized) return partial;
    return `${finalized} ${partial}`;
  }

  private waitForTalkReady() {
    if (this.talkReady) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.talkReadyResolve = null;
        this.talkReadyReject = null;
        reject(new Error("OpenClaw Talk transcription provider did not become ready"));
      }, 10000);
      this.talkReadyResolve = () => {
        clearTimeout(timeout);
        this.talkReadyResolve = null;
        this.talkReadyReject = null;
        resolve();
      };
      this.talkReadyReject = (error) => {
        clearTimeout(timeout);
        this.talkReadyResolve = null;
        this.talkReadyReject = null;
        reject(error);
      };
    });
  }

  private resolveTalkReady() {
    const resolve = this.talkReadyResolve;
    if (!resolve) return;
    resolve();
  }

  private rejectTalkReady(error: Error) {
    const reject = this.talkReadyReject;
    if (!reject) return;
    reject(error);
  }

  private fail(error: unknown) {
    if (this.closed) return;
    const errorText = error instanceof Error ? error.message : String(error);
    this.emit({
      type: "transcription.failed",
      code: "TRANSCRIPTION_FAILED",
      error: errorText,
    });
    this.close();
  }

  private emit(payload: Record<string, unknown>) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(payload) }));
  }

  private emitVoiceProcessing(phase: "preprocess" | "upload" | "draft", sessionKey: string, idempotencyKey: string) {
    this.emit({
      type: "voice.processing",
      phase,
      sessionKey,
      targetSessionKey: this.options.config.targetSessionKey,
      idempotencyKey,
    });
  }
}

function assertVoiceAudioFormat(config: DirectVoiceStartConfig) {
  const encoding = config.format?.encoding || "";
  const sampleRateHz = config.format?.sampleRateHz || 0;
  const channels = config.format?.channels || 1;
  if (encoding === "pcm_s16le" && (sampleRateHz === 16000 || sampleRateHz === 8000) && channels === 1) return;
  throw new Error(`Gateway direct voice expects PCM16 mono audio; got ${encoding || "unknown"}/${sampleRateHz || "unknown"}`);
}

function normalizeVoiceAudioForGateway(bytes: Uint8Array, config: DirectVoiceStartConfig) {
  assertVoiceAudioFormat(config);
  if (bytes.byteLength % 2 === 0) return bytes;
  return bytes.slice(0, bytes.byteLength - 1);
}

function talkSessionIdFrom(payload: unknown) {
  const root = asObject(payload);
  if (!root) return "";
  const direct = asString(root.sessionId) || asString(root.id);
  if (direct) return direct;
  const session = asObject(root.session);
  return session ? asString(session.sessionId) || asString(session.id) : "";
}

function talkAudioConfigFrom(payload: unknown) {
  const root = asObject(payload);
  const audio = root ? asObject(root.audio) : null;
  const inputEncoding = (asString(audio?.inputEncoding) || asString(audio?.encoding) || "pcm16").toLowerCase();
  const inputSampleRateHz = numberFrom(audio?.inputSampleRateHz) || numberFrom(audio?.sampleRateHz) || 16000;
  return { inputEncoding, inputSampleRateHz };
}

function numberFrom(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function talkTranscriptText(candidates: Record<string, unknown>[]) {
  for (const candidate of candidates) {
    const direct = asString(candidate.text)
      || asString(candidate.transcript)
      || asString(candidate.delta)
      || asString(candidate.content)
      || asString(candidate.message);
    if (direct) return direct;
    const transcript = asObject(candidate.transcript);
    if (transcript) {
      const nested = asString(transcript.text) || asString(transcript.value) || asString(transcript.content);
      if (nested) return nested;
    }
    const delta = asObject(candidate.delta);
    if (delta) {
      const nested = asString(delta.text) || asString(delta.value) || asString(delta.content);
      if (nested) return nested;
    }
  }
  return "";
}

function talkTranscriptSegmentKey(candidates: Record<string, unknown>[]) {
  for (const candidate of candidates) {
    const direct = asString(candidate.turnId)
      || asString(candidate.turn_id)
      || asString(candidate.segmentId)
      || asString(candidate.segment_id)
      || asString(candidate.itemId)
      || asString(candidate.item_id);
    if (direct) return direct;
    const turn = asObject(candidate.turn);
    const turnId = turn ? asString(turn.id) || asString(turn.turnId) || asString(turn.turn_id) : "";
    if (turnId) return turnId;
    const segment = asObject(candidate.segment);
    const segmentId = segment ? asString(segment.id) || asString(segment.segmentId) || asString(segment.segment_id) : "";
    if (segmentId) return segmentId;
    const transcript = asObject(candidate.transcript);
    const transcriptId = transcript
      ? asString(transcript.id)
        || asString(transcript.transcriptId)
        || asString(transcript.transcript_id)
        || asString(transcript.segmentId)
        || asString(transcript.segment_id)
        || asString(transcript.itemId)
        || asString(transcript.item_id)
      : "";
    if (transcriptId) return transcriptId;
  }
  return "";
}

function audioBytesForTalkRelay(bytes: Uint8Array, config: {
  sourceSampleRateHz: number;
  inputEncoding: string;
  inputSampleRateHz: number;
}) {
  const inputEncoding = config.inputEncoding.replace(/[-_]/g, "").toLowerCase();
  const targetSampleRateHz = config.inputSampleRateHz || config.sourceSampleRateHz;
  if (inputEncoding === "g711ulaw" || inputEncoding === "ulaw" || inputEncoding === "mulaw") {
    return pcm16ToMuLaw(resamplePcm16(bytes, config.sourceSampleRateHz, targetSampleRateHz));
  }
  if (inputEncoding === "pcm16" || inputEncoding === "pcms16le" || inputEncoding === "pcm") {
    return resamplePcm16(bytes, config.sourceSampleRateHz, targetSampleRateHz);
  }
  throw new Error(`Unsupported OpenClaw Talk input encoding: ${config.inputEncoding || "unknown"}`);
}

function resamplePcm16(bytes: Uint8Array, sourceSampleRateHz: number, targetSampleRateHz: number) {
  if (sourceSampleRateHz === targetSampleRateHz) return bytes;
  const inputSamples = Math.floor(bytes.byteLength / 2);
  if (!inputSamples || sourceSampleRateHz <= 0 || targetSampleRateHz <= 0) return new Uint8Array();
  const outputSamples = Math.max(1, Math.floor(inputSamples * targetSampleRateHz / sourceSampleRateHz));
  const input = new DataView(bytes.buffer, bytes.byteOffset, inputSamples * 2);
  const out = new Uint8Array(outputSamples * 2);
  const output = new DataView(out.buffer);
  for (let index = 0; index < outputSamples; index += 1) {
    const sourceIndex = Math.min(inputSamples - 1, Math.floor(index * sourceSampleRateHz / targetSampleRateHz));
    output.setInt16(index * 2, input.getInt16(sourceIndex * 2, true), true);
  }
  return out;
}

function pcm16ToMuLaw(bytes: Uint8Array) {
  const samples = Math.floor(bytes.byteLength / 2);
  const input = new DataView(bytes.buffer, bytes.byteOffset, samples * 2);
  const out = new Uint8Array(samples);
  for (let index = 0; index < samples; index += 1) {
    out[index] = linearPcm16ToMuLaw(input.getInt16(index * 2, true));
  }
  return out;
}

function pcm16SilenceBytes(params: { durationMs: number; sampleRateHz: number }) {
  const samples = Math.max(0, Math.ceil(params.sampleRateHz * params.durationMs / 1000));
  return new Uint8Array(samples * 2);
}

function linearPcm16ToMuLaw(sample: number) {
  const bias = 0x84;
  const clip = 32635;
  let value = sample;
  let sign = 0;
  if (value < 0) {
    value = -value;
    sign = 0x80;
  }
  value = Math.min(value, clip) + bias;
  let exponent = 7;
  for (let mask = 0x4000; exponent > 0 && (value & mask) === 0; mask >>= 1) exponent -= 1;
  const mantissa = (value >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

function concatBytes(chunks: Uint8Array[]) {
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function pcm16ToWav({ pcm, sampleRateHz, channels }: { pcm: Uint8Array; sampleRateHz: number; channels: number }) {
  const dataSize = pcm.byteLength;
  const headerSize = 44;
  const out = new Uint8Array(headerSize + dataSize);
  const view = new DataView(out.buffer);
  writeAscii(out, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(out, 8, "WAVE");
  writeAscii(out, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(out, 36, "data");
  view.setUint32(40, dataSize, true);
  out.set(pcm, headerSize);
  return out;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}
