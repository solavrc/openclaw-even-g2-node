import { afterEach, describe, expect, it, vi } from "vitest";
import { activateKeepAlive, deactivateKeepAlive, keepAliveState, resetKeepAliveForTests } from "./keep-alive";

class FakeAudioContext extends EventTarget {
  readonly destination = {};
  state = "running";
  createOscillator() {
    return {
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
  }
  createGain() {
    return {
      gain: { value: 0 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
}

describe("keep-alive", () => {
  afterEach(() => {
    resetKeepAliveForTests();
    vi.unstubAllGlobals();
  });

  it("activates quiet audio and requests a Web Lock when supported", async () => {
    const lockRequest = vi.fn((_name: string, _options: unknown, callback: () => Promise<void>) => {
      return callback();
    });
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("navigator", { locks: { request: lockRequest } });

    const state = activateKeepAlive("test-lock");
    await Promise.resolve();

    expect(state.audio).toBe("active");
    const [name, options, callback] = lockRequest.mock.calls[0] || [];
    expect(name).toBe("test-lock");
    expect(options).toEqual({ mode: "exclusive" });
    expect(typeof callback).toBe("function");
    expect(keepAliveState().lock).toBe("active");
  });

  it("releases the Web Lock during teardown", async () => {
    let lockPromise: Promise<void> | undefined;
    const lockRequest = vi.fn((_name: string, _options: unknown, callback: () => Promise<void>) => {
      lockPromise = callback();
      return lockPromise;
    });
    vi.stubGlobal("navigator", { locks: { request: lockRequest } });

    activateKeepAlive("test-lock");
    await Promise.resolve();
    expect(keepAliveState().lock).toBe("active");

    deactivateKeepAlive();
    await lockPromise;

    expect(keepAliveState().lock).toBe("inactive");
  });

  it("reports unsupported capabilities without throwing", () => {
    vi.stubGlobal("navigator", {});

    const state = activateKeepAlive();

    expect(state.audio).toBe("unsupported");
    expect(state.lock).toBe("unsupported");
  });

  it("allows a later audio retry after an initial activation failure", () => {
    class FailingAudioContext {
      constructor() {
        throw new Error("gesture required");
      }
    }
    vi.stubGlobal("AudioContext", FailingAudioContext);
    vi.stubGlobal("navigator", {});

    expect(activateKeepAlive().audio).toBe("failed");

    vi.stubGlobal("AudioContext", FakeAudioContext);

    expect(activateKeepAlive().audio).toBe("active");
  });
});
