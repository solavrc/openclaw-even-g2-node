export type VoiceTransportEventHandlers = {
  isCurrent: () => boolean;
  onOpen: () => Promise<void> | void;
  onMessage: (event: MessageEvent) => void;
  onClose: () => void;
  onError: () => void;
};

export type VoiceTransportEventSource = {
  addEventListener(type: "open" | "message" | "close" | "error", listener: EventListener): void;
};

export function attachGuardedVoiceTransportListeners(
  voiceWs: VoiceTransportEventSource,
  handlers: VoiceTransportEventHandlers,
) {
  voiceWs.addEventListener("open", (async () => {
    if (!handlers.isCurrent()) return;
    await handlers.onOpen();
  }) as EventListener);
  voiceWs.addEventListener("message", ((event: Event) => {
    if (!handlers.isCurrent()) return;
    handlers.onMessage(event as MessageEvent);
  }) as EventListener);
  voiceWs.addEventListener("close", () => {
    if (!handlers.isCurrent()) return;
    handlers.onClose();
  });
  voiceWs.addEventListener("error", () => {
    if (!handlers.isCurrent()) return;
    handlers.onError();
  });
}
