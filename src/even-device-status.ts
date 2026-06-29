import type { DeviceInfo, DeviceStatus } from "@evenrealities/even_hub_sdk";

export function serializableDeviceStatus(status: DeviceStatus | null) {
  if (!status) return null;
  const batteryLevel = typeof status.batteryLevel === "number" ? status.batteryLevel : null;
  return {
    sn: status.sn || null,
    connectType: status.connectType || "none",
    batteryLevel,
    batteryLevelPercent: batteryLevel,
    battery: batteryLevel === null
      ? null
      : {
          level: Math.max(0, Math.min(100, batteryLevel)) / 100,
          levelPercent: batteryLevel,
          charging: status.isCharging ?? null,
        },
    isCharging: status.isCharging ?? null,
    isWearing: status.isWearing ?? null,
    isInCase: status.isInCase ?? null,
  };
}

export function serializableDeviceInfo(info: DeviceInfo | null) {
  if (!info) return null;
  return {
    model: info.model,
    sn: info.sn || null,
    status: serializableDeviceStatus(info.status),
    isGlasses: info.isGlasses(),
    isRing: info.isRing(),
  };
}
