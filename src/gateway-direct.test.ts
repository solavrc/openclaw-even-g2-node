import { afterEach, describe, expect, it, vi } from "vitest";
import {
  approvalRequestMessageFromGatewayEvent,
  approvalResolvedMessageFromGatewayEvent,
  BrowserDeviceAuthStore,
  buildConnectParams,
  buildDeviceAuthPayloadV3,
  buildEvenG2ClientInfo,
  clearBrowserDeviceCredentials,
  createGatewayRequestId,
  GatewayConnectError,
  GatewayDirectTransport,
  GatewayDirectVoiceTransport,
  gatewayRpcRequestEnvelope,
  gatewayRpcRequestText,
  type GatewayWebSocketConstructor,
  GatewayWsSession,
  parseSetupCode,
  type DeviceIdentity,
} from "./gateway-direct";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

class FakeGatewayWebSocket extends EventTarget {
  static instances: FakeGatewayWebSocket[] = [];
  readonly CONNECTING = WebSocket.CONNECTING;
  readonly OPEN = WebSocket.OPEN;
  readonly CLOSING = WebSocket.CLOSING;
  readonly CLOSED = WebSocket.CLOSED;
  readyState: WebSocket["readyState"] = WebSocket.OPEN;
  sent: string[] = [];

  constructor(readonly url: string) {
    super();
    FakeGatewayWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close"));
  }

  receive(payload: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(payload) }));
  }
}

const FakeGatewayWebSocketCtor: GatewayWebSocketConstructor = FakeGatewayWebSocket;

function pcmToneBytes(durationMs = 1200, sampleRateHz = 16000, amplitude = 0.22) {
  const sampleCount = Math.floor(sampleRateHz * durationMs / 1000);
  const bytes = new Uint8Array(sampleCount * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < sampleCount; index += 1) {
    view.setInt16(index * 2, Math.round(Math.sin(index / 7) * amplitude * 32767), true);
  }
  return bytes;
}

const identity: DeviceIdentity = {
  deviceId: "device-1",
  publicKeyRawBase64Url: "pub",
  privateKeyRawBase64Url: "priv",
  createdAtMs: 1,
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  FakeGatewayWebSocket.instances = [];
});

function encodeSetupCode(payload: unknown) {
  const raw = JSON.stringify(payload);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function lastConnectParams(ws: FakeGatewayWebSocket) {
  let raw: string | undefined;
  for (let index = ws.sent.length - 1; index >= 0; index -= 1) {
    const item = ws.sent[index];
    if (item?.includes("\"method\":\"connect\"")) {
      raw = item;
      break;
    }
  }
  if (!raw) throw new Error("No connect frame was sent.");
  return JSON.parse(raw) as { params?: { auth?: unknown; client?: { id?: string }; device?: { signature?: string } } };
}

function setOpenOperatorSession(gateway: GatewayDirectTransport, session: unknown) {
  Reflect.set(gateway, "operatorSession", session);
  Reflect.set(gateway, "operatorSessionOpen", true);
}

describe("Gateway direct setup", () => {
  it("builds JSON-RPC request frames with params only when present", () => {
    expect(gatewayRpcRequestEnvelope("req-1", "node.list", { active: true })).toEqual({
      type: "req",
      id: "req-1",
      method: "node.list",
      params: { active: true },
    });
    expect(gatewayRpcRequestEnvelope("req-2", "session.list")).toEqual({
      type: "req",
      id: "req-2",
      method: "session.list",
    });
    expect(gatewayRpcRequestEnvelope("req-3", "session.list", null)).toEqual({
      type: "req",
      id: "req-3",
      method: "session.list",
    });
  });

  it("serializes JSON-RPC request frames consistently", () => {
    expect(gatewayRpcRequestText("req-1", "node.list", { active: true })).toBe(
      "{\"type\":\"req\",\"id\":\"req-1\",\"method\":\"node.list\",\"params\":{\"active\":true}}",
    );
  });

  it("creates request IDs when crypto.randomUUID is unavailable", () => {
    const getRandomValues: Crypto["getRandomValues"] = (bytes) => {
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).fill(0x11);
      return bytes;
    };
    const cryptoWithoutRandomUuid = {
      getRandomValues,
    };
    expect(createGatewayRequestId("req", cryptoWithoutRandomUuid)).toBe("11111111-1111-4111-9111-111111111111");
  });

  it("parses OpenClaw setup codes", () => {
    expect(parseSetupCode(encodeSetupCode({
      url: "wss://gateway.example.test",
      bootstrapToken: "bootstrap",
    }))).toEqual({
      url: "wss://gateway.example.test",
      bootstrapToken: "bootstrap",
    });
  });

  it("accepts a raw websocket URL for manual setup", () => {
    expect(parseSetupCode("ws://127.0.0.1:18789")).toEqual({ url: "ws://127.0.0.1:18789" });
  });

  it("builds the same v3 signature payload shape as OpenClaw native clients", () => {
    expect(buildDeviceAuthPayloadV3({
      deviceId: "dev-1",
      clientId: "openclaw-even-g2-node",
      clientMode: "node",
      role: "node",
      scopes: [],
      signedAtMs: 1700000000000,
      token: "tok",
      nonce: "nonce",
      platform: "Even-G2",
      deviceFamily: "Glasses",
    })).toBe("v3|dev-1|openclaw-even-g2-node|node|node||1700000000000|tok|nonce|even-g2|glasses");
  });

  it("sends bootstrap auth separately from gateway token auth", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const params = await buildConnectParams({
      identity,
      nonce: "nonce",
      storedAuth: null,
      options: {
        url: "wss://gateway.example.test",
        bootstrapToken: "bootstrap",
        role: "node",
        scopes: [],
        caps: ["device", "talk", "canvas"],
        commands: ["talk.ptt.once", "canvas.present"],
        client: buildEvenG2ClientInfo("node", "inst-1"),
        userAgent: "test",
        identityStore: {
          loadOrCreate: async () => identity,
          sign: async (payload: string) => `sig:${payload}`,
        },
        authStore: new BrowserDeviceAuthStore(new MemoryStorage()),
      },
    });

    expect(params.auth).toEqual({ bootstrapToken: "bootstrap" });
    expect(params.client).toMatchObject({
      id: "openclaw-even-g2-node",
      platform: "even-g2",
      mode: "node",
      deviceFamily: "glasses",
      modelIdentifier: "Even G2",
    });
    expect(params.device.signature).toContain("v3|device-1|openclaw-even-g2-node|node|node||1700000000000|bootstrap|nonce|even-g2|glasses");
  });

  it("does not mix a stored device token into first-pass shared token auth", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const params = await buildConnectParams({
      identity,
      nonce: "nonce",
      storedAuth: {
        token: "stored-device-token",
        role: "node",
        scopes: ["node.invoke"],
        updatedAtMs: 1,
      },
      options: {
        url: "wss://gateway.example.test",
        token: "shared-token",
        role: "node",
        scopes: ["node.register"],
        caps: ["device"],
        commands: ["device.status"],
        client: buildEvenG2ClientInfo("node", "inst-1"),
        userAgent: "test",
        identityStore: {
          loadOrCreate: async () => identity,
          sign: async (payload: string) => `sig:${payload}`,
        },
        authStore: new BrowserDeviceAuthStore(new MemoryStorage()),
      },
    });

    expect(params.auth).toEqual({ token: "shared-token" });
    expect(params.device.signature).toContain("v3|device-1|openclaw-even-g2-node|node|node|node.register|1700000000000|shared-token|nonce|even-g2|glasses");
  });

  it("prefers a stored node device token over setup bootstrap when pairing is already approved", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const params = await buildConnectParams({
      identity,
      nonce: "nonce",
      storedAuth: {
        token: "stored-device-token",
        role: "node",
        scopes: ["node.invoke"],
        updatedAtMs: 1,
      },
      options: {
        url: "wss://gateway.example.test",
        bootstrapToken: "fresh-bootstrap",
        role: "node",
        scopes: [],
        caps: ["device"],
        commands: ["device.status"],
        client: buildEvenG2ClientInfo("node", "inst-1"),
        userAgent: "test",
        identityStore: {
          loadOrCreate: async () => identity,
          sign: async (payload: string) => `sig:${payload}`,
        },
        authStore: new BrowserDeviceAuthStore(new MemoryStorage()),
      },
    });

    expect(params.auth).toEqual({ token: "stored-device-token" });
    expect(params.device.signature).toContain("v3|device-1|openclaw-even-g2-node|node|node||1700000000000|stored-device-token|nonce|even-g2|glasses");
  });

  it("prefers a stored operator device token over setup bootstrap when pairing is already approved", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const params = await buildConnectParams({
      identity,
      nonce: "nonce",
      storedAuth: {
        token: "stored-operator-token",
        role: "operator",
        scopes: ["operator.read"],
        updatedAtMs: 1,
      },
      options: {
        url: "wss://gateway.example.test",
        bootstrapToken: "fresh-bootstrap",
        role: "operator",
        scopes: ["operator.read"],
        caps: [],
        commands: [],
        client: buildEvenG2ClientInfo("ui", "inst-1"),
        userAgent: "test",
        identityStore: {
          loadOrCreate: async () => identity,
          sign: async (payload: string) => `sig:${payload}`,
        },
        authStore: new BrowserDeviceAuthStore(new MemoryStorage()),
      },
    });

    expect(params.auth).toEqual({ token: "stored-operator-token" });
    expect(params.device.signature).toContain("v3|device-1|openclaw-even-g2-node|ui|operator|operator.read|1700000000000|stored-operator-token|nonce|even-g2|glasses");
  });

  it("clears stored browser device credentials during local pairing reset", () => {
    const storage = new MemoryStorage();
    storage.setItem("openclaw-even-g2-node-device-identity-v1", "{}");
    storage.setItem("openclaw-even-g2-node-device-auth-v1", "{}");

    clearBrowserDeviceCredentials(storage);

    expect(storage.getItem("openclaw-even-g2-node-device-identity-v1")).toBeNull();
    expect(storage.getItem("openclaw-even-g2-node-device-auth-v1")).toBeNull();
  });

  it("scopes stored device tokens by Gateway URL", () => {
    const authStore = new BrowserDeviceAuthStore(new MemoryStorage());
    authStore.save("device-1", "node", "gateway-a-token", [], "wss://gateway-a.example.test/ws?setup=secret#pairing");
    authStore.save("device-1", "node", "tenant-token", [], "wss://gateway-a.example.test/ws?tenant=alpha&setup=secret#pairing");

    expect(authStore.load("device-1", "node", "wss://gateway-a.example.test/ws")).toMatchObject({
      token: "gateway-a-token",
      role: "node",
    });
    expect(authStore.load("device-1", "node", "wss://gateway-a.example.test/ws?setup=other&tenant=alpha")).toMatchObject({
      token: "tenant-token",
      role: "node",
    });
    expect(authStore.load("device-1", "node", "wss://gateway-a.example.test/ws?tenant=beta")).toBeNull();
    expect(authStore.load("device-1", "node", "wss://gateway-b.example.test/ws")).toBeNull();
  });

  it("removes only the rejected stored token for the current Gateway URL and role", () => {
    const authStore = new BrowserDeviceAuthStore(new MemoryStorage());
    authStore.save("device-1", "node", "node-token", [], "wss://gateway.example.test/ws?setup=secret");
    authStore.save("device-1", "operator", "operator-token", ["operator.read"], "wss://gateway.example.test/ws?setup=secret");
    authStore.save("device-1", "node", "other-token", [], "wss://other.example.test/ws");

    authStore.remove("device-1", "node", "wss://gateway.example.test/ws");

    expect(authStore.load("device-1", "node", "wss://gateway.example.test/ws")).toBeNull();
    expect(authStore.load("device-1", "operator", "wss://gateway.example.test/ws")).toMatchObject({
      token: "operator-token",
    });
    expect(authStore.load("device-1", "node", "wss://other.example.test/ws")).toMatchObject({
      token: "other-token",
    });
  });

  it("requests current scopes when reconnecting with a stored device token", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const params = await buildConnectParams({
      identity,
      nonce: "nonce",
      storedAuth: {
        token: "stored-device-token",
        role: "operator",
        scopes: ["operator.read"],
        updatedAtMs: 1,
      },
      options: {
        url: "wss://gateway.example.test",
        role: "operator",
        scopes: ["operator.approvals", "operator.read", "operator.write"],
        caps: [],
        commands: [],
        client: buildEvenG2ClientInfo("ui", "inst-1"),
        userAgent: "test",
        identityStore: {
          loadOrCreate: async () => identity,
          sign: async (payload: string) => `sig:${payload}`,
        },
        authStore: new BrowserDeviceAuthStore(new MemoryStorage()),
      },
    });

    expect(params.auth).toEqual({ token: "stored-device-token" });
    expect(params.scopes).toEqual(["operator.approvals", "operator.read", "operator.write"]);
    expect(params.device.signature).toContain("v3|device-1|openclaw-even-g2-node|ui|operator|operator.approvals,operator.read,operator.write|1700000000000|stored-device-token|nonce|even-g2|glasses");
  });
});

describe("Gateway session events", () => {
  it("falls back to legacy node-host client id when Gateway does not know the native Even G2 id", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const transport = new GatewayDirectTransport({
      setupCodeOrUrl: encodeSetupCode({
        url: "wss://gateway.example.test",
        bootstrapToken: "bootstrap",
      }),
      WebSocketCtor: FakeGatewayWebSocketCtor,
    });

    transport.connect();
    await vi.waitFor(() => expect(FakeGatewayWebSocket.instances).toHaveLength(1));
    const first = FakeGatewayWebSocket.instances[0]!;
    first.receive({ type: "event", event: "connect.challenge", payload: { nonce: "nonce-1" } });
    await vi.waitFor(() => expect(lastConnectParams(first).params?.client?.id).toBe("openclaw-even-g2-node"));
    first.receive({
      type: "res",
      id: "__connect__",
      ok: false,
      error: {
        code: "validation_error",
        message: "unknown client id openclaw-even-g2-node",
      },
    });

    await vi.waitFor(() => expect(FakeGatewayWebSocket.instances).toHaveLength(2));
    const second = FakeGatewayWebSocket.instances[1]!;
    second.receive({ type: "event", event: "connect.challenge", payload: { nonce: "nonce-2" } });
    await vi.waitFor(() => expect(lastConnectParams(second).params?.client?.id).toBe("node-host"));
  });

  it("does not fall back to node-host for normal authentication failures", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const errors: string[] = [];
    const transport = new GatewayDirectTransport({
      setupCodeOrUrl: encodeSetupCode({
        url: "wss://gateway.example.test",
        bootstrapToken: "bootstrap",
      }),
      WebSocketCtor: FakeGatewayWebSocketCtor,
    });
    transport.addEventListener("message", (event) => {
      const data = JSON.parse(String((event as MessageEvent).data)) as { type?: string; error?: string };
      if (data.type === "error" && data.error) errors.push(data.error);
    });

    transport.connect();
    await vi.waitFor(() => expect(FakeGatewayWebSocket.instances).toHaveLength(1));
    const ws = FakeGatewayWebSocket.instances[0]!;
    ws.receive({ type: "event", event: "connect.challenge", payload: { nonce: "nonce-1" } });
    await vi.waitFor(() => expect(lastConnectParams(ws).params?.client?.id).toBe("openclaw-even-g2-node"));
    ws.receive({
      type: "res",
      id: "__connect__",
      ok: false,
      error: {
        code: "unauthorized",
        message: "unauthorized: gateway token mismatch",
      },
    });

    await vi.waitFor(() => expect(errors).toContain("unauthorized: gateway token mismatch"));
    expect(FakeGatewayWebSocket.instances).toHaveLength(1);
  });

  it("marks auth-pause connect errors so the app does not immediately retry", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const messages: Array<Record<string, unknown>> = [];
    const transport = new GatewayDirectTransport({
      setupCodeOrUrl: encodeSetupCode({
        url: "wss://gateway.example.test",
        bootstrapToken: "bootstrap",
      }),
      WebSocketCtor: FakeGatewayWebSocketCtor,
    });
    transport.addEventListener("message", (event) => {
      messages.push(JSON.parse(String((event as MessageEvent).data)) as Record<string, unknown>);
    });

    transport.connect();
    await vi.waitFor(() => expect(FakeGatewayWebSocket.instances).toHaveLength(1));
    const ws = FakeGatewayWebSocket.instances[0]!;
    ws.receive({ type: "event", event: "connect.challenge", payload: { nonce: "nonce-1" } });
    await vi.waitFor(() => expect(lastConnectParams(ws).params?.client?.id).toBe("openclaw-even-g2-node"));
    ws.receive({
      type: "res",
      id: "__connect__",
      ok: false,
      error: {
        code: "auth_paused",
        message: "too many failed authentication attempts",
        details: { pauseReconnect: true },
      },
    });

    await vi.waitFor(() => expect(messages).toContainEqual({
      type: "error",
      error: "too many failed authentication attempts",
      pauseReconnect: true,
    }));
  });

  it("propagates details-code auth pauses so the app backs off reconnects", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const messages: Array<Record<string, unknown>> = [];
    const transport = new GatewayDirectTransport({
      setupCodeOrUrl: encodeSetupCode({
        url: "wss://gateway.example.test",
        bootstrapToken: "bootstrap",
      }),
      WebSocketCtor: FakeGatewayWebSocketCtor,
    });
    transport.addEventListener("message", (event) => {
      messages.push(JSON.parse(String((event as MessageEvent).data)) as Record<string, unknown>);
    });

    transport.connect();
    await vi.waitFor(() => expect(FakeGatewayWebSocket.instances).toHaveLength(1));
    const ws = FakeGatewayWebSocket.instances[0]!;
    ws.receive({ type: "event", event: "connect.challenge", payload: { nonce: "nonce-1" } });
    await vi.waitFor(() => expect(lastConnectParams(ws).params?.client?.id).toBe("openclaw-even-g2-node"));
    ws.receive({
      type: "res",
      id: "__connect__",
      ok: false,
      error: {
        code: "unauthorized",
        message: "authentication paused",
        details: { code: "auth_paused" },
      },
    });

    await vi.waitFor(() => expect(messages).toContainEqual({
      type: "error",
      error: "authentication paused",
      pauseReconnect: true,
    }));
  });

  it("does not retry bootstrap when an auth pause is reported in details code", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const storage = new MemoryStorage();
    const authStore = new BrowserDeviceAuthStore(storage);
    const errors: Error[] = [];
    authStore.save(identity.deviceId, "node", "stored-device-token", [], "wss://gateway.example.test");
    const session = new GatewayWsSession({
      url: "wss://gateway.example.test",
      bootstrapToken: "fresh-bootstrap",
      role: "node",
      scopes: [],
      caps: ["device"],
      commands: ["device.status"],
      client: buildEvenG2ClientInfo("node", "inst-1"),
      userAgent: "test",
      WebSocketCtor: FakeGatewayWebSocketCtor,
      identityStore: {
        loadOrCreate: async () => identity,
        sign: async (payload: string) => `sig:${payload}`,
      },
      authStore,
      onError: (error) => errors.push(error),
    });

    await session.connect();
    const ws = FakeGatewayWebSocket.instances[0]!;
    ws.receive({ type: "event", event: "connect.challenge", payload: { nonce: "nonce-1" } });
    await vi.waitFor(() => expect(lastConnectParams(ws).params?.auth).toEqual({ token: "stored-device-token" }));

    ws.receive({
      type: "res",
      id: "__connect__",
      ok: false,
      error: {
        code: "unauthorized",
        message: "authentication paused",
        details: { code: "auth_paused" },
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(ws.sent.filter((item) => item.includes("\"method\":\"connect\""))).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(GatewayConnectError);
    expect((errors[0] as GatewayConnectError).gatewayError?.details?.code).toBe("auth_paused");
  });

  it("does not retry bootstrap when auth pause is reported by message or reason", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const storage = new MemoryStorage();
    const authStore = new BrowserDeviceAuthStore(storage);
    authStore.save(identity.deviceId, "node", "stored-device-token", [], "wss://gateway.example.test");
    const session = new GatewayWsSession({
      url: "wss://gateway.example.test",
      bootstrapToken: "fresh-bootstrap",
      role: "node",
      scopes: [],
      caps: ["device"],
      commands: ["device.status"],
      client: buildEvenG2ClientInfo("node", "inst-1"),
      userAgent: "test",
      WebSocketCtor: FakeGatewayWebSocketCtor,
      identityStore: {
        loadOrCreate: async () => identity,
        sign: async (payload: string) => `sig:${payload}`,
      },
      authStore,
    });

    await session.connect();
    const ws = FakeGatewayWebSocket.instances[0]!;
    ws.receive({ type: "event", event: "connect.challenge", payload: { nonce: "nonce-1" } });
    await vi.waitFor(() => expect(lastConnectParams(ws).params?.auth).toEqual({ token: "stored-device-token" }));

    ws.receive({
      type: "res",
      id: "__connect__",
      ok: false,
      error: {
        code: "unauthorized",
        message: "authentication paused",
        details: { reason: "authentication paused" },
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(ws.sent.filter((item) => item.includes("\"method\":\"connect\""))).toHaveLength(1);
  });

  it("falls back to setup bootstrap once when a stored device token is rejected", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const storage = new MemoryStorage();
    const authStore = new BrowserDeviceAuthStore(storage);
    authStore.save(identity.deviceId, "node", "stored-device-token", [], "wss://gateway.example.test");
    const session = new GatewayWsSession({
      url: "wss://gateway.example.test",
      bootstrapToken: "fresh-bootstrap",
      role: "node",
      scopes: [],
      caps: ["device"],
      commands: ["device.status"],
      client: buildEvenG2ClientInfo("node", "inst-1"),
      userAgent: "test",
      WebSocketCtor: FakeGatewayWebSocketCtor,
      identityStore: {
        loadOrCreate: async () => identity,
        sign: async (payload: string) => `sig:${payload}`,
      },
      authStore,
    });

    await session.connect();
    const ws = FakeGatewayWebSocket.instances[0]!;
    ws.receive({ type: "event", event: "connect.challenge", payload: { nonce: "nonce-1" } });
    await vi.waitFor(() => expect(lastConnectParams(ws).params?.auth).toEqual({ token: "stored-device-token" }));

    ws.receive({
      type: "res",
      id: "__connect__",
      ok: false,
      error: {
        code: "unauthorized",
        message: "device token revoked",
      },
    });

    await vi.waitFor(() => {
      expect(ws.sent.filter((item) => item.includes("\"method\":\"connect\""))).toHaveLength(2);
    });
    const retry = lastConnectParams(ws);
    expect(retry.params?.auth).toEqual({ bootstrapToken: "fresh-bootstrap" });
    expect(retry.params?.device?.signature).toContain("v3|device-1|openclaw-even-g2-node|node|node||1700000000000|fresh-bootstrap|nonce-1|even-g2|glasses");
    expect(authStore.load(identity.deviceId, "node", "wss://gateway.example.test")).toBeNull();
  });

  it("falls back to setup bootstrap for approval pauses from rejected stored tokens", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const storage = new MemoryStorage();
    const authStore = new BrowserDeviceAuthStore(storage);
    authStore.save(identity.deviceId, "node", "stored-device-token", [], "wss://gateway.example.test");
    const session = new GatewayWsSession({
      url: "wss://gateway.example.test",
      bootstrapToken: "fresh-bootstrap",
      role: "node",
      scopes: [],
      caps: ["device"],
      commands: ["device.status"],
      client: buildEvenG2ClientInfo("node", "inst-1"),
      userAgent: "test",
      WebSocketCtor: FakeGatewayWebSocketCtor,
      identityStore: {
        loadOrCreate: async () => identity,
        sign: async (payload: string) => `sig:${payload}`,
      },
      authStore,
    });

    await session.connect();
    const ws = FakeGatewayWebSocket.instances[0]!;
    ws.receive({ type: "event", event: "connect.challenge", payload: { nonce: "nonce-1" } });
    await vi.waitFor(() => expect(lastConnectParams(ws).params?.auth).toEqual({ token: "stored-device-token" }));

    ws.receive({
      type: "res",
      id: "__connect__",
      ok: false,
      error: {
        code: "approval_required",
        message: "higher role than currently approved",
        details: {
          pauseReconnect: true,
          reason: "approval required",
        },
      },
    });

    await vi.waitFor(() => {
      expect(ws.sent.filter((item) => item.includes("\"method\":\"connect\""))).toHaveLength(2);
    });
    expect(lastConnectParams(ws).params?.auth).toEqual({ bootstrapToken: "fresh-bootstrap" });
    expect(authStore.load(identity.deviceId, "node", "wss://gateway.example.test")).toBeNull();
  });

  it("falls back to setup bootstrap when stored operator tokens need a role upgrade", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const storage = new MemoryStorage();
    const authStore = new BrowserDeviceAuthStore(storage);
    authStore.save(identity.deviceId, "operator", "stored-operator-token", ["operator.read"], "wss://gateway.example.test");
    const session = new GatewayWsSession({
      url: "wss://gateway.example.test",
      bootstrapToken: "fresh-bootstrap",
      role: "operator",
      scopes: ["operator.approvals", "operator.read", "operator.write"],
      caps: [],
      commands: [],
      client: buildEvenG2ClientInfo("ui", "inst-1"),
      userAgent: "test",
      WebSocketCtor: FakeGatewayWebSocketCtor,
      identityStore: {
        loadOrCreate: async () => identity,
        sign: async (payload: string) => `sig:${payload}`,
      },
      authStore,
    });

    await session.connect();
    const ws = FakeGatewayWebSocket.instances[0]!;
    ws.receive({ type: "event", event: "connect.challenge", payload: { nonce: "nonce-1" } });
    await vi.waitFor(() => expect(lastConnectParams(ws).params?.auth).toEqual({ token: "stored-operator-token" }));

    ws.receive({
      type: "res",
      id: "__connect__",
      ok: false,
      error: {
        code: "unauthorized",
        message: "higher role than currently approved",
      },
    });

    await vi.waitFor(() => {
      expect(ws.sent.filter((item) => item.includes("\"method\":\"connect\""))).toHaveLength(2);
    });
    expect(lastConnectParams(ws).params?.auth).toEqual({ bootstrapToken: "fresh-bootstrap" });
    expect(authStore.load(identity.deviceId, "operator", "wss://gateway.example.test")).toBeNull();
  });

  it("ignores late node-open callbacks after the direct transport closes", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const messages: Array<Record<string, unknown>> = [];
    const transport = new GatewayDirectTransport({
      setupCodeOrUrl: encodeSetupCode({
        url: "wss://gateway.example.test",
        bootstrapToken: "bootstrap",
      }),
      WebSocketCtor: FakeGatewayWebSocketCtor,
    });
    transport.addEventListener("message", (event) => {
      messages.push(JSON.parse(String((event as MessageEvent).data)) as Record<string, unknown>);
    });

    transport.connect();
    await vi.waitFor(() => expect(FakeGatewayWebSocket.instances).toHaveLength(1));
    const ws = FakeGatewayWebSocket.instances[0]!;
    ws.receive({ type: "event", event: "connect.challenge", payload: { nonce: "nonce-1" } });
    await vi.waitFor(() => expect(lastConnectParams(ws).params?.client?.id).toBe("openclaw-even-g2-node"));

    transport.close();
    ws.receive({
      type: "res",
      id: "__connect__",
      ok: true,
      payload: { token: "node-token" },
    });

    await Promise.resolve();
    expect(messages).not.toContainEqual(expect.objectContaining({ type: "eveng2.runtime.status" }));
    expect(FakeGatewayWebSocket.instances).toHaveLength(1);
  });

  it("does not open a Gateway socket when closed during identity load", async () => {
    const identityLoad = deferred<DeviceIdentity>();
    const session = new GatewayWsSession({
      url: "wss://gateway.example.test",
      role: "node",
      scopes: [],
      caps: [],
      commands: [],
      client: buildEvenG2ClientInfo("node", "inst-1"),
      userAgent: "test",
      WebSocketCtor: FakeGatewayWebSocketCtor,
      identityStore: {
        loadOrCreate: async () => identityLoad.promise,
        sign: async () => "sig",
      },
      authStore: new BrowserDeviceAuthStore(new MemoryStorage()),
    });

    const connectPromise = session.connect();
    session.close();
    identityLoad.resolve(identity);
    await connectPromise;

    expect(FakeGatewayWebSocket.instances).toHaveLength(0);
  });

  it("does not answer a stale Gateway challenge after close", async () => {
    const signature = deferred<string>();
    const session = new GatewayWsSession({
      url: "wss://gateway.example.test",
      role: "node",
      scopes: [],
      caps: [],
      commands: [],
      client: buildEvenG2ClientInfo("node", "inst-1"),
      userAgent: "test",
      WebSocketCtor: FakeGatewayWebSocketCtor,
      identityStore: {
        loadOrCreate: async () => identity,
        sign: async () => signature.promise,
      },
      authStore: new BrowserDeviceAuthStore(new MemoryStorage()),
    });

    await session.connect();
    const ws = FakeGatewayWebSocket.instances[0]!;
    ws.receive({ type: "event", event: "connect.challenge", payload: { nonce: "nonce-1" } });
    session.close();
    signature.resolve("sig");
    await Promise.resolve();
    await Promise.resolve();

    expect(ws.sent.some((item) => item.includes("\"method\":\"connect\""))).toBe(false);
  });

  it("rejects pending Gateway RPCs when closed", async () => {
    const session = new GatewayWsSession({
      url: "wss://gateway.example.test",
      role: "operator",
      scopes: ["operator.read"],
      caps: [],
      commands: [],
      client: buildEvenG2ClientInfo("ui", "inst-1"),
      userAgent: "test",
      WebSocketCtor: FakeGatewayWebSocketCtor,
      identityStore: {
        loadOrCreate: async () => identity,
        sign: async () => "sig",
      },
      authStore: new BrowserDeviceAuthStore(new MemoryStorage()),
    });

    await session.connect();
    const request = session.request("talk.catalog", undefined, 30_000);
    session.close();

    await expect(request).rejects.toThrow("gateway session closed");
  });

  it("persists bounded operator handoff tokens from setup-code hello", async () => {
    const storage = new MemoryStorage();
    const authStore = new BrowserDeviceAuthStore(storage);
    const session = new GatewayWsSession({
      url: "wss://gateway.example.test",
      role: "node",
      scopes: [],
      caps: [],
      commands: [],
      client: buildEvenG2ClientInfo("node", "inst-1"),
      userAgent: "test",
      identityStore: {
        loadOrCreate: async () => identity,
        sign: async () => "sig",
      },
      authStore,
    });
    const persistAuth = Reflect.get(session, "persistAuth");
    if (typeof persistAuth !== "function") throw new Error("GatewayWsSession.persistAuth is unavailable");

    persistAuth.call(session, {
      type: "hello-ok",
      auth: {
        role: "node",
        deviceToken: "node-token",
        scopes: [],
        deviceTokens: [
          {
            role: "operator",
            deviceToken: "operator-token",
            scopes: ["operator.approvals", "operator.read", "operator.talk.secrets", "operator.write"],
          },
        ],
      },
    }, identity.deviceId);

    expect(authStore.load(identity.deviceId, "node", "wss://gateway.example.test")).toMatchObject({
      token: "node-token",
      role: "node",
      scopes: [],
    });
    expect(authStore.load(identity.deviceId, "operator", "wss://gateway.example.test")).toMatchObject({
      token: "operator-token",
      role: "operator",
      scopes: ["operator.approvals", "operator.read", "operator.talk.secrets", "operator.write"],
    });
  });

  it("parses payloadJSON before dispatching Gateway events", async () => {
    const events: Array<{ event: string; payload: unknown }> = [];
    const session = new GatewayWsSession({
      url: "wss://gateway.example.test",
      role: "node",
      scopes: [],
      caps: [],
      commands: [],
      client: buildEvenG2ClientInfo("node", "inst-1"),
      userAgent: "test",
      identityStore: {
        loadOrCreate: async () => identity,
        sign: async () => "sig",
      },
      authStore: new BrowserDeviceAuthStore(new MemoryStorage()),
      onEvent: (event, payload) => events.push({ event, payload }),
    });
    const handleMessage = Reflect.get(session, "handleMessage");
    if (typeof handleMessage !== "function") throw new Error("GatewayWsSession.handleMessage is unavailable");

    await handleMessage.call(session, JSON.stringify({
      type: "event",
      event: "node.invoke.request",
      payloadJSON: JSON.stringify({ id: "cmd-1", command: "device.status" }),
    }), identity);

    expect(events).toEqual([{
      event: "node.invoke.request",
      payload: { id: "cmd-1", command: "device.status" },
    }]);
  });
});

describe("Gateway direct approval events", () => {
  it("normalizes nested Gateway approval requests", () => {
    expect(approvalRequestMessageFromGatewayEvent({
      id: "approval-1",
      request: {
        command: "pnpm check",
        cwd: "/repo",
        warningText: "Command approval needed",
        security: "full",
      },
    })).toEqual({
      type: "eveng2.approval.request",
      id: "approval-1",
      requestId: "approval-1",
      command: "pnpm check",
      cwd: "/repo",
      ask: "Command approval needed",
      security: "full",
    });
  });

  it("accepts requestId-only Gateway approval requests", () => {
    expect(approvalRequestMessageFromGatewayEvent({
      requestId: "request-1",
      request: {
        commandText: "npm test",
        requestId: "nested-request-1",
      },
    })).toMatchObject({
      type: "eveng2.approval.request",
      id: "request-1",
      requestId: "request-1",
      command: "npm test",
    });
  });

  it("normalizes resolved Gateway approval events", () => {
    expect(approvalResolvedMessageFromGatewayEvent({
      id: "approval-1",
      decision: "deny",
    })).toEqual({
      type: "eveng2.approval.resolved",
      id: "approval-1",
      requestId: "approval-1",
      decision: "deny",
    });
  });

  it("accepts requestId-only Gateway approval resolved events", () => {
    expect(approvalResolvedMessageFromGatewayEvent({
      requestId: "request-1",
      decision: "accept",
    })).toEqual({
      type: "eveng2.approval.resolved",
      id: "request-1",
      requestId: "request-1",
      decision: "accept",
    });
  });
});

describe("Gateway direct transcript history", () => {
  it("reports pending Even G2 node command approval from node.list", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "node.list") {
        return {
          nodes: [{
            nodeId: "node-1",
            deviceId: "device-1",
            displayName: "Even G2",
            platform: "even-g2",
            deviceFamily: "glasses",
            approvalState: "pending-approval",
            pendingDeclaredCommands: ["canvas.present", "talk.ptt.once"],
          }],
        };
      }
      return {};
    });
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });
    setOpenOperatorSession(gateway, { request });
    Reflect.set(gateway, "nodeApprovalPending", true);

    const refreshNodeApprovalStatus = Reflect.get(gateway, "refreshNodeApprovalStatus");
    if (typeof refreshNodeApprovalStatus !== "function") throw new Error("GatewayDirectTransport.refreshNodeApprovalStatus is unavailable");
    await refreshNodeApprovalStatus.call(gateway);

    expect(messages).toContainEqual({
      type: "eveng2.runtime.status",
      session: "",
      node: expect.objectContaining({
        nodeId: "node-1",
        deviceId: "device-1",
        displayName: "Even G2",
        platform: "even-g2",
      }),
    });
    expect(messages).toContainEqual({
      type: "eveng2.node.approval.required",
      nodeId: "node-1",
      approvalState: "pending-approval",
      commands: ["canvas.present", "talk.ptt.once"],
    });
  });

  it("treats pending node approval state as pending even when command lists are omitted", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "node.list") {
        return {
          nodes: [{
            nodeId: "node-1",
            deviceId: "device-1",
            displayName: "Even G2",
            platform: "even-g2",
            deviceFamily: "glasses",
            approvalState: "pending-approval",
          }],
        };
      }
      return {};
    });
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });
    setOpenOperatorSession(gateway, { request });
    Reflect.set(gateway, "nodeApprovalPending", true);

    const refreshNodeApprovalStatus = Reflect.get(gateway, "refreshNodeApprovalStatus");
    if (typeof refreshNodeApprovalStatus !== "function") throw new Error("GatewayDirectTransport.refreshNodeApprovalStatus is unavailable");
    await refreshNodeApprovalStatus.call(gateway);

    expect(messages).toContainEqual({
      type: "eveng2.node.approval.required",
      nodeId: "node-1",
      approvalState: "pending-approval",
      commands: [],
    });
    expect(messages).not.toContainEqual({ type: "eveng2.node.approval.ready" });
  });

  it("ignores pending Even G2 node approval for a different device identity", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "node.list") {
        return {
          nodes: [
            {
              nodeId: "node-current",
              deviceId: "device-current",
              displayName: "Even G2",
              platform: "even-g2",
              deviceFamily: "glasses",
              approvalState: "approved",
              commands: ["canvas.present"],
            },
            {
              nodeId: "node-other",
              deviceId: "device-other",
              displayName: "Even G2",
              platform: "even-g2",
              deviceFamily: "glasses",
              approvalState: "pending-approval",
              pendingRequestId: "request-other",
              pendingDeclaredCommands: ["talk.ptt.once"],
            },
          ],
        };
      }
      return {};
    });
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });
    setOpenOperatorSession(gateway, { request });
    Reflect.set(gateway, "connectedDeviceId", "device-current");
    Reflect.set(gateway, "nodeApprovalPending", true);

    const refreshNodeApprovalStatus = Reflect.get(gateway, "refreshNodeApprovalStatus");
    if (typeof refreshNodeApprovalStatus !== "function") throw new Error("GatewayDirectTransport.refreshNodeApprovalStatus is unavailable");
    await refreshNodeApprovalStatus.call(gateway);

    expect(messages).toContainEqual({
      type: "eveng2.runtime.status",
      session: "",
      node: expect.objectContaining({
        nodeId: "node-current",
        deviceId: "device-current",
        approvalState: "approved",
      }),
    });
    expect(messages).toContainEqual({ type: "eveng2.node.approval.ready" });
    expect(messages).not.toContainEqual(expect.objectContaining({
      type: "eveng2.node.approval.required",
      nodeId: "node-other",
    }));
  });

  it("keeps the approval prompt when the sole pending Even G2 row omits device ids", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "node.list") {
        return {
          nodes: [{
            nodeId: "node-pending",
            displayName: "Even G2",
            platform: "even-g2",
            deviceFamily: "glasses",
            approvalState: "pending-approval",
            pendingRequestId: "request-pending",
            pendingDeclaredCommands: ["canvas.present"],
          }],
        };
      }
      return {};
    });
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });
    setOpenOperatorSession(gateway, { request });
    Reflect.set(gateway, "connectedDeviceId", "device-current");

    const refreshNodeApprovalStatus = Reflect.get(gateway, "refreshNodeApprovalStatus");
    if (typeof refreshNodeApprovalStatus !== "function") throw new Error("GatewayDirectTransport.refreshNodeApprovalStatus is unavailable");
    await refreshNodeApprovalStatus.call(gateway);

    expect(messages).toContainEqual({
      type: "eveng2.node.approval.required",
      nodeId: "node-pending",
      approvalState: "pending-approval",
      commands: ["canvas.present"],
    });
  });

  it("detects pending Even G2 node approvals when node.list exposes pending and paired output", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "node.list") {
        return {
          pending: [{
            requestId: "13cd37a9-2ab9-42d7-9610-1202afcf1b47",
            nodeId: "node-current",
            displayName: "Even G2",
            platform: "even-g2",
            deviceFamily: "glasses",
            modelIdentifier: "Even G2",
            caps: ["device", "talk", "canvas"],
            commands: ["device.status", "talk.ptt.once", "canvas.present"],
            requiredApproveScopes: ["operator.pairing", "operator.write"],
          }],
          paired: [{
            nodeId: "node-current",
            displayName: "Even G2",
            platform: "even-g2",
            clientId: "node-host",
            clientMode: "node",
            deviceFamily: "glasses",
            modelIdentifier: "Even G2",
            approvalState: "pending-approval",
            paired: true,
            connected: true,
          }],
        };
      }
      return {};
    });
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });
    setOpenOperatorSession(gateway, { request });
    Reflect.set(gateway, "connectedDeviceId", "device-current");

    const refreshNodeApprovalStatus = Reflect.get(gateway, "refreshNodeApprovalStatus");
    if (typeof refreshNodeApprovalStatus !== "function") throw new Error("GatewayDirectTransport.refreshNodeApprovalStatus is unavailable");
    await refreshNodeApprovalStatus.call(gateway);

    expect(messages).toContainEqual({
      type: "eveng2.runtime.status",
      session: "",
      node: expect.objectContaining({
        nodeId: "node-current",
        nodeConnected: true,
        connected: true,
        approvalState: "pending-approval",
      }),
    });
    expect(messages).toContainEqual({
      type: "eveng2.node.approval.required",
      nodeId: "node-current",
      approvalState: "pending-approval",
      commands: ["device.status", "talk.ptt.once", "canvas.present"],
    });
  });

  it("merges pending approval rows with current node.list rows", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "node.list") {
        return {
          nodes: [{
            nodeId: "node-current",
            deviceId: "device-current",
            displayName: "Even G2",
            platform: "even-g2",
            deviceFamily: "glasses",
            approvalState: "approved",
            commands: ["canvas.present"],
          }],
          pending: [{
            requestId: "13cd37a9-2ab9-42d7-9610-1202afcf1b47",
            nodeId: "node-current",
            displayName: "Even G2",
            platform: "even-g2",
            deviceFamily: "glasses",
            commands: ["talk.ptt.once"],
          }],
        };
      }
      return {};
    });
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });
    setOpenOperatorSession(gateway, { request });
    Reflect.set(gateway, "connectedDeviceId", "device-current");

    const refreshNodeApprovalStatus = Reflect.get(gateway, "refreshNodeApprovalStatus");
    if (typeof refreshNodeApprovalStatus !== "function") throw new Error("GatewayDirectTransport.refreshNodeApprovalStatus is unavailable");
    await refreshNodeApprovalStatus.call(gateway);

    const runtimeStatus = messages.find((message) => message.type === "eveng2.runtime.status");
    expect(runtimeStatus).toEqual(expect.objectContaining({
      type: "eveng2.runtime.status",
      session: "",
      node: expect.objectContaining({
        nodeId: "node-current",
        deviceId: "device-current",
        approvalState: "",
      }),
    }));
    expect(messages).toContainEqual({
      type: "eveng2.node.approval.required",
      nodeId: "node-current",
      approvalState: "pending-approval",
      commands: ["talk.ptt.once"],
    });
  });

  it("keeps runtime pending approval rows when a different top-level pending request exists", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "node.list") {
        return {
          nodes: [{
            nodeId: "node-current",
            deviceId: "device-current",
            displayName: "Even G2",
            platform: "even-g2",
            deviceFamily: "glasses",
            approvalState: "pending-approval",
            commands: ["canvas.present"],
          }],
          pending: [{
            requestId: "other-request",
            nodeId: "node-other",
            deviceId: "device-other",
            displayName: "Even G2",
            platform: "even-g2",
            deviceFamily: "glasses",
            commands: ["talk.ptt.once"],
          }],
        };
      }
      return {};
    });
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });
    setOpenOperatorSession(gateway, { request });
    Reflect.set(gateway, "connectedDeviceId", "device-current");

    const refreshNodeApprovalStatus = Reflect.get(gateway, "refreshNodeApprovalStatus");
    if (typeof refreshNodeApprovalStatus !== "function") throw new Error("GatewayDirectTransport.refreshNodeApprovalStatus is unavailable");
    await refreshNodeApprovalStatus.call(gateway);

    expect(messages).toContainEqual({
      type: "eveng2.node.approval.required",
      nodeId: "node-current",
      approvalState: "pending-approval",
      commands: ["canvas.present"],
    });
  });

  it("preserves id-less source pending approval when the runtime row is also pending", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "node.list") {
        return {
          nodes: [{
            nodeId: "node-current",
            deviceId: "device-current",
            displayName: "Even G2",
            platform: "even-g2",
            deviceFamily: "glasses",
            approvalState: "pending-approval",
            commands: ["canvas.present"],
          }],
          pending: [{
            requestId: "13cd37a9-2ab9-42d7-9610-1202afcf1b47",
            commands: ["talk.ptt.once"],
          }],
        };
      }
      return {};
    });
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });
    setOpenOperatorSession(gateway, { request });
    Reflect.set(gateway, "connectedDeviceId", "device-current");

    const refreshNodeApprovalStatus = Reflect.get(gateway, "refreshNodeApprovalStatus");
    if (typeof refreshNodeApprovalStatus !== "function") throw new Error("GatewayDirectTransport.refreshNodeApprovalStatus is unavailable");
    await refreshNodeApprovalStatus.call(gateway);

    expect(messages).toContainEqual({
      type: "eveng2.node.approval.required",
      nodeId: "node-current",
      approvalState: "pending-approval",
      commands: ["talk.ptt.once"],
    });
  });

  it("matches top-level pending rows by id when they omit Even G2 metadata", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "node.list") {
        return {
          nodes: [{
            nodeId: "node-current",
            deviceId: "device-current",
            displayName: "Even G2",
            platform: "even-g2",
            deviceFamily: "glasses",
            approvalState: "approved",
            commands: ["canvas.present"],
          }],
          pending: [{
            requestId: "13cd37a9-2ab9-42d7-9610-1202afcf1b47",
            nodeId: "node-current",
            commands: ["talk.ptt.once"],
          }],
        };
      }
      return {};
    });
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });
    setOpenOperatorSession(gateway, { request });
    Reflect.set(gateway, "connectedDeviceId", "device-current");

    const refreshNodeApprovalStatus = Reflect.get(gateway, "refreshNodeApprovalStatus");
    if (typeof refreshNodeApprovalStatus !== "function") throw new Error("GatewayDirectTransport.refreshNodeApprovalStatus is unavailable");
    await refreshNodeApprovalStatus.call(gateway);

    expect(messages).toContainEqual({
      type: "eveng2.node.approval.required",
      nodeId: "node-current",
      approvalState: "pending-approval",
      commands: ["talk.ptt.once"],
    });
  });

  it("ignores request-only source pending rows when the current node is already approved", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "node.list") {
        return {
          nodes: [{
            nodeId: "node-current",
            deviceId: "device-current",
            displayName: "Even G2",
            platform: "even-g2",
            deviceFamily: "glasses",
            approvalState: "approved",
            commands: ["canvas.present"],
          }],
          pending: [{
            requestId: "request-other-client",
            commands: ["other.command"],
          }],
        };
      }
      return {};
    });
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });
    setOpenOperatorSession(gateway, { request });
    Reflect.set(gateway, "connectedDeviceId", "device-current");
    Reflect.set(gateway, "nodeApprovalPending", true);

    const refreshNodeApprovalStatus = Reflect.get(gateway, "refreshNodeApprovalStatus");
    if (typeof refreshNodeApprovalStatus !== "function") throw new Error("GatewayDirectTransport.refreshNodeApprovalStatus is unavailable");
    await refreshNodeApprovalStatus.call(gateway);

    expect(messages).toContainEqual({
      type: "eveng2.runtime.status",
      session: "",
      node: expect.objectContaining({
        nodeId: "node-current",
        approvalState: "approved",
      }),
    });
    expect(messages).toContainEqual({ type: "eveng2.node.approval.ready" });
    expect(messages).not.toContainEqual(expect.objectContaining({
      type: "eveng2.node.approval.required",
    }));
  });

  it("preserves a singleton id-less pending approval row for the current node", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "node.list") {
        return {
          nodes: [{
            nodeId: "node-current",
            deviceId: "device-current",
            displayName: "Even G2",
            platform: "even-g2",
            deviceFamily: "glasses",
            approvalState: "approved",
            commands: ["canvas.present"],
          }],
          pending: [{
            requestId: "13cd37a9-2ab9-42d7-9610-1202afcf1b47",
            displayName: "Even G2",
            platform: "even-g2",
            deviceFamily: "glasses",
            caps: ["device", "talk", "canvas"],
            commands: ["device.status", "talk.ptt.once", "canvas.present"],
          }],
        };
      }
      return {};
    });
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });
    setOpenOperatorSession(gateway, { request });
    Reflect.set(gateway, "connectedDeviceId", "device-current");

    const refreshNodeApprovalStatus = Reflect.get(gateway, "refreshNodeApprovalStatus");
    if (typeof refreshNodeApprovalStatus !== "function") throw new Error("GatewayDirectTransport.refreshNodeApprovalStatus is unavailable");
    await refreshNodeApprovalStatus.call(gateway);

    const runtimeStatus = messages.find((message) => message.type === "eveng2.runtime.status");
    expect(runtimeStatus).toEqual(expect.objectContaining({
      type: "eveng2.runtime.status",
      node: expect.objectContaining({
        nodeId: "node-current",
        approvalState: "",
      }),
    }));
    expect(messages).toContainEqual({
      type: "eveng2.node.approval.required",
      nodeId: "node-current",
      approvalState: "pending-approval",
      commands: ["device.status", "talk.ptt.once", "canvas.present"],
    });
  });

  it("preserves id-less pending approval when nodes and paired duplicate the current node", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "node.list") {
        return {
          nodes: [{
            nodeId: "node-current",
            deviceId: "device-current",
            displayName: "Even G2",
            platform: "even-g2",
            deviceFamily: "glasses",
            approvalState: "approved",
            commands: ["canvas.present"],
          }],
          paired: [{
            nodeId: "node-current",
            deviceId: "device-current",
            displayName: "Even G2",
            platform: "even-g2",
            deviceFamily: "glasses",
            approvalState: "approved",
            paired: true,
            connected: true,
            commands: ["canvas.present"],
          }],
          pending: [{
            requestId: "13cd37a9-2ab9-42d7-9610-1202afcf1b47",
            displayName: "Even G2",
            platform: "even-g2",
            deviceFamily: "glasses",
            commands: ["talk.ptt.once"],
          }],
        };
      }
      return {};
    });
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });
    setOpenOperatorSession(gateway, { request });
    Reflect.set(gateway, "connectedDeviceId", "device-current");

    const refreshNodeApprovalStatus = Reflect.get(gateway, "refreshNodeApprovalStatus");
    if (typeof refreshNodeApprovalStatus !== "function") throw new Error("GatewayDirectTransport.refreshNodeApprovalStatus is unavailable");
    await refreshNodeApprovalStatus.call(gateway);

    const runtimeStatus = messages.find((message) => message.type === "eveng2.runtime.status");
    expect(runtimeStatus).toEqual(expect.objectContaining({
      type: "eveng2.runtime.status",
      node: expect.objectContaining({
        nodeId: "node-current",
        nodeConnected: true,
        connected: true,
        paired: true,
        approvalState: "",
      }),
    }));
    expect(messages).toContainEqual({
      type: "eveng2.node.approval.required",
      nodeId: "node-current",
      approvalState: "pending-approval",
      commands: ["talk.ptt.once"],
    });
  });

  it("ignores unmatched legacy pending rows after the current node is identified", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "node.list") {
        return {
          nodes: [
            {
              nodeId: "node-current",
              deviceId: "device-current",
              displayName: "Even G2",
              platform: "even-g2",
              deviceFamily: "glasses",
              approvalState: "approved",
              commands: ["canvas.present"],
            },
            {
              nodeId: "node-legacy-pending",
              displayName: "Even G2",
              platform: "even-g2",
              deviceFamily: "glasses",
              approvalState: "pending-approval",
              pendingRequestId: "request-legacy",
              pendingDeclaredCommands: ["talk.ptt.once"],
            },
          ],
        };
      }
      return {};
    });
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });
    setOpenOperatorSession(gateway, { request });
    Reflect.set(gateway, "connectedDeviceId", "device-current");
    Reflect.set(gateway, "nodeApprovalPending", true);

    const refreshNodeApprovalStatus = Reflect.get(gateway, "refreshNodeApprovalStatus");
    if (typeof refreshNodeApprovalStatus !== "function") throw new Error("GatewayDirectTransport.refreshNodeApprovalStatus is unavailable");
    await refreshNodeApprovalStatus.call(gateway);

    expect(messages).toContainEqual({
      type: "eveng2.runtime.status",
      session: "",
      node: expect.objectContaining({
        nodeId: "node-current",
        deviceId: "device-current",
      }),
    });
    expect(messages).toContainEqual({ type: "eveng2.node.approval.ready" });
    expect(messages).not.toContainEqual(expect.objectContaining({
      type: "eveng2.node.approval.required",
      nodeId: "node-legacy-pending",
    }));
  });

  it("does not treat blank request id fields as pending node approval", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "node.list") {
        return {
          nodes: [{
            nodeId: "node-current",
            deviceId: "device-current",
            displayName: "Even G2",
            platform: "even-g2",
            deviceFamily: "glasses",
            pendingRequestId: null,
            requestId: "",
            commands: ["canvas.present"],
          }],
        };
      }
      return {};
    });
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });
    setOpenOperatorSession(gateway, { request });
    Reflect.set(gateway, "connectedDeviceId", "device-current");
    Reflect.set(gateway, "nodeApprovalPending", true);

    const refreshNodeApprovalStatus = Reflect.get(gateway, "refreshNodeApprovalStatus");
    if (typeof refreshNodeApprovalStatus !== "function") throw new Error("GatewayDirectTransport.refreshNodeApprovalStatus is unavailable");
    await refreshNodeApprovalStatus.call(gateway);

    expect(messages).toContainEqual({ type: "eveng2.node.approval.ready" });
    expect(messages).not.toContainEqual(expect.objectContaining({
      type: "eveng2.node.approval.required",
    }));
  });

  it("clears node command approval when node.list has no pending Even G2 node", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "node.list") {
        return {
          nodes: [{
            nodeId: "node-1",
            deviceId: "device-1",
            displayName: "Even G2",
            platform: "even-g2",
            deviceFamily: "glasses",
            approvalState: "approved",
            commands: ["canvas.present", "talk.ptt.once"],
          }],
        };
      }
      return {};
    });
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });
    setOpenOperatorSession(gateway, { request });
    Reflect.set(gateway, "nodeApprovalPending", true);

    const refreshNodeApprovalStatus = Reflect.get(gateway, "refreshNodeApprovalStatus");
    if (typeof refreshNodeApprovalStatus !== "function") throw new Error("GatewayDirectTransport.refreshNodeApprovalStatus is unavailable");
    await refreshNodeApprovalStatus.call(gateway);

    expect(messages).toContainEqual({
      type: "eveng2.runtime.status",
      session: "",
      node: expect.objectContaining({
        nodeId: "node-1",
        deviceId: "device-1",
        approvalState: "approved",
      }),
    });
    expect(messages).toContainEqual({ type: "eveng2.node.approval.ready" });
  });

  it("does not treat approved node rows with stale request ids as pending", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "node.list") {
        return {
          nodes: [{
            nodeId: "node-1",
            deviceId: "device-1",
            displayName: "Even G2",
            platform: "even-g2",
            deviceFamily: "glasses",
            approvalState: "approved",
            pendingRequestId: "13cd37a9-2ab9-42d7-9610-1202afcf1b47",
            requestId: "13cd37a9-2ab9-42d7-9610-1202afcf1b47",
            commands: ["canvas.present", "talk.ptt.once"],
          }],
        };
      }
      return {};
    });
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });
    setOpenOperatorSession(gateway, { request });
    Reflect.set(gateway, "nodeApprovalPending", true);

    const refreshNodeApprovalStatus = Reflect.get(gateway, "refreshNodeApprovalStatus");
    if (typeof refreshNodeApprovalStatus !== "function") throw new Error("GatewayDirectTransport.refreshNodeApprovalStatus is unavailable");
    await refreshNodeApprovalStatus.call(gateway);

    expect(messages).toContainEqual({
      type: "eveng2.runtime.status",
      session: "",
      node: expect.objectContaining({
        nodeId: "node-1",
        approvalState: "approved",
      }),
    });
    expect(messages).toContainEqual({ type: "eveng2.node.approval.ready" });
    expect(messages).not.toContainEqual(expect.objectContaining({
      type: "eveng2.node.approval.required",
      nodeId: "node-1",
    }));
  });

  it("refreshes node command approval when the app asks to check again", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "node.list") {
        return {
          nodes: [{
            nodeId: "node-1",
            deviceId: "device-1",
            displayName: "Even G2",
            platform: "even-g2",
            deviceFamily: "glasses",
            approvalState: "approved",
            commands: ["canvas.present", "talk.ptt.once"],
          }],
        };
      }
      return {};
    });
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });
    setOpenOperatorSession(gateway, { request });
    Reflect.set(gateway, "nodeApprovalPending", true);

    const handleAppCommand = Reflect.get(gateway, "handleAppCommand");
    if (typeof handleAppCommand !== "function") throw new Error("GatewayDirectTransport.handleAppCommand is unavailable");
    await handleAppCommand.call(gateway, { type: "eveng2.node.approval.refresh" });

    expect(request).toHaveBeenCalledWith("node.list", {}, 5000);
    expect(messages).toContainEqual({ type: "eveng2.node.approval.ready" });
  });

  it("creates dashboard sessions using the current OpenClaw sessions.create schema", async () => {
    const request = vi.fn(async () => ({
      key: "agent:main:dashboard:new-session",
      sessionKey: "agent:main:dashboard:new-session",
    }));
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });
    setOpenOperatorSession(gateway, { request });
    Reflect.set(gateway, "selectedSessionKey", "agent:main:main");

    const handleAppCommand = Reflect.get(gateway, "handleAppCommand");
    if (typeof handleAppCommand !== "function") throw new Error("GatewayDirectTransport.handleAppCommand is unavailable");
    await handleAppCommand.call(gateway, {
      type: "eveng2.session.create",
      label: "Even G2",
    });

    expect(request).toHaveBeenCalledWith("sessions.create", {
      parentSessionKey: "agent:main:main",
      label: "Even G2",
    });
    expect(request).not.toHaveBeenCalledWith("sessions.create", expect.objectContaining({ kind: expect.anything() }));
    expect(messages).toContainEqual({
      type: "eveng2.session.switch.applied",
      sessionKey: "agent:main:dashboard:new-session",
    });
  });

  it("reports session creation failures without converting them to connection errors", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.create") {
        throw new Error("invalid sessions.create params");
      }
      return {};
    });
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });
    setOpenOperatorSession(gateway, { request });

    const handleAppCommand = Reflect.get(gateway, "handleAppCommand");
    if (typeof handleAppCommand !== "function") throw new Error("GatewayDirectTransport.handleAppCommand is unavailable");
    await handleAppCommand.call(gateway, {
      type: "eveng2.session.create",
      label: "Even G2",
    });

    expect(messages).toContainEqual({
      type: "eveng2.session.create.failed",
      error: "invalid sessions.create params",
    });
    expect(messages).not.toContainEqual({
      type: "error",
      error: "invalid sessions.create params",
    });
  });

  it("requests enough raw history to survive tool-heavy sessions", async () => {
    const request = vi.fn(async () => ({
      sessionKey: "agent:main:main",
      sessionId: "session-1",
      messages: [
        { role: "assistant", content: [{ type: "text", text: "Visible assistant reply" }] },
      ],
    }));
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });
    setOpenOperatorSession(gateway, { request });

    const handleAppCommand = Reflect.get(gateway, "handleAppCommand");
    if (typeof handleAppCommand !== "function") throw new Error("GatewayDirectTransport.handleAppCommand is unavailable");
    await handleAppCommand.call(gateway, {
      type: "eveng2.session.transcript.get",
      sessionKey: "agent:main:main",
    });

    expect(request).toHaveBeenCalledWith("chat.history", {
      sessionKey: "agent:main:main",
      limit: 160,
      maxChars: 96000,
    });
    expect(messages).toContainEqual({
      type: "eveng2.session.transcript.snapshot",
      sessionKey: "agent:main:main",
      sessionId: "session-1",
      messages: [{
        id: "",
        role: "assistant",
        text: "Visible assistant reply",
        timestamp: "",
        provider: "",
        model: "",
      }],
      rawLimit: 160,
      rawCount: 1,
      hasFullHistory: true,
    });
  });
});

describe("Gateway direct voice", () => {
  it("closes an active voice transport when the gateway transport closes", async () => {
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const voice = gateway.createVoiceTransport({
      format: {
        encoding: "pcm_s16le",
        sampleRateHz: 16000,
        channels: 1,
      },
    });
    const closeListener = vi.fn();
    voice.addEventListener("close", closeListener);

    await voice.open?.();
    expect(voice.readyState).toBe(voice.OPEN);

    gateway.close();

    expect(voice.readyState).toBe(voice.CLOSED);
    expect(closeListener).toHaveBeenCalledTimes(1);
  });

  it("emits actionable gateway errors without a generic error event overwrite", () => {
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const errorListener = vi.fn();
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("error", errorListener);
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });

    const fail = Reflect.get(gateway, "fail");
    if (typeof fail !== "function") throw new Error("GatewayDirectTransport.fail is unavailable");
    fail.call(gateway, new Error("device is not approved yet"));

    expect(messages).toContainEqual({ type: "error", error: "device is not approved yet" });
    expect(errorListener).not.toHaveBeenCalled();
  });

  it("preserves Gateway request ids from connect errors", () => {
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });

    const fail = Reflect.get(gateway, "fail");
    if (typeof fail !== "function") throw new Error("GatewayDirectTransport.fail is unavailable");
    fail.call(gateway, new GatewayConnectError("device is not approved yet", {
      details: { requestId: "6fbee43c-5f38-4c2b-b7b1-13c121edf0b5" },
    }));

    expect(messages).toContainEqual({
      type: "error",
      error: "device is not approved yet",
      requestId: "6fbee43c-5f38-4c2b-b7b1-13c121edf0b5",
    });
  });

  it("keeps the node session open when the operator session is not yet authorized", () => {
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const session = { close: vi.fn() };
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });
    Reflect.set(gateway, "nodeSessionOpen", true);
    Reflect.set(gateway, "readyState", gateway.OPEN);
    setOpenOperatorSession(gateway, session);

    const handleOperatorSessionError = Reflect.get(gateway, "handleOperatorSessionError");
    if (typeof handleOperatorSessionError !== "function") throw new Error("GatewayDirectTransport.handleOperatorSessionError is unavailable");
    handleOperatorSessionError.call(gateway, new Error("unauthorized: gateway token missing"), session);

    expect(gateway.readyState).toBe(gateway.CONNECTING);
    expect(gateway.canSendNodeCommandResult()).toBe(true);
    expect(Reflect.get(gateway, "operatorSession")).toBeNull();
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(messages).toContainEqual({
      type: "error",
      error: "unauthorized: gateway token missing",
      pauseReconnect: true,
    });
  });

  it("preserves operator approval request ids while keeping the node session open", () => {
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const session = { close: vi.fn() };
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });
    Reflect.set(gateway, "nodeSessionOpen", true);
    setOpenOperatorSession(gateway, session);

    const handleOperatorSessionError = Reflect.get(gateway, "handleOperatorSessionError");
    if (typeof handleOperatorSessionError !== "function") throw new Error("GatewayDirectTransport.handleOperatorSessionError is unavailable");
    handleOperatorSessionError.call(gateway, new GatewayConnectError("higher role than currently approved", {
      details: { requestId: "6fbee43c-5f38-4c2b-b7b1-13c121edf0b5" },
    }), session);

    expect(gateway.readyState).toBe(gateway.CONNECTING);
    expect(gateway.canSendNodeCommandResult()).toBe(true);
    expect(Reflect.get(gateway, "operatorSession")).toBeNull();
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(messages).toContainEqual({
      type: "error",
      error: "higher role than currently approved",
      requestId: "6fbee43c-5f38-4c2b-b7b1-13c121edf0b5",
      pauseReconnect: true,
    });
  });

  it("retries operator approval without closing the live node session", async () => {
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      storage: new MemoryStorage(),
      token: "",
      WebSocketCtor: FakeGatewayWebSocketCtor,
    });
    const nodeSession = { close: vi.fn() };
    Reflect.set(gateway, "nodeSession", nodeSession);
    Reflect.set(gateway, "nodeSessionOpen", true);
    Reflect.set(gateway, "readyState", gateway.OPEN);
    Reflect.set(gateway, "operatorSession", null);

    expect(gateway.retryOperatorApproval()).toBe(true);

    expect(gateway.readyState).toBe(gateway.CONNECTING);
    expect(gateway.canSendNodeCommandResult()).toBe(true);
    expect(nodeSession.close).not.toHaveBeenCalled();
    expect(Reflect.get(gateway, "operatorSession")).not.toBeNull();
    await expect(gateway.request("sessions.list")).rejects.toThrow("operator session is not connected");
    await vi.waitFor(() => expect(FakeGatewayWebSocket.instances).toHaveLength(1));
  });

  it("closes the transport after transient operator session errors so the app can reconnect", () => {
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const session = { close: vi.fn() };
    const closeListener = vi.fn();
    const messages: Array<Record<string, unknown>> = [];
    gateway.addEventListener("close", closeListener);
    gateway.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });
    Reflect.set(gateway, "nodeSessionOpen", true);
    Reflect.set(gateway, "nodeSession", { close: vi.fn() });
    setOpenOperatorSession(gateway, session);

    const handleOperatorSessionError = Reflect.get(gateway, "handleOperatorSessionError");
    if (typeof handleOperatorSessionError !== "function") throw new Error("GatewayDirectTransport.handleOperatorSessionError is unavailable");
    handleOperatorSessionError.call(gateway, new Error("network blip"), session);

    expect(gateway.readyState).toBe(gateway.CLOSED);
    expect(gateway.canSendNodeCommandResult()).toBe(false);
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(messages).toContainEqual({ type: "error", error: "network blip" });
    expect(messages).not.toContainEqual(expect.objectContaining({ pauseReconnect: true }));
    expect(closeListener).toHaveBeenCalledTimes(1);
    expect((closeListener.mock.calls[0]?.[0] as CloseEvent | undefined)?.reason).toBe("network blip");
  });

  it("sends node command results while only the node session is open", async () => {
    const gateway = new GatewayDirectTransport({
      setupCodeOrUrl: "ws://127.0.0.1:18789",
      token: "",
    });
    const sendRequestFrame = vi.fn();
    Reflect.set(gateway, "nodeSessionOpen", true);
    Reflect.set(gateway, "nodeSession", { sendRequestFrame });
    const nodeInvokeNodeIds = Reflect.get(gateway, "nodeInvokeNodeIds");
    if (!(nodeInvokeNodeIds instanceof Map)) throw new Error("nodeInvokeNodeIds is unavailable");
    nodeInvokeNodeIds.set("cmd-1", "node-even-g2");

    expect(gateway.readyState).toBe(gateway.CONNECTING);
    expect(gateway.canSendNodeCommandResult()).toBe(true);
    gateway.send(JSON.stringify({
      type: "eveng2.node.command.result",
      id: "cmd-1",
      ok: true,
      payload: { connected: true },
    }));

    await vi.waitFor(() => expect(sendRequestFrame).toHaveBeenCalledTimes(1));
    expect(sendRequestFrame).toHaveBeenCalledWith("node.invoke.result", {
      id: "cmd-1",
      nodeId: "node-even-g2",
      ok: true,
      payload: { connected: true },
    });
  });

  it("sends finalized PCM as an OpenClaw audio attachment", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const voice = new GatewayDirectVoiceTransport({
      gateway: {} as never,
      config: {
        sessionKey: "agent:main:main",
        idempotencyKey: "voice-1",
        format: {
          encoding: "pcm_s16le",
          sampleRateHz: 16000,
          channels: 1,
        },
      },
      getSessionKey: () => "agent:main:main",
      request: async (method, params) => {
        calls.push({ method, params: params as Record<string, unknown> });
        return {};
      },
      onClose: () => undefined,
    });
    const messages: Array<Record<string, unknown>> = [];
    voice.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });

    await voice.open();
    voice.send(pcmToneBytes().buffer);
    voice.send(JSON.stringify({ type: "utterance.finalize" }));
    await vi.waitFor(() => expect(calls.some((call) => call.method === "chat.send")).toBe(true));

    const chatSend = calls.find((call) => call.method === "chat.send");
    expect(chatSend?.params).toMatchObject({
      sessionKey: "agent:main:main",
      message: "",
      idempotencyKey: "voice-1",
    });
    const attachments = chatSend?.params?.attachments as Array<Record<string, string>>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      type: "audio",
      mimeType: "audio/wav",
      fileName: "even-g2-voice.wav",
    });
    const wav = atob(attachments[0].content);
    expect(wav.slice(0, 4)).toBe("RIFF");
    expect(wav.slice(8, 12)).toBe("WAVE");
    expect(messages).toContainEqual({
      type: "session.voice.sent",
      sessionKey: "agent:main:main",
      idempotencyKey: "voice-1",
    });
  });

  it("ignores Gateway Talk events for selected-session audio attachment voice", async () => {
    const voice = new GatewayDirectVoiceTransport({
      gateway: {} as never,
      config: {
        format: {
          encoding: "pcm_s16le",
          sampleRateHz: 16000,
          channels: 1,
        },
      },
      getSessionKey: () => "agent:main:main",
      request: async () => ({}),
      onClose: () => undefined,
    });
    const messages: Array<Record<string, unknown>> = [];
    voice.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });

    await voice.open();
    voice.handleTalkEvent({ type: "partial", text: "wrong session text" });
    voice.handleTalkEvent({ type: "transcript", final: true, text: "wrong final text" });
    voice.handleTalkEvent({ type: "error", message: "wrong session error" });

    expect(messages).toEqual([{ type: "transcription.started", transport: "openclaw-audio" }]);
    expect(voice.readyState).toBe(voice.OPEN);
  });

  it("streams PCM through OpenClaw Talk relay and emits a review transcript", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const voice = new GatewayDirectVoiceTransport({
      gateway: {} as never,
      config: {
        transcriptionMode: "talk-relay",
        transcriptionProvider: "openai",
        sessionKey: "agent:main:main",
        targetSessionKey: "agent:main:main",
        idempotencyKey: "voice-talk-1",
        draftTimeoutMs: 5000,
        format: {
          encoding: "pcm_s16le",
          sampleRateHz: 16000,
          channels: 1,
        },
      },
      getSessionKey: () => "agent:main:main",
      request: async (method, params) => {
        calls.push({ method, params: params as Record<string, unknown> });
        if (method === "talk.session.create") {
          return {
            sessionId: "talk-1",
            audio: {
              inputEncoding: "g711_ulaw",
              inputSampleRateHz: 8000,
            },
          };
        }
        return {};
      },
      onClose: () => undefined,
    });
    const messages: Array<Record<string, unknown>> = [];
    voice.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });

    const openPromise = voice.open();
    await vi.waitFor(() => expect(calls.some((call) => call.method === "talk.session.create")).toBe(true));
    voice.handleTalkEvent({ type: "talk.event", payload: { type: "ready", transcriptionSessionId: "talk-1" } });
    await openPromise;
    voice.send(pcmToneBytes().buffer);
    await vi.waitFor(() => expect(calls.some((call) => call.method === "talk.session.appendAudio")).toBe(true));
    voice.handleTalkEvent({ type: "talk.event", payload: { type: "transcript.delta", sessionId: "talk-1", text: "OpenClaw" } });
    voice.send(JSON.stringify({ type: "utterance.finalize" }));
    voice.handleTalkEvent({ type: "talk.event", payload: { type: "transcript.done", sessionId: "talk-1", text: "OpenClawについて説明して。" } });
    await vi.waitFor(() => expect(messages.some((message) => message.type === "voice.draft.ready")).toBe(true), { timeout: 4000 });

    expect(calls[0]).toMatchObject({
      method: "talk.session.create",
      params: {
        sessionKey: "agent:main:main",
        mode: "transcription",
        transport: "gateway-relay",
        brain: "none",
        provider: "openai",
      },
    });
    expect(calls.some((call) => call.method === "talk.session.close")).toBe(true);
    const appendCalls = calls.filter((call) => call.method === "talk.session.appendAudio");
    expect(appendCalls).toHaveLength(2);
    const appendAudio = appendCalls[0];
    expect(appendAudio?.params?.sessionId).toBe("talk-1");
    expect(typeof appendAudio?.params?.audioBase64).toBe("string");
    const encodedAudio = atob(String(appendAudio?.params?.audioBase64));
    expect(encodedAudio.length).toBeGreaterThan(0);
    expect(encodedAudio.length).toBeLessThan(pcmToneBytes().byteLength);
    const trailingSilence = atob(String(appendCalls[1]?.params?.audioBase64));
    expect(trailingSilence.length).toBe(9600);
    expect(calls.indexOf(appendCalls[1]!))
      .toBeLessThan(calls.findIndex((call) => call.method === "talk.session.close"));
    expect(messages).toContainEqual({
      type: "transcript.partial",
      text: "OpenClaw",
      sessionKey: "agent:main:main",
      targetSessionKey: "agent:main:main",
      idempotencyKey: "voice-talk-1",
    });
    expect(messages).toContainEqual({
      type: "voice.draft.ready",
      text: "OpenClawについて説明して。",
      sessionKey: "agent:main:main",
      targetSessionKey: "agent:main:main",
      idempotencyKey: "voice-talk-1",
    });
  });

  it("joins multiple Talk transcript finals into one review draft", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const voice = new GatewayDirectVoiceTransport({
      gateway: {} as never,
      config: {
        transcriptionMode: "talk-relay",
        sessionKey: "agent:main:main",
        targetSessionKey: "agent:main:main",
        idempotencyKey: "voice-talk-multi-final",
        draftTimeoutMs: 3000,
        format: {
          encoding: "pcm_s16le",
          sampleRateHz: 16000,
          channels: 1,
        },
      },
      getSessionKey: () => "agent:main:main",
      request: async (method, params) => {
        calls.push({ method, params: params as Record<string, unknown> });
        if (method === "talk.session.create") return { sessionId: "talk-multi-final-1" };
        return {};
      },
      onClose: () => undefined,
    });
    const messages: Array<Record<string, unknown>> = [];
    voice.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });

    const openPromise = voice.open();
    await vi.waitFor(() => expect(calls.some((call) => call.method === "talk.session.create")).toBe(true));
    voice.handleTalkEvent({ type: "ready", transcriptionSessionId: "talk-multi-final-1" });
    await openPromise;
    voice.handleTalkEvent({
      type: "talk.event",
      payload: {
        type: "transcript.done",
        sessionId: "talk-multi-final-1",
        turnId: "turn-1",
        text: "令和七年七月一日の報告書を作成しました。",
      },
    });
    voice.handleTalkEvent({
      type: "talk.event",
      payload: {
        type: "transcript.delta",
        sessionId: "talk-multi-final-1",
        turnId: "turn-2",
        text: "請求金額は税込み",
      },
    });
    voice.handleTalkEvent({
      type: "talk.event",
      payload: {
        type: "transcript.done",
        sessionId: "talk-multi-final-1",
        turnId: "turn-2",
        text: "請求金額は税込み百二十三万四千五百六十七円です。",
      },
    });
    voice.send(JSON.stringify({ type: "utterance.finalize" }));

    await vi.waitFor(() => expect(messages.some((message) => message.type === "voice.draft.ready")).toBe(true), { timeout: 4000 });
    expect(messages).toContainEqual({
      type: "transcript.final",
      text: "令和七年七月一日の報告書を作成しました。",
      sessionKey: "agent:main:main",
      targetSessionKey: "agent:main:main",
      idempotencyKey: "voice-talk-multi-final",
    });
    expect(messages).toContainEqual({
      type: "transcript.partial",
      text: "令和七年七月一日の報告書を作成しました。 請求金額は税込み",
      sessionKey: "agent:main:main",
      targetSessionKey: "agent:main:main",
      idempotencyKey: "voice-talk-multi-final",
    });
    expect(messages).toContainEqual({
      type: "transcript.final",
      text: "令和七年七月一日の報告書を作成しました。 請求金額は税込み百二十三万四千五百六十七円です。",
      sessionKey: "agent:main:main",
      targetSessionKey: "agent:main:main",
      idempotencyKey: "voice-talk-multi-final",
    });
    expect(messages).toContainEqual({
      type: "voice.draft.ready",
      text: "令和七年七月一日の報告書を作成しました。 請求金額は税込み百二十三万四千五百六十七円です。",
      sessionKey: "agent:main:main",
      targetSessionKey: "agent:main:main",
      idempotencyKey: "voice-talk-multi-final",
    });
  });

  it("does not use Talk response ids as segment replacement keys", () => {
    const voice = new GatewayDirectVoiceTransport({
      gateway: {} as never,
      config: {
        transcriptionMode: "talk-relay",
        sessionKey: "agent:main:main",
        targetSessionKey: "agent:main:main",
        idempotencyKey: "voice-talk-response-id",
        format: {
          encoding: "pcm_s16le",
          sampleRateHz: 16000,
          channels: 1,
        },
      },
      getSessionKey: () => "agent:main:main",
      request: async () => ({}),
      onClose: () => undefined,
    });
    const messages: Array<Record<string, unknown>> = [];
    voice.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });

    voice.handleTalkEvent({
      type: "transcript.done",
      sessionId: "talk-response-id-1",
      responseId: "response-1",
      text: "東京都渋谷区の報告書です。",
    });
    voice.handleTalkEvent({
      type: "transcript.done",
      sessionId: "talk-response-id-1",
      responseId: "response-1",
      text: "請求金額は百二十三万円です。",
    });

    expect(messages.at(-1)).toMatchObject({
      type: "transcript.final",
      text: "東京都渋谷区の報告書です。 請求金額は百二十三万円です。",
    });
  });

  it("preserves repeated unkeyed Talk transcript finals", () => {
    const voice = new GatewayDirectVoiceTransport({
      gateway: {} as never,
      config: {
        transcriptionMode: "talk-relay",
        sessionKey: "agent:main:main",
        targetSessionKey: "agent:main:main",
        idempotencyKey: "voice-talk-repeated-unkeyed",
        format: {
          encoding: "pcm_s16le",
          sampleRateHz: 16000,
          channels: 1,
        },
      },
      getSessionKey: () => "agent:main:main",
      request: async () => ({}),
      onClose: () => undefined,
    });
    const messages: Array<Record<string, unknown>> = [];
    voice.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });

    voice.handleTalkEvent({ type: "transcript.done", sessionId: "talk-repeat-1", text: "はい" });
    voice.handleTalkEvent({ type: "transcript.done", sessionId: "talk-repeat-1", text: "はい" });

    expect(messages.at(-1)).toMatchObject({
      type: "transcript.final",
      text: "はい はい",
    });
  });

  it("preserves unkeyed Talk transcript finals that share a prefix", () => {
    const voice = new GatewayDirectVoiceTransport({
      gateway: {} as never,
      config: {
        transcriptionMode: "talk-relay",
        sessionKey: "agent:main:main",
        targetSessionKey: "agent:main:main",
        idempotencyKey: "voice-talk-prefix-unkeyed",
        format: {
          encoding: "pcm_s16le",
          sampleRateHz: 16000,
          channels: 1,
        },
      },
      getSessionKey: () => "agent:main:main",
      request: async () => ({}),
      onClose: () => undefined,
    });
    const messages: Array<Record<string, unknown>> = [];
    voice.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });

    voice.handleTalkEvent({ type: "transcript.done", sessionId: "talk-prefix-1", text: "はい" });
    voice.handleTalkEvent({ type: "transcript.done", sessionId: "talk-prefix-1", text: "はい、お願いします" });

    expect(messages.at(-1)).toMatchObject({
      type: "transcript.final",
      text: "はい はい、お願いします",
    });
  });

  it("uses partial-only Talk transcript text only as a timeout fallback", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5000);
    const voice = new GatewayDirectVoiceTransport({
      gateway: {} as never,
      config: {
        transcriptionMode: "talk-relay",
        sessionKey: "agent:main:main",
        targetSessionKey: "agent:main:main",
        idempotencyKey: "voice-talk-partial-timeout",
        draftTimeoutMs: 3000,
        format: {
          encoding: "pcm_s16le",
          sampleRateHz: 16000,
          channels: 1,
        },
      },
      getSessionKey: () => "agent:main:main",
      request: async () => ({}),
      onClose: () => undefined,
    });
    const waitForTalkFinalText = Reflect.get(voice, "waitForTalkFinalText");
    if (typeof waitForTalkFinalText !== "function") {
      throw new Error("GatewayDirectVoiceTransport.waitForTalkFinalText is unavailable");
    }
    Reflect.set(voice, "talkPartialText", "暫定 transcript");
    Reflect.set(voice, "talkLastTranscriptEventAtMs", Date.now());

    let settledText = "";
    const waitPromise = (waitForTalkFinalText.call(voice) as Promise<string>).then((text) => {
      settledText = text;
      return text;
    });
    await vi.advanceTimersByTimeAsync(2200);
    expect(settledText).toBe("");
    await vi.advanceTimersByTimeAsync(1000);

    await expect(waitPromise).resolves.toBe("暫定 transcript");
  });

  it("drains Talk transcript events after a slow close response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2000);
    const voice = new GatewayDirectVoiceTransport({
      gateway: {} as never,
      config: {
        transcriptionMode: "talk-relay",
        sessionKey: "agent:main:main",
        targetSessionKey: "agent:main:main",
        idempotencyKey: "voice-talk-slow-close",
        draftTimeoutMs: 3000,
        format: {
          encoding: "pcm_s16le",
          sampleRateHz: 16000,
          channels: 1,
        },
      },
      getSessionKey: () => "agent:main:main",
      request: async () => ({}),
      onClose: () => undefined,
    });
    const addTalkFinalSegment = Reflect.get(voice, "addTalkFinalSegment");
    const waitForTalkFinalText = Reflect.get(voice, "waitForTalkFinalText");
    if (typeof addTalkFinalSegment !== "function" || typeof waitForTalkFinalText !== "function") {
      throw new Error("GatewayDirectVoiceTransport Talk helpers are unavailable");
    }
    addTalkFinalSegment.call(voice, "経済産業省向けの技術検証報告書を作成しました。", "turn-1");
    Reflect.set(voice, "talkLastTranscriptEventAtMs", 0);
    Reflect.set(voice, "talkCloseRequestedAtMs", 0);

    let settledText = "";
    const waitPromise = (waitForTalkFinalText.call(voice) as Promise<string>).then((text) => {
      settledText = text;
      return text;
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(settledText).toBe("");

    addTalkFinalSegment.call(voice, "確定 transcript を複数の区間として連結します。", "turn-2");
    Reflect.set(voice, "talkLastTranscriptEventAtMs", Date.now());
    await vi.advanceTimersByTimeAsync(900);

    await expect(waitPromise).resolves.toBe(
      "経済産業省向けの技術検証報告書を作成しました。 確定 transcript を複数の区間として連結します。",
    );
  });

  it("includes Talk transcript finals that arrive while closing the session", async () => {
    const close = deferred<Record<string, never>>();
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const voice = new GatewayDirectVoiceTransport({
      gateway: {} as never,
      config: {
        transcriptionMode: "talk-relay",
        sessionKey: "agent:main:main",
        targetSessionKey: "agent:main:main",
        idempotencyKey: "voice-talk-close-final",
        draftTimeoutMs: 3000,
        format: {
          encoding: "pcm_s16le",
          sampleRateHz: 16000,
          channels: 1,
        },
      },
      getSessionKey: () => "agent:main:main",
      request: async (method, params) => {
        calls.push({ method, params: params as Record<string, unknown> });
        if (method === "talk.session.create") return { sessionId: "talk-close-final-1" };
        if (method === "talk.session.close") return close.promise;
        return {};
      },
      onClose: () => undefined,
    });
    const messages: Array<Record<string, unknown>> = [];
    voice.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });

    const openPromise = voice.open();
    await vi.waitFor(() => expect(calls.some((call) => call.method === "talk.session.create")).toBe(true));
    voice.handleTalkEvent({ type: "ready", transcriptionSessionId: "talk-close-final-1" });
    await openPromise;
    voice.handleTalkEvent({
      type: "transcript.done",
      sessionId: "talk-close-final-1",
      turnId: "turn-1",
      text: "経済産業省向けの技術検証報告書を作成しました。",
    });
    voice.send(JSON.stringify({ type: "utterance.finalize" }));
    await vi.waitFor(() => expect(calls.some((call) => call.method === "talk.session.close")).toBe(true));
    voice.handleTalkEvent({
      type: "transcript.done",
      sessionId: "talk-close-final-1",
      turnId: "turn-2",
      text: "確定 transcript を複数の区間として連結してから表示してください。",
    });
    close.resolve({});

    await vi.waitFor(() => expect(messages.some((message) => message.type === "voice.draft.ready")).toBe(true), { timeout: 4000 });
    expect(messages).toContainEqual({
      type: "voice.draft.ready",
      text: "経済産業省向けの技術検証報告書を作成しました。 確定 transcript を複数の区間として連結してから表示してください。",
      sessionKey: "agent:main:main",
      targetSessionKey: "agent:main:main",
      idempotencyKey: "voice-talk-close-final",
    });
  });

  it("emits final transcript text for Talk relay voice without a target session", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const voice = new GatewayDirectVoiceTransport({
      gateway: {} as never,
      config: {
        transcriptionMode: "talk-relay",
        sessionKey: "agent:main:main",
        idempotencyKey: "node-voice-1",
        draftTimeoutMs: 5000,
        format: {
          encoding: "pcm_s16le",
          sampleRateHz: 16000,
          channels: 1,
        },
      },
      getSessionKey: () => "agent:main:main",
      request: async (method, params) => {
        calls.push({ method, params: params as Record<string, unknown> });
        if (method === "talk.session.create") {
          return {
            sessionId: "talk-node-1",
            audio: {
              inputEncoding: "g711_ulaw",
              inputSampleRateHz: 8000,
            },
          };
        }
        return {};
      },
      onClose: () => undefined,
    });
    const messages: Array<Record<string, unknown>> = [];
    voice.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });

    const openPromise = voice.open();
    await vi.waitFor(() => expect(calls.some((call) => call.method === "talk.session.create")).toBe(true));
    voice.handleTalkEvent({ type: "ready", transcriptionSessionId: "talk-node-1" });
    await openPromise;
    voice.send(pcmToneBytes().buffer);
    voice.send(JSON.stringify({ type: "utterance.finalize" }));
    voice.handleTalkEvent({ type: "transcript.done", sessionId: "talk-node-1", text: "Node transcript" });

    await vi.waitFor(() => expect(messages.some((message) => message.type === "transcript.final")).toBe(true), { timeout: 4000 });
    expect(messages).toContainEqual({
      type: "transcript.final",
      text: "Node transcript",
      sessionKey: "agent:main:main",
      idempotencyKey: "node-voice-1",
    });
    expect(messages.some((message) => message.type === "voice.draft.ready")).toBe(false);
  });

  it("best-effort cancels an active OpenClaw Talk session when the voice transport is closed", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const voice = new GatewayDirectVoiceTransport({
      gateway: {} as never,
      config: {
        transcriptionMode: "talk-relay",
        sessionKey: "agent:main:main",
        idempotencyKey: "voice-talk-close",
        format: {
          encoding: "pcm_s16le",
          sampleRateHz: 16000,
          channels: 1,
        },
      },
      getSessionKey: () => "agent:main:main",
      request: async (method, params) => {
        calls.push({ method, params: params as Record<string, unknown> });
        if (method === "talk.session.create") return { sessionId: "talk-close-1" };
        return {};
      },
      onClose: () => undefined,
    });

    const openPromise = voice.open();
    await vi.waitFor(() => expect(calls.some((call) => call.method === "talk.session.create")).toBe(true));
    voice.handleTalkEvent({ type: "ready", transcriptionSessionId: "talk-close-1" });
    await openPromise;
    voice.close();

    await vi.waitFor(() => expect(calls.some((call) => call.method === "talk.session.cancelTurn")).toBe(true));
    expect(calls.filter((call) => call.method === "talk.session.cancelTurn")).toHaveLength(1);
    expect(calls.find((call) => call.method === "talk.session.cancelTurn")?.params).toEqual({
      sessionId: "talk-close-1",
      reason: "client-cancelled",
    });
  });

  it("cancels promptly when closed after Talk session creation but before provider ready", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const openListener = vi.fn();
    const voice = new GatewayDirectVoiceTransport({
      gateway: {} as never,
      config: {
        transcriptionMode: "talk-relay",
        sessionKey: "agent:main:main",
        idempotencyKey: "voice-talk-cancel-before-ready",
        format: {
          encoding: "pcm_s16le",
          sampleRateHz: 16000,
          channels: 1,
        },
      },
      getSessionKey: () => "agent:main:main",
      request: async (method, params) => {
        calls.push({ method, params: params as Record<string, unknown> });
        if (method === "talk.session.create") return { sessionId: "talk-cancel-before-ready-1" };
        return {};
      },
      onClose: () => undefined,
    });
    voice.addEventListener("open", openListener);

    const openPromise = voice.open();
    await vi.waitFor(() => expect(calls.some((call) => call.method === "talk.session.create")).toBe(true));
    voice.close();
    await openPromise;

    await vi.waitFor(() => expect(calls.some((call) => call.method === "talk.session.cancelTurn")).toBe(true));
    expect(openListener).not.toHaveBeenCalled();
    expect(calls.find((call) => call.method === "talk.session.cancelTurn")?.params).toEqual({
      sessionId: "talk-cancel-before-ready-1",
      reason: "client-cancelled",
    });
  });

  it("surfaces Talk provider errors that arrive before ready", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const openListener = vi.fn();
    const messages: Array<Record<string, unknown>> = [];
    const voice = new GatewayDirectVoiceTransport({
      gateway: {} as never,
      config: {
        transcriptionMode: "talk-relay",
        sessionKey: "agent:main:main",
        idempotencyKey: "voice-talk-provider-error",
        format: {
          encoding: "pcm_s16le",
          sampleRateHz: 16000,
          channels: 1,
        },
      },
      getSessionKey: () => "agent:main:main",
      request: async (method, params) => {
        calls.push({ method, params: params as Record<string, unknown> });
        if (method === "talk.session.create") return { sessionId: "talk-provider-error-1" };
        return {};
      },
      onClose: () => undefined,
    });
    voice.addEventListener("open", openListener);
    voice.addEventListener("message", (event) => {
      messages.push(JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>);
    });

    const openPromise = voice.open();
    await vi.waitFor(() => expect(calls.some((call) => call.method === "talk.session.create")).toBe(true));
    voice.handleTalkEvent({
      type: "error",
      transcriptionSessionId: "talk-provider-error-1",
      message: "provider credentials rejected",
    });
    await openPromise;

    expect(openListener).not.toHaveBeenCalled();
    expect(messages).toContainEqual({
      type: "transcription.failed",
      code: "TRANSCRIPTION_FAILED",
      error: "provider credentials rejected",
    });
    expect(voice.readyState).toBe(voice.CLOSED);
  });

  it("orders best-effort Talk cancel after in-flight audio append", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    let resolveAppend: () => void = () => undefined;
    const appendPromise = new Promise<void>((resolve) => {
      resolveAppend = resolve;
    });
    const voice = new GatewayDirectVoiceTransport({
      gateway: {} as never,
      config: {
        transcriptionMode: "talk-relay",
        sessionKey: "agent:main:main",
        idempotencyKey: "voice-talk-close-order",
        format: {
          encoding: "pcm_s16le",
          sampleRateHz: 16000,
          channels: 1,
        },
      },
      getSessionKey: () => "agent:main:main",
      request: async (method, params) => {
        calls.push({ method, params: params as Record<string, unknown> });
        if (method === "talk.session.create") return { sessionId: "talk-close-order-1" };
        if (method === "talk.session.appendAudio") return appendPromise;
        return {};
      },
      onClose: () => undefined,
    });

    const openPromise = voice.open();
    await vi.waitFor(() => expect(calls.some((call) => call.method === "talk.session.create")).toBe(true));
    voice.handleTalkEvent({ type: "ready", transcriptionSessionId: "talk-close-order-1" });
    await openPromise;
    voice.send(pcmToneBytes().buffer);
    await vi.waitFor(() => expect(calls.some((call) => call.method === "talk.session.appendAudio")).toBe(true));
    voice.close();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls.some((call) => call.method === "talk.session.cancelTurn")).toBe(false);
    resolveAppend();
    await vi.waitFor(() => expect(calls.some((call) => call.method === "talk.session.cancelTurn")).toBe(true));
    expect(calls.find((call) => call.method === "talk.session.cancelTurn")?.params).toEqual({
      sessionId: "talk-close-order-1",
      reason: "client-cancelled",
    });
  });

  it("cancels a Talk session that is created after the user cancels during open", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    let resolveCreate: (value: { sessionId: string }) => void = () => undefined;
    const createPromise = new Promise<{ sessionId: string }>((resolve) => {
      resolveCreate = resolve;
    });
    const openListener = vi.fn();
    const voice = new GatewayDirectVoiceTransport({
      gateway: {} as never,
      config: {
        transcriptionMode: "talk-relay",
        sessionKey: "agent:main:main",
        idempotencyKey: "voice-talk-cancel-open",
        format: {
          encoding: "pcm_s16le",
          sampleRateHz: 16000,
          channels: 1,
        },
      },
      getSessionKey: () => "agent:main:main",
      request: async (method, params) => {
        calls.push({ method, params: params as Record<string, unknown> });
        if (method === "talk.session.create") return createPromise;
        return {};
      },
      onClose: () => undefined,
    });
    voice.addEventListener("open", openListener);

    const openPromise = voice.open();
    await vi.waitFor(() => expect(calls.some((call) => call.method === "talk.session.create")).toBe(true));
    voice.close();
    resolveCreate({ sessionId: "talk-cancel-open-1" });
    await openPromise;

    await vi.waitFor(() => expect(calls.some((call) => call.method === "talk.session.cancelTurn")).toBe(true));
    expect(openListener).not.toHaveBeenCalled();
    expect(calls.find((call) => call.method === "talk.session.cancelTurn")?.params).toEqual({
      sessionId: "talk-cancel-open-1",
      reason: "client-cancelled",
    });
  });
});
