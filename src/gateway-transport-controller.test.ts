import { describe, expect, it, vi } from "vitest";
import { attachCurrentGatewayTransportListeners } from "./gateway-transport-controller";
import type { GatewayTransportEventSource } from "./gateway-transport-controller";

type GatewayEventType = "open" | "close" | "error" | "message";

class FakeGatewayTransportEventSource implements GatewayTransportEventSource {
  private listeners = new Map<GatewayEventType, EventListener>();

  addEventListener(type: GatewayEventType, listener: EventListener) {
    this.listeners.set(type, listener);
  }

  emit(type: GatewayEventType, event: Event = new Event(type)) {
    this.listeners.get(type)?.(event);
  }
}

describe("attachCurrentGatewayTransportListeners", () => {
  it("routes events while the transport is current", () => {
    const source = new FakeGatewayTransportEventSource();
    const handlers = {
      isCurrent: vi.fn(() => true),
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn(),
      onMessage: vi.fn(),
    };
    attachCurrentGatewayTransportListeners(source, handlers);
    const closeEvent = new Event("close");
    const messageEvent = new MessageEvent("message", { data: "payload" });

    source.emit("open");
    source.emit("close", closeEvent);
    source.emit("error");
    source.emit("message", messageEvent);

    expect(handlers.isCurrent).toHaveBeenCalledTimes(4);
    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledWith(closeEvent);
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(handlers.onMessage).toHaveBeenCalledWith(messageEvent);
  });

  it("ignores stale transport events", () => {
    const source = new FakeGatewayTransportEventSource();
    const handlers = {
      isCurrent: vi.fn(() => false),
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn(),
      onMessage: vi.fn(),
    };
    attachCurrentGatewayTransportListeners(source, handlers);

    source.emit("open");
    source.emit("close");
    source.emit("error");
    source.emit("message", new MessageEvent("message"));

    expect(handlers.isCurrent).toHaveBeenCalledTimes(4);
    expect(handlers.onOpen).not.toHaveBeenCalled();
    expect(handlers.onClose).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
    expect(handlers.onMessage).not.toHaveBeenCalled();
  });
});
