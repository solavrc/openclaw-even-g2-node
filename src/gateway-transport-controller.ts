export type GatewayTransportEventHandlers = {
  isCurrent: () => boolean;
  onOpen: () => void;
  onClose: (event: Event) => void;
  onError: () => void;
  onMessage: (event: MessageEvent) => void;
};

export type GatewayTransportEventSource = {
  addEventListener(type: "open" | "close" | "error" | "message", listener: EventListener): void;
};

export function attachCurrentGatewayTransportListeners(
  transport: GatewayTransportEventSource,
  handlers: GatewayTransportEventHandlers,
) {
  transport.addEventListener("open", () => {
    if (!handlers.isCurrent()) return;
    handlers.onOpen();
  });
  transport.addEventListener("close", (event) => {
    if (!handlers.isCurrent()) return;
    handlers.onClose(event);
  });
  transport.addEventListener("error", () => {
    if (!handlers.isCurrent()) return;
    handlers.onError();
  });
  transport.addEventListener("message", ((event: Event) => {
    if (!handlers.isCurrent()) return;
    handlers.onMessage(event as MessageEvent);
  }) as EventListener);
}
