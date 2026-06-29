export type GlassInputAction = "click" | "doubleClick" | "up" | "down";

type GlassEventLike = {
  textEvent?: { eventType?: unknown };
  listEvent?: { eventType?: unknown; containerName?: unknown; containerID?: unknown };
  sysEvent?: { eventType?: unknown; eventSource?: unknown };
};

function normalizedEventType(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  if (normalized === "CLICK" || normalized === "CLICK_EVENT") return 0;
  if (normalized === "SCROLL_TOP" || normalized === "SCROLL_TOP_EVENT") return 1;
  if (normalized === "SCROLL_BOTTOM" || normalized === "SCROLL_BOTTOM_EVENT") return 2;
  if (normalized === "DOUBLE_CLICK" || normalized === "DOUBLE_CLICK_EVENT") return 3;
  return undefined;
}

export function glassInputActionFromEvent(event: GlassEventLike): GlassInputAction | null {
  const eventType = normalizedEventType(event.textEvent?.eventType)
    ?? normalizedEventType(event.listEvent?.eventType)
    ?? normalizedEventType(event.sysEvent?.eventType);
  if (eventType === 0) return "click";
  if (eventType === 1) return "up";
  if (eventType === 2) return "down";
  if (eventType === 3) return "doubleClick";

  // The Even Hub simulator reports list selection taps as a listEvent without
  // an eventType. Treat that as selecting the current row.
  if (event.listEvent) return "click";

  // The Even Hub simulator and some runtime builds can report tap as a
  // source-only sys event. Treat source-only touch events as a plain tap.
  if (event.sysEvent?.eventSource === 1 || event.sysEvent?.eventSource === 2 || event.sysEvent?.eventSource === 3) return "click";
  return null;
}
