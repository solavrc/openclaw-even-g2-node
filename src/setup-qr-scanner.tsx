import { useEffect, useRef, useState } from "react";
import type { AppImageAsset } from "@evenrealities/even_hub_sdk";
import { setupCodeFromQrValue } from "./setup-code";
import styles from "./App.module.css";

type BarcodeDetectorShape = {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue?: string; displayValue?: string }>>;
};

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorShape;

type BarcodeDetectorGlobal = typeof globalThis & {
  BarcodeDetector?: BarcodeDetectorConstructor;
};

let jsQrModulePromise: Promise<typeof import("jsqr")> | null = null;
const QR_IMAGE_CROP_FRACTIONS = [1, 0.9, 0.76, 0.62, 0.48] as const;
const QR_IMAGE_ROTATIONS = [0, 90, 180, 270] as const;
const QR_IMAGE_MAX_DECODE_DIMENSION = 1800;
const QR_VIDEO_MAX_DECODE_DIMENSION = 960;
type SetupQrPreviewState = "starting" | "live" | "unavailable";

async function loadJsQr() {
  jsQrModulePromise ??= import("jsqr");
  return (await jsQrModulePromise).default;
}

export function imageAssetDataUrl(asset: AppImageAsset) {
  const base64 = asset.base64.trim();
  if (base64.startsWith("data:")) return base64;
  return `data:${asset.mimeType || "image/jpeg"};base64,${base64}`;
}

export function setupQrImageDecodePlans(sourceWidth: number, sourceHeight: number) {
  if (!sourceWidth || !sourceHeight) throw new Error("Could not inspect QR image.");
  return QR_IMAGE_CROP_FRACTIONS.flatMap((cropFraction) => {
    const cropWidth = Math.max(1, Math.floor(sourceWidth * cropFraction));
    const cropHeight = Math.max(1, Math.floor(sourceHeight * cropFraction));
    const sourceX = Math.floor((sourceWidth - cropWidth) / 2);
    const sourceY = Math.floor((sourceHeight - cropHeight) / 2);
    return QR_IMAGE_ROTATIONS.map((rotation) => {
      const rotated = rotation === 90 || rotation === 270;
      const scale = Math.min(1, QR_IMAGE_MAX_DECODE_DIMENSION / Math.max(cropWidth, cropHeight));
      return {
        sourceX,
        sourceY,
        cropWidth,
        cropHeight,
        rotation,
        scale,
        targetWidth: Math.max(1, Math.floor((rotated ? cropHeight : cropWidth) * scale)),
        targetHeight: Math.max(1, Math.floor((rotated ? cropWidth : cropHeight) * scale)),
      };
    });
  });
}

export function setupQrCameraConstraints(): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  };
}

export function setupQrCameraUnavailableMessage(hasNativeCapture: boolean) {
  return hasNativeCapture
    ? "Use Even Hub camera to scan the setup QR."
    : "Camera preview is unavailable in this WebView. Use the setup field below.";
}

export function setupQrCameraOpenFailedMessage(errorText: string, hasNativeCapture: boolean) {
  return hasNativeCapture
    ? "Use Even Hub camera to scan the setup QR."
    : `Camera could not open. ${errorText}`;
}

export function setupQrVideoDecodeSize(width: number, height: number) {
  if (!width || !height) return { width: 0, height: 0 };
  const scale = Math.min(1, QR_VIDEO_MAX_DECODE_DIMENSION / Math.max(width, height));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

async function detectWithBarcodeDetector(video: HTMLVideoElement) {
  const BarcodeDetector = (globalThis as BarcodeDetectorGlobal).BarcodeDetector;
  if (!BarcodeDetector) return "";
  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  const codes = await detector.detect(video);
  return codes.find((code) => code.rawValue || code.displayValue)?.rawValue
    || codes.find((code) => code.rawValue || code.displayValue)?.displayValue
    || "";
}

async function detectWithJsQr(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  const size = setupQrVideoDecodeSize(video.videoWidth, video.videoHeight);
  if (!size.width || !size.height) return "";
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return "";
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const jsQR = await loadJsQr();
  return jsQR(pixels.data, pixels.width, pixels.height, {
    inversionAttempts: "attemptBoth",
  })?.data.trim() || "";
}

async function detectSetupQrFromVideo(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  const barcodeDetectorResult = await detectWithBarcodeDetector(video);
  return setupCodeFromQrValue(barcodeDetectorResult || await detectWithJsQr(video, canvas));
}

function useSetupQrScanner({
  hasNativeCapture,
  onSetupCode,
}: {
  hasNativeCapture: boolean;
  onSetupCode: (setupCode: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stoppedRef = useRef(false);
  const [message, setMessage] = useState("Starting camera...");
  const [previewState, setPreviewState] = useState<SetupQrPreviewState>("starting");

  useEffect(() => {
    const canvas = document.createElement("canvas");
    let timer: number | null = null;
    stoppedRef.current = false;

    function stopStream() {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    async function tick() {
      if (stoppedRef.current) return;
      const video = videoRef.current;
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        timer = window.setTimeout(() => void tick(), 160);
        return;
      }
      try {
        const detected = await detectSetupQrFromVideo(video, canvas);
        if (detected) {
          stoppedRef.current = true;
          stopStream();
          onSetupCode(detected);
          return;
        }
        setMessage("Looking for an OpenClaw setup QR...");
      } catch {
        setMessage("Looking for an OpenClaw setup QR...");
      }
      timer = window.setTimeout(() => void tick(), 180);
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPreviewState("unavailable");
        setMessage(setupQrCameraUnavailableMessage(hasNativeCapture));
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia(setupQrCameraConstraints());
        if (stoppedRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setPreviewState("live");
        setMessage("Point the camera at the OpenClaw setup QR.");
        await tick();
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        setPreviewState("unavailable");
        setMessage(setupQrCameraOpenFailedMessage(text, hasNativeCapture));
      }
    }

    void start();
    return () => {
      stoppedRef.current = true;
      stopStream();
    };
  }, [hasNativeCapture, onSetupCode]);

  return { message, previewState, videoRef };
}

export async function decodeSetupQrFromImage(asset: AppImageAsset) {
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Could not read QR image."));
  });
  image.src = imageAssetDataUrl(asset);
  await loaded;
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  for (const plan of setupQrImageDecodePlans(sourceWidth, sourceHeight)) {
    const canvas = document.createElement("canvas");
    canvas.width = plan.targetWidth;
    canvas.height = plan.targetHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) continue;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.translate(plan.targetWidth / 2, plan.targetHeight / 2);
    context.rotate((plan.rotation * Math.PI) / 180);
    context.drawImage(
      image,
      plan.sourceX,
      plan.sourceY,
      plan.cropWidth,
      plan.cropHeight,
      -(plan.cropWidth * plan.scale) / 2,
      -(plan.cropHeight * plan.scale) / 2,
      plan.cropWidth * plan.scale,
      plan.cropHeight * plan.scale,
    );
    const pixels = context.getImageData(0, 0, plan.targetWidth, plan.targetHeight);
    const jsQR = await loadJsQr();
    const decoded = setupCodeFromQrValue(jsQR(pixels.data, pixels.width, pixels.height, {
      inversionAttempts: "attemptBoth",
    })?.data.trim() || "");
    if (decoded) return decoded;
  }

  return "";
}

export function SetupQrScanner({
  onCancel,
  onNativeCapture,
  onSetupCode,
}: {
  onCancel: () => void;
  onNativeCapture?: () => Promise<void>;
  onSetupCode: (setupCode: string) => void;
}) {
  const { message, previewState, videoRef } = useSetupQrScanner({
    hasNativeCapture: Boolean(onNativeCapture),
    onSetupCode,
  });

  return (
    <div className={styles["scanner-backdrop"]} role="dialog" aria-modal="true" aria-label="Scan OpenClaw setup QR">
      <div className={styles.scanner}>
        <div className={styles["scanner-header"]}>
          <div>
            <div className={styles["section-label"]}>Scan setup QR</div>
            <div className={styles["section-copy"]}>{message}</div>
          </div>
          <button type="button" className={styles["scanner-close"]} onClick={onCancel} aria-label="Close scanner">
            Close
          </button>
        </div>
        {previewState === "unavailable" ? (
          <div className={styles["scanner-fallback"]}>
            <strong>Even Hub camera required</strong>
            <span>
              This WebView cannot open a live camera preview. The native Even Hub camera can still read the QR.
            </span>
          </div>
        ) : (
          <div className={styles["scanner-frame"]}>
            <video ref={videoRef} muted playsInline aria-label="Camera preview" />
            <div className={styles["scanner-reticle"]} aria-hidden="true" />
          </div>
        )}
        {onNativeCapture ? (
          <button
            type="button"
            className={styles["scanner-native"]}
            onClick={() => void onNativeCapture()}
          >
            Use Even Hub camera
          </button>
        ) : null}
      </div>
    </div>
  );
}
