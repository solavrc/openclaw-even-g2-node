import type { AppImageAsset } from "@evenrealities/even_hub_sdk";
import { describe, expect, it } from "vitest";
import {
  imageAssetDataUrl,
  setupQrCameraConstraints,
  setupQrCameraOpenFailedMessage,
  setupQrCameraUnavailableMessage,
  setupQrImageDecodePlans,
  setupQrVideoDecodeSize,
} from "./setup-qr-scanner";

describe("imageAssetDataUrl", () => {
  it("passes through data URLs", () => {
    expect(imageAssetDataUrl({
      base64: " data:image/png;base64,abc ",
      mimeType: "image/jpeg",
      name: "qr.png",
      path: "",
      size: 3,
    } satisfies AppImageAsset)).toBe("data:image/png;base64,abc");
  });

  it("wraps raw base64 with the asset mime type", () => {
    expect(imageAssetDataUrl({
      base64: "abc",
      mimeType: "image/png",
      name: "qr.png",
      path: "",
      size: 3,
    } satisfies AppImageAsset)).toBe("data:image/png;base64,abc");
  });
});

describe("setupQrImageDecodePlans", () => {
  it("tries full-frame and centered crops across all rotations", () => {
    const plans = setupQrImageDecodePlans(2000, 1000);

    expect(plans).toHaveLength(20);
    expect(plans[0]).toMatchObject({
      sourceX: 0,
      sourceY: 0,
      cropWidth: 2000,
      cropHeight: 1000,
      rotation: 0,
      targetWidth: 1800,
      targetHeight: 900,
    });
    expect(plans[1]).toMatchObject({
      rotation: 90,
      targetWidth: 900,
      targetHeight: 1800,
    });
    expect(plans[4]).toMatchObject({
      sourceX: 100,
      sourceY: 50,
      cropWidth: 1800,
      cropHeight: 900,
      rotation: 0,
      targetWidth: 1800,
      targetHeight: 900,
    });
  });

  it("rejects images without dimensions", () => {
    expect(() => setupQrImageDecodePlans(0, 100)).toThrow("Could not inspect QR image.");
  });
});

describe("setup QR camera helpers", () => {
  it("requests the environment camera at a bounded preview size", () => {
    expect(setupQrCameraConstraints()).toEqual({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
  });

  it("uses Even Hub camera fallback messaging when native capture exists", () => {
    expect(setupQrCameraUnavailableMessage(true)).toBe("Use Even Hub camera to scan the setup QR.");
    expect(setupQrCameraOpenFailedMessage("denied", true)).toBe("Use Even Hub camera to scan the setup QR.");
    expect(setupQrCameraUnavailableMessage(false)).toBe("Camera preview is unavailable in this WebView. Use the setup field below.");
    expect(setupQrCameraOpenFailedMessage("denied", false)).toBe("Camera could not open. denied");
  });

  it("bounds live video decode size without upscaling", () => {
    expect(setupQrVideoDecodeSize(1920, 1080)).toEqual({ width: 960, height: 540 });
    expect(setupQrVideoDecodeSize(640, 480)).toEqual({ width: 640, height: 480 });
    expect(setupQrVideoDecodeSize(0, 480)).toEqual({ width: 0, height: 0 });
  });
});
