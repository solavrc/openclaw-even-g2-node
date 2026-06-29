import { DeviceConnectType, DeviceInfo, DeviceModel, DeviceStatus } from "@evenrealities/even_hub_sdk";
import { describe, expect, it } from "vitest";
import { serializableDeviceInfo, serializableDeviceStatus } from "./even-device-status";

describe("serializableDeviceStatus", () => {
  it("returns null without device status", () => {
    expect(serializableDeviceStatus(null)).toBeNull();
  });

  it("normalizes Even Hub status into plain JSON", () => {
    const status = new DeviceStatus({
      sn: "",
      connectType: DeviceConnectType.None,
      batteryLevel: 125,
      isCharging: true,
      isWearing: false,
      isInCase: undefined,
    });

    expect(serializableDeviceStatus(status)).toEqual({
      sn: null,
      connectType: "none",
      batteryLevel: 125,
      batteryLevelPercent: 125,
      battery: {
        level: 1,
        levelPercent: 125,
        charging: true,
      },
      isCharging: true,
      isWearing: false,
      isInCase: false,
    });
  });
});

describe("serializableDeviceInfo", () => {
  it("includes model, serial, status, and device family helpers", () => {
    const status = new DeviceStatus({
      sn: "G2-1",
      connectType: DeviceConnectType.Connected,
      batteryLevel: 52,
      isCharging: false,
      isWearing: true,
      isInCase: false,
    });
    const info = new DeviceInfo({
      model: DeviceModel.G2,
      sn: "G2-1",
      status,
    });

    expect(serializableDeviceInfo(info)).toMatchObject({
      model: DeviceModel.G2,
      sn: "G2-1",
      isGlasses: true,
      isRing: false,
      status: {
        batteryLevel: 52,
        battery: {
          level: 0.52,
        },
      },
    });
  });
});
