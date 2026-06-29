import { describe, expect, it, vi } from "vitest";
import { attachGuardedVoiceTransportListeners } from "./voice-transport-controller";
import type { VoiceTransportEventSource } from "./voice-transport-controller";

type VoiceEventType = "open" | "message" | "close" | "error";

class FakeVoiceTransportEventSource implements VoiceTransportEventSource {
  private listeners = new Map<VoiceEventType, EventListener>();

  addEventListener(type: VoiceEventType, listener: EventListener) {
    this.listeners.set(type, listener);
  }

  async emit(type: VoiceEventType, event: Event = new Event(type)) {
    await this.listeners.get(type)?.(event);
  }
}

describe("attachGuardedVoiceTransportListeners", () => {
  it("routes voice transport events when the transport generation is current", async () => {
    const source = new FakeVoiceTransportEventSource();
    const handlers = {
      isCurrent: vi.fn(() => true),
      onOpen: vi.fn(async () => undefined),
      onMessage: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn(),
    };
    attachGuardedVoiceTransportListeners(source, handlers);
    const messageEvent = new MessageEvent("message", { data: "payload" });

    await source.emit("open");
    await source.emit("message", messageEvent);
    await source.emit("close");
    await source.emit("error");

    expect(handlers.isCurrent).toHaveBeenCalledTimes(4);
    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
    expect(handlers.onMessage).toHaveBeenCalledWith(messageEvent);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(handlers.onError).toHaveBeenCalledTimes(1);
  });

  it("ignores stale voice transport events", async () => {
    const source = new FakeVoiceTransportEventSource();
    const handlers = {
      isCurrent: vi.fn(() => false),
      onOpen: vi.fn(),
      onMessage: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn(),
    };
    attachGuardedVoiceTransportListeners(source, handlers);

    await source.emit("open");
    await source.emit("message", new MessageEvent("message"));
    await source.emit("close");
    await source.emit("error");

    expect(handlers.isCurrent).toHaveBeenCalledTimes(4);
    expect(handlers.onOpen).not.toHaveBeenCalled();
    expect(handlers.onMessage).not.toHaveBeenCalled();
    expect(handlers.onClose).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
  });
});
