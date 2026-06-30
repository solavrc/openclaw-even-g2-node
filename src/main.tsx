import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { EvenAppBridge, waitForEvenAppBridge } from "@evenrealities/even_hub_sdk";
import type { DeviceInfo, DeviceStatus, EvenHubEvent } from "@evenrealities/even_hub_sdk";
import {
  formatGlassApprovalDecisionFrame,
  formatGlassApprovalViewFrame,
  formatGlassSessionCreateFailedFrame,
  formatGlassSessionViewFrame,
  glassHudFrameToText,
  glassStatusFrame,
  labelForSession,
  shortText,
} from "./glass";
import type { OpenClawSession, SessionTranscriptMessage } from "./glass";
import { parseGatewayMessageData, parseVoiceGatewayMessageData } from "./gateway-messages";
import {
  gatewayApprovalUpdate,
  gatewayErrorStatusFromMessage,
  nodeApprovalReadySnapshot,
  nodeApprovalRequiredFromSnapshot,
  nodeApprovalStateExplicitlyReady,
  runtimeStatusSessionUpdate,
  sessionConfigOrSwitchUpdate,
  sessionSendAckMatchesCurrentSession,
} from "./gateway-messages";
import type {
  EvenG2NodeSnapshot,
  GatewayApprovalMessage,
  GatewayErrorMessage,
  GatewayMessage,
  GatewayNodeApprovalMessage,
  GatewayReadyOrRuntimeStatusMessage,
  GatewaySessionListResultMessage,
  GatewaySessionMessage,
  GatewaySessionSendAckMessage,
  GatewaySessionTranscriptSnapshotMessage,
  GatewayTransport,
  NodeApprovalRequired,
  NodeCommandMessage,
  PendingApproval,
  VoiceTransport,
} from "./gateway-messages";
import {
  GLASS_CANVAS_HEIGHT,
  GLASS_CANVAS_WIDTH,
  glassFrameFromInput,
  renderGlassImageCanvas,
  renderGlassTextFrame,
  renderGlassVoicePanelFrame,
} from "./glass-renderer";
import type { GlassRenderInput, GlassVoicePanelFrame } from "./glass-renderer";
import { glassInputActionFromEvent } from "./glass-events";
import { glassInputRoute, type GlassInputRoute, type GlassView } from "./glass-input-routing";
import { GatewayDirectTransport, clearBrowserDeviceCredentials, parseSetupCode } from "./gateway-direct";
import { setupCodeFromQrValue, storageSafeGatewayUrl } from "./setup-code";
import {
  createBridgeMirroredCredentialStorage,
} from "./bridge-storage";
import {
  applyReviewVoiceFailure,
  analyzeTalkCatalogForReview,
  checkingTalkCatalogReviewStatus,
  gatewayWaitingTalkCatalogReviewStatus,
  talkCatalogReviewStatusesEqual,
  unavailableTalkCatalogReviewStatus,
  unknownTalkCatalogReviewStatus,
  type TalkCatalogReviewStatus,
} from "./talk-catalog";
import { talkPttNodeCommandPlan } from "./voice-command";
import {
  recordingPlaceholder,
  recordingPulseHeader,
  standaloneVoiceTranscriptHudFrame,
  voiceDisconnectedNotSentHudFrame,
  voiceDraftPendingCopy,
  voiceFailureHudFrame,
  voiceFailureStatus,
  voiceInputOffHudFrame,
  voiceNoSpeechHudFrame,
  voicePanelPreviewText,
  voiceSetupNeededHudFrame,
  voiceSetupStepHudFrame,
} from "./voice-hud";
import type { VoiceDraftPendingPhase } from "./voice-hud";
import {
  bridgeVoiceStartConfig,
  initialVoiceDraftPendingPhase,
  pendingVoiceOpenFailurePlan,
  pendingSessionVoiceForStart,
  reviewVoiceFailureFromPendingSession,
  sessionVoiceSentPlan,
  sessionVoiceModeFromSetting,
  voiceTranscriptionFailedPlan,
  voiceDraftFailedPlan,
  voiceDraftPendingPhaseFromGatewayPayload,
  voiceDraftReadyPlan,
  voiceGatewayEventRoute,
  voiceTranscriptEventPlan,
} from "./voice-gateway-message";
import type { PendingSessionVoice, VoiceDraft, VoiceFailure } from "./voice-gateway-message";
import {
  VOICE_FINALIZE_CLOSE_TIMEOUT_MS,
  canSendVoiceAudio,
  isCurrentVoiceTransportGeneration,
  nextVoiceTransportGeneration,
  shouldCloseVoiceTransportWithoutFinalize,
  voiceCaptureOpeningOrActive as voiceCaptureOpeningOrActiveFromState,
  voiceStartAction,
  voiceStartTimerPlan,
  voiceStopListeningViewState,
  voiceTransportClosedPlan,
  voiceTransportCloseAction,
} from "./voice-transport-state";
import { attachGuardedVoiceTransportListeners } from "./voice-transport-controller";
import {
  connectionErrorPresentationPlan,
  connectionGuidanceHudFrame,
  gatewayConnectingHudFrame,
  guidanceForConnectionState,
  nodeApprovalGuidance,
  setupCodeInvalidHudFrame,
  setupCodeMissingHudFrame,
  setupHudFrame,
  setupQrNotFoundHudFrame,
  setupQrScanFailedHudFrame,
  setupQrScanPromptHudFrame,
  setupQrScannedHudFrame,
  shouldRetryWhileAwaitingApproval,
} from "./connection-guidance";
import {
  createEvenHubLifecycleDedupe,
  evenHubLifecycleActionFromEvent,
  evenHubLifecycleRoute,
  foregroundResumeStatus,
  foregroundHadActiveVoice,
  isForegroundBridgeAvailable,
  shouldReconnectOnForegroundResume,
  shouldResumeForegroundWorkForPageShow,
} from "./lifecycle";
import { onBackgroundRestore, setBackgroundState } from "./background-state";
import { activateKeepAlive, deactivateKeepAlive, keepAliveState } from "./keep-alive";
import {
  EVEN_HUB_EVENT_ENDPOINT,
  EVEN_HUB_EVENT_STORAGE_KEY,
  MAX_EVEN_HUB_EVENTS,
  evenHubEventDiagnosticLog,
  evenHubEventDiagnosticsEnabled,
  evenHubEventPayload,
  evenHubEventUiDiagnosticsEnabled,
  parseEvenHubEventLogs,
  shouldMirrorEvenHubEventsToDevServer,
} from "./even-hub-diagnostics";
import type { EvenHubEventLog } from "./even-hub-diagnostics";
import {
  canvasHideCommandResult,
  imageCanvasCommandResult,
  imageCanvasPresentationState,
  messageCanvasCommandResult,
  messageCanvasPresentationState,
  canvasMessagePresentationFromParams,
  canvasNodeCommandPlan,
  canvasSnapshotCommandResult,
  textCanvasCommandResult,
  textCanvasPresentationState,
} from "./canvas-command";
import type { CanvasImagePayload, CanvasMode, CanvasPresentationKind, CanvasPresentationState } from "./canvas-command";
import {
  CanvasImageSourceTooLargeError,
  canvasImagePayloadToTiles,
  canvasTutorialFrameDelayMs,
  canvasTutorialImageDataUrl,
  CANVAS_TUTORIAL_REQUEST,
  heyClawAskFromGuidance,
  heyClawAskFromText,
  nextCanvasTutorialStep,
  openClawAskFallbackFrame,
  openClawAskCanvasDataUrl,
  openClawAskPreviewText,
  shouldRenderCanvasTutorialFrame,
} from "./canvas-renderer";
import type { CanvasTutorialStep, OpenClawAskCanvasOptions } from "./canvas-renderer";
import { serializableDeviceStatus } from "./even-device-status";
import {
  canvasImageFailedError,
  canvasImageTooLargeError,
  canvasImageUrlUnsupportedError,
  deviceNodeCommandPayload,
  evenG2BridgeUnavailableError,
  glassRenderFailedError,
  nodeCommandFamily,
  nodeCommandIdFromMessage,
  nodeCommandNameFromMessage,
  unsupportedNodeCommandError,
  voiceBusyError,
} from "./node-command";
import {
  SETTINGS_VERSION,
  parseBackgroundSnapshot,
} from "./settings-storage";
import type { ClientBackgroundSnapshot } from "./settings-storage";
import { SetupQrScanner, decodeSetupQrFromImage } from "./setup-qr-scanner";
import {
  initialPhonePanelFromSearch,
  scrubStartupUrlHref,
  settingsFromSearch,
} from "./startup-url-settings";
import {
  clearBridgeClientSettings,
  clearBrowserClientSettings,
  loadedBridgeSettingsPlan,
  loadBridgeClientSettings,
  loadBrowserClientSettings,
  saveBridgeClientSettings,
  saveBrowserClientSettings,
} from "./client-settings";
import type { LoadedClientSettings } from "./client-settings";
import {
  closeReasonFromEvent,
  canSendGatewayNodeCommandResult,
  gatewayCloseStatus,
  gatewayErrorStatus,
  isGatewayTransportOpen,
  nodeApprovalRequiredStatus,
  shouldCloseGatewayTransport,
  shouldRestoreReadyAfterNodeApproval,
} from "./gateway-connection-state";
import { attachCurrentGatewayTransportListeners } from "./gateway-transport-controller";
import {
  gatewayApprovalResolveRequest,
  gatewayNodeApprovalRefreshRequest,
  gatewayNodeCommandResultRequest,
  gatewaySessionSendRequest,
  gatewaySessionSwitchRequest,
  gatewaySessionTranscriptGetRequest,
  gatewayUtteranceFinalizeRequest,
  gatewayUtteranceStartRequest,
  sendGatewayOutboxRequest,
  sendGatewaySessionBootstrapRequests,
} from "./gateway-outbox";
import { createRequestId } from "./request-id";
import { clearWindowTimeoutRef } from "./timer-ref";
import {
  connectionIssueKind as phoneConnectionIssueKind,
  connectionStateLabel,
  hasGatewaySetup as hasGatewaySetupUrl,
  liveActionLabel as phoneLiveActionLabel,
  liveStateLabel as phoneLiveStateLabel,
  nodeDetailText,
  nodeStatusLabel as phoneNodeStatusLabel,
  readinessChecklist as phoneReadinessChecklist,
  retryStatusLabel as phoneRetryStatusLabel,
  selectedReviewProviderMissing as phoneSelectedReviewProviderMissing,
  shouldShowCanvasTutorial,
  voiceFailureErrorText as phoneVoiceFailureErrorText,
} from "./phone-ui-state";
import {
  ApprovalPanel,
  ManualSetupPanel,
  SessionContextPanel,
} from "./phone-panels-view";
import {
  ConnectionSettingsPanel,
  DiagnosticsPanel,
  NodeLiveStatusPanel,
} from "./phone-status-view";
import {
  isSimulatorFixtureMode,
  simulatorFixtureBaseState,
  simulatorFixtureTranscriptForSession,
  simulatorFixtureViewPlan,
  simulatorFixtureModeFromSearch,
  simulatorSessionSelectorFlowFromSearch,
} from "./simulator-fixtures";
import type { SimulatorFixtureMode } from "./simulator-fixtures";
import {
  FALLBACK_MAIN_SESSION,
  currentDisplaySessions as displaySessionsOrFallback,
  fallbackSession,
  filterDisplaySessions,
  gatewaySessionListUpdate,
  sessionSelectOptions as sessionSelectOptionsForState,
} from "./session-state";
import {
  SESSION_TRANSCRIPT_INITIAL_RAW_LIMIT,
  earlierSessionTranscriptRequestPlan,
  maxSessionLogCursor as maxSessionLogCursorForMessages,
  nextSessionLogCursorForDirection,
  nextSessionTranscriptStatusAfterSnapshot,
  optimisticSessionUserMessageUpdate,
  sessionTranscriptRequestLimit,
  sessionTranscriptSnapshotUpdate,
} from "./session-transcript-state";
import {
  DEFAULT_VOICE_MODE,
  DEFAULT_VOICE_RECORDING_LIMIT_MS,
  normalizeVoiceMode,
  normalizeVoiceRecordingLimitSeconds,
  voiceHardStopTimeoutMs,
  voiceModeGatewayGuidance,
  voiceModeLabel,
  voiceRecoveryAction,
  voiceRecoveryTitle,
} from "./voice-settings";
import type { VoiceMode } from "./voice-settings";
import {
  ReviewProviderSelect,
  ReviewAvailabilityPanel,
  VoiceGatewaySetupGuidance,
  VoiceModeControls,
  VoiceRecordingLimitSelect,
} from "./voice-settings-view";
import { APP_VERSION } from "./app-version";
import styles from "./App.module.css";
import "./global.css";

const BACKGROUND_STATE_KEY = "openclaw-even-g2-node";
const MAX_RECONNECT_DELAY_MS = 15000;
const E2E_SESSION_MARKER = "[openclaw-even-g2-node:e2e:session]";
const E2E_VOICE_MARKER = "[openclaw-even-g2-node:e2e:voice]";
const E2E_APPROVAL_MARKER = "[openclaw-even-g2-node:e2e:approval]";
function devLog(...args: unknown[]) {
  if (import.meta.env.DEV) globalThis["console"].info(...args);
}

type RootGlobal = typeof globalThis & {
  __openClawEvenG2Root?: Root;
};

function settingsFromUrl() {
  return settingsFromSearch(window.location.search);
}

function simulatorFixtureMode() {
  return simulatorFixtureModeFromSearch(window.location.search, import.meta.env.DEV);
}

function simulatorSessionSelectorFlowEnabled() {
  return simulatorSessionSelectorFlowFromSearch(window.location.search, import.meta.env.DEV);
}

function e2eDiagnosticsEnabled() {
  if (!import.meta.env.DEV && !new URLSearchParams(globalThis.location?.search || "").has("e2eLog")) return;
  return true;
}

function emitE2eState(marker: string, payload: Record<string, unknown>) {
  if (!e2eDiagnosticsEnabled()) return;
  globalThis["console"].info(marker, JSON.stringify({
    emittedAt: new Date().toISOString(),
    ...payload,
  }));
}

function emitE2eSessionState(payload: Record<string, unknown>) {
  emitE2eState(E2E_SESSION_MARKER, payload);
}

function emitE2eVoiceState(payload: Record<string, unknown>) {
  emitE2eState(E2E_VOICE_MARKER, payload);
}

function emitE2eApprovalState(payload: Record<string, unknown>) {
  emitE2eState(E2E_APPROVAL_MARKER, payload);
}

function e2eVoiceModeFromSearch(search: string) {
  if (!e2eDiagnosticsEnabled()) return "";
  const mode = new URLSearchParams(search).get("e2eVoiceMode") || "";
  return normalizeVoiceMode(mode) || "";
}

function parseJsonObject(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function arrayBufferBackedBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy: Uint8Array<ArrayBuffer> = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function initialPhonePanel() {
  return initialPhonePanelFromSearch(window.location.search);
}

function scrubStartupUrlSettings() {
  try {
    const scrubbed = scrubStartupUrlHref(window.location.href);
    if (scrubbed.changed) window.history.replaceState(window.history.state, "", scrubbed.path);
  } catch {
    // URL cleanup prevents repeated resets, but failing to clean it should not block startup.
  }
}

function loadSettings() {
  return loadBrowserClientSettings({
    startupSettings: settingsFromUrl(),
    resetStorageKeys: [EVEN_HUB_EVENT_STORAGE_KEY],
    clearBrowserDeviceCredentials,
    afterLoad: scrubStartupUrlSettings,
  });
}

async function loadBridgeSettings(bridge: EvenAppBridge, browserFallbackSettings: LoadedClientSettings) {
  return loadBridgeClientSettings(bridge, {
    currentStartupSettings: settingsFromUrl(),
    browserFallbackSettings,
  });
}

function shouldDisableEvenBridge() {
  return new URLSearchParams(window.location.search).get("disableEvenBridge") === "1";
}

function currentAppOrigin() {
  if (window.location.origin && window.location.origin !== "null") return window.location.origin;
  return "";
}

function jsonEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

type PlannedNodeCommandResult = {
  id: string;
  ok: boolean;
  payload: Record<string, unknown>;
  error?: { code: string; message: string };
  status?: string;
};

type ParsedVoiceGatewayMessage = NonNullable<ReturnType<typeof parseVoiceGatewayMessageData>>;
type GlassInputEventAction = NonNullable<ReturnType<typeof glassInputActionFromEvent>>;
type EvenHubLifecycleRouteResult = ReturnType<typeof evenHubLifecycleRoute>;
type SessionTranscriptSnapshotUpdate = ReturnType<typeof sessionTranscriptSnapshotUpdate>;
type CanvasMessageKind = Extract<CanvasPresentationKind, "message" | "notification">;

function talkReviewProviderId(status: TalkCatalogReviewStatus) {
  return "providerId" in status ? status.providerId || "" : "";
}

export function App() {
  const initial = useMemo(loadSettings, []);
  const initialE2eVoiceMode = useMemo(() => e2eVoiceModeFromSearch(window.location.search), []);
  const devInitialPanel = useMemo(initialPhonePanel, []);
  const shouldProcessLifecycleAction = useMemo(() => createEvenHubLifecycleDedupe(), []);
  const [gatewayUrl, setGatewayUrl] = useState(initial.gatewayUrl);
  const [setupCodeDraft, setSetupCodeDraft] = useState(initial.gatewayUrl);
  const [status, setReactStatus] = useState("idle");
  const [setupScanStatus, setSetupScanStatus] = useState("");
  const [gatewayRequestCopyStatus, setGatewayRequestCopyStatus] = useState("");
  const [talkReviewStatus, setTalkReviewStatus] = useState<TalkCatalogReviewStatus>(unknownTalkCatalogReviewStatus);
  const [setupScannerOpen, setSetupScannerOpen] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [nodeApprovalStatus, setNodeApprovalStatus] = useState<NodeApprovalRequired | null>(null);
  const [sessionKey, setSessionKey] = useState(initial.selectedSessionKey || "");
  const [lastSeenNodeId, setLastSeenNodeId] = useState(initial.lastSeenNodeId || "");
  const [sessions, setSessions] = useState<OpenClawSession[]>([FALLBACK_MAIN_SESSION]);
  const [sessionTranscript, setSessionTranscript] = useState<SessionTranscriptMessage[]>([]);
  const [sessionTranscriptError, setSessionTranscriptError] = useState("");
  const [glassView, setGlassView] = useState<GlassView>("sessionHome");
  const [voiceMode, setVoiceMode] = useState<VoiceMode>(initialE2eVoiceMode || initial.voiceMode || DEFAULT_VOICE_MODE);
  const [preferredReviewProvider, setPreferredReviewProvider] = useState(initial.preferredReviewProvider || "");
  const [voiceRecordingLimitSeconds, setVoiceRecordingLimitSeconds] = useState(
    normalizeVoiceRecordingLimitSeconds(initial.voiceRecordingLimitSeconds),
  );
  const [lastVoiceFailure, setLastVoiceFailure] = useState<VoiceFailure | null>(null);
  const [reviewVoiceVerifiedAtMs, setReviewVoiceVerifiedAtMs] = useState<number | null>(null);
  const [reviewVoiceVerifiedProviderId, setReviewVoiceVerifiedProviderId] = useState("");
  const [voicePanelOpen, setVoicePanelOpen] = useState(devInitialPanel === "voice");
  const [voiceDraft, setVoiceDraft] = useState<VoiceDraft | null>(null);
  const [voiceDraftPendingPhase, setVoiceDraftPendingPhase] = useState<VoiceDraftPendingPhase>("preprocess");
  const [canvasTutorialPending, setCanvasTutorialPending] = useState(false);
  const [canvasTutorialCompleted, setCanvasTutorialCompleted] = useState(initial.canvasTutorialCompleted === true);
  const [canvasText, setCanvasText] = useState("");
  const [nodeSnapshot, setNodeSnapshot] = useState<EvenG2NodeSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [listening, setListening] = useState(false);
  const [evenHubEvents, setEvenHubEvents] = useState<EvenHubEventLog[]>(() => {
    try {
      const parsed = JSON.parse(globalThis.localStorage?.getItem(EVEN_HUB_EVENT_STORAGE_KEY) || "[]") as unknown;
      return parseEvenHubEventLogs(parsed);
    } catch {
      return [];
    }
  });
  const [retryDueAtMs, setRetryDueAtMs] = useState<number | null>(null);
  const [retryClockMs, setRetryClockMs] = useState(() => Date.now());
  const bridgeRef = useRef<EvenAppBridge | null>(null);
  const wsRef = useRef<GatewayTransport | null>(null);
  const voiceWsRef = useRef<VoiceTransport | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceTextRef = useRef("");
  const unsubscribeAudioRef = useRef<(() => void) | null>(null);
  const pendingNodeVoiceCommandIdRef = useRef<string | null>(null);
  const pendingSessionVoiceRef = useRef<PendingSessionVoice | null>(null);
  const voiceDraftRef = useRef<VoiceDraft | null>(null);
  const voiceDraftPendingPhaseRef = useRef<VoiceDraftPendingPhase>("preprocess");
  const pendingNodeVoiceStopTimerRef = useRef<number | null>(null);
  const voiceHardStopTimerRef = useRef<number | null>(null);
  const voiceFinalizeCloseTimerRef = useRef<number | null>(null);
  const listeningTapStopTimerRef = useRef<number | null>(null);
  const voiceRecordingPulseTimerRef = useRef<number | null>(null);
  const voiceRecordingPulseRef = useRef(0);
  const canvasTutorialTimerRef = useRef<number | null>(null);
  const canvasTutorialGenerationRef = useRef(0);
  const voiceTransportGenerationRef = useRef(0);
  const userEditedSettingsRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectPausedRef = useRef(false);
  const connectedRef = useRef(false);
  const listeningRef = useRef(false);
  const gatewayUrlRef = useRef(initial.gatewayUrl);
  const sessionKeyRef = useRef(initial.selectedSessionKey || "");
  const lastSeenNodeIdRef = useRef(initial.lastSeenNodeId || "");
  const voiceModeRef = useRef<VoiceMode>(initialE2eVoiceMode || initial.voiceMode || DEFAULT_VOICE_MODE);
  const preferredReviewProviderRef = useRef(initial.preferredReviewProvider || "");
  const voiceRecordingLimitSecondsRef = useRef(normalizeVoiceRecordingLimitSeconds(initial.voiceRecordingLimitSeconds));
  const talkReviewStatusRef = useRef<TalkCatalogReviewStatus>(unknownTalkCatalogReviewStatus());
  const nodeSnapshotRef = useRef<EvenG2NodeSnapshot | null>(null);
  const rawSessionsRef = useRef<OpenClawSession[]>([FALLBACK_MAIN_SESSION]);
  const sessionsRef = useRef<OpenClawSession[]>([FALLBACK_MAIN_SESSION]);
  const sessionTranscriptRef = useRef<SessionTranscriptMessage[]>([]);
  const statusRef = useRef("idle");
  const glassViewRef = useRef<GlassView>("sessionHome");
  const sessionLogCursorRef = useRef(0);
  const sessionTranscriptRawLimitRef = useRef(SESSION_TRANSCRIPT_INITIAL_RAW_LIMIT);
  const sessionTranscriptHasFullHistoryRef = useRef(false);
  const sessionTranscriptLoadingLimitRef = useRef<number | null>(null);
  const sessionTranscriptRequestedSessionKeyRef = useRef("");
  const simulatorSessionSelectorFlowRanRef = useRef(false);
  const pendingHistoryExpandRef = useRef<{ sessionKey: string; limit: number } | null>(null);
  const canvasTextRef = useRef("");
  const canvasModeRef = useRef<CanvasMode>("text");
  const canvasRestoreTimerRef = useRef<number | null>(null);
  const canvasTutorialPendingRef = useRef(false);
  const canvasTutorialCompletedRef = useRef(initial.canvasTutorialCompleted === true);
  const nodeApprovalStatusRef = useRef<NodeApprovalRequired | null>(null);
  const glassPreviewTextRef = useRef("OpenClaw Node ready");
  const latestDeviceStatusRef = useRef<DeviceStatus | null>(null);
  const latestDeviceInfoRef = useRef<DeviceInfo | null>(null);
  const pendingApprovalRef = useRef<PendingApproval | null>(null);
  const evenHubEventIdRef = useRef(0);
  const lastEvenHubEventAtRef = useRef<number | null>(null);
  const foregroundVoicePausedRef = useRef(false);
  const keepAliveLastLogRef = useRef<{ key: string; at: number }>({ key: "", at: 0 });

  function activateWebViewKeepAlive(reason: string) {
    const state = activateKeepAlive();
    const key = `${state.audio}:${state.lock}`;
    const now = Date.now();
    if (key !== keepAliveLastLogRef.current.key || now - keepAliveLastLogRef.current.at > 30_000) {
      keepAliveLastLogRef.current = { key, at: now };
      devLog("[Even G2 keep-alive]", { reason, ...state });
    }
  }

  function setActiveGlassView(nextView: GlassView) {
    if (glassViewRef.current === nextView) return;
    glassViewRef.current = nextView;
    setGlassView(nextView);
  }

  function setActiveConnected(nextConnected: boolean) {
    if (connectedRef.current === nextConnected) return;
    connectedRef.current = nextConnected;
    setConnected(nextConnected);
  }

  function setActiveListening(nextListening: boolean) {
    if (listeningRef.current === nextListening) return;
    listeningRef.current = nextListening;
    setListening(nextListening);
  }

  function setActivePendingApproval(nextApproval: PendingApproval | null) {
    if (jsonEqual(pendingApprovalRef.current, nextApproval)) return;
    pendingApprovalRef.current = nextApproval;
    setPendingApproval(nextApproval);
  }

  function setStatus(nextStatus: string) {
    if (statusRef.current === nextStatus) return;
    statusRef.current = nextStatus;
    setReactStatus(nextStatus);
  }

  function setActiveTalkReviewStatus(nextStatus: TalkCatalogReviewStatus) {
    if (talkCatalogReviewStatusesEqual(talkReviewStatusRef.current, nextStatus)) return;
    talkReviewStatusRef.current = nextStatus;
    setTalkReviewStatus(nextStatus);
  }

  function setActiveLastSeenNodeId(nextNodeId: string) {
    const normalizedNodeId = nextNodeId.trim();
    if (!normalizedNodeId || lastSeenNodeIdRef.current === normalizedNodeId) return;
    lastSeenNodeIdRef.current = normalizedNodeId;
    setLastSeenNodeId(normalizedNodeId);
  }

  function setActiveNodeSnapshot(nextSnapshot: EvenG2NodeSnapshot | null) {
    if (nextSnapshot?.nodeId) setActiveLastSeenNodeId(nextSnapshot.nodeId);
    if (jsonEqual(nodeSnapshotRef.current, nextSnapshot)) return;
    nodeSnapshotRef.current = nextSnapshot;
    setNodeSnapshot(nextSnapshot);
  }

  function mergeActiveNodeSnapshot(nextPatch: EvenG2NodeSnapshot) {
    setActiveNodeSnapshot({
      ...(nodeSnapshotRef.current || {}),
      ...nextPatch,
    });
  }

  function markActiveNodeApprovalReady() {
    const nextSnapshot = nodeApprovalReadySnapshot(nodeSnapshotRef.current);
    if (nextSnapshot) setActiveNodeSnapshot(nextSnapshot);
  }

  function setActiveGatewayUrl(nextGatewayUrl: string, options: { setupDraft?: boolean } = {}) {
    if (gatewayUrlRef.current !== nextGatewayUrl) {
      gatewayUrlRef.current = nextGatewayUrl;
      setGatewayUrl(nextGatewayUrl);
    }
    if (options.setupDraft) setSetupCodeDraft((current) => current === nextGatewayUrl ? current : nextGatewayUrl);
  }

  function setActiveSessionKey(nextSessionKey: string) {
    if (sessionKeyRef.current === nextSessionKey) return;
    sessionKeyRef.current = nextSessionKey;
    setSessionKey(nextSessionKey);
  }

  function setActiveVoiceMode(nextVoiceMode: VoiceMode) {
    if (voiceModeRef.current === nextVoiceMode) return;
    voiceModeRef.current = nextVoiceMode;
    setVoiceMode(nextVoiceMode);
    clearReviewVoiceVerification();
  }

  function setActivePreferredReviewProvider(nextProvider: string) {
    if (preferredReviewProviderRef.current === nextProvider) return;
    preferredReviewProviderRef.current = nextProvider;
    setPreferredReviewProvider(nextProvider);
    clearReviewVoiceVerification();
  }

  function setActiveVoiceRecordingLimitSeconds(nextLimitSeconds: unknown) {
    const normalizedLimitSeconds = normalizeVoiceRecordingLimitSeconds(nextLimitSeconds);
    if (voiceRecordingLimitSecondsRef.current === normalizedLimitSeconds) return;
    voiceRecordingLimitSecondsRef.current = normalizedLimitSeconds;
    setVoiceRecordingLimitSeconds(normalizedLimitSeconds);
  }

  function setActiveVoiceDraft(nextDraft: VoiceDraft | null) {
    if (jsonEqual(voiceDraftRef.current, nextDraft)) return;
    voiceDraftRef.current = nextDraft;
    setVoiceDraft(nextDraft);
  }

  function setActiveVoiceDraftPendingPhase(nextPhase: VoiceDraftPendingPhase) {
    if (voiceDraftPendingPhaseRef.current === nextPhase) return;
    voiceDraftPendingPhaseRef.current = nextPhase;
    setVoiceDraftPendingPhase(nextPhase);
  }

  function setActiveVoiceListening() {
    emitE2eVoiceState({
      action: "voice-listening",
      mode: pendingSessionVoiceRef.current?.mode || voiceModeRef.current,
      sessionKey: pendingSessionVoiceRef.current?.targetSessionKey || sessionKeyRef.current,
    });
    setActiveListening(true);
    setActiveGlassView("listening");
    setStatus("voice: listening");
  }

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  function pauseForegroundWork(reason: "backgrounded" | "unloading", options: { updateStatus?: boolean } = {}) {
    const hadActiveVoice = foregroundHadActiveVoice({
      voiceCaptureActive: voiceCaptureOpeningOrActive(),
      glassView: glassViewRef.current,
    });
    closeVoiceTransportWithoutFinalize();
    if (hadActiveVoice && reason === "backgrounded") foregroundVoicePausedRef.current = true;
    if (options.updateStatus !== false) setStatus(reason === "backgrounded" ? "backgrounded" : "closed");
  }

  function resumeForegroundWork() {
    const hadPausedVoice = foregroundVoicePausedRef.current;
    const shouldReconnect = shouldReconnectOnForegroundResume({
      gatewayUrl: gatewayUrlRef.current,
      connected: connectedRef.current,
    });
    const nextStatus = foregroundResumeStatus(statusRef.current, connectedRef.current, hadPausedVoice, shouldReconnect);
    if (nextStatus) setStatus(nextStatus);
    if (hadPausedVoice) {
      foregroundVoicePausedRef.current = false;
      renderGlassSessionHome("voice canceled");
    }
    if (shouldReconnect) {
      connect();
      return;
    }
  }

  function handleForegroundExitSignal() {
    devLog("[Even G2 lifecycle] foregroundExit observed; keeping active glasses session available");
  }

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") resumeForegroundWork();
    }
    function handlePageHide() {
      devLog("[Even G2 lifecycle] pagehide observed; preserving live glasses session if bridge stays active");
    }
    function handlePageShow() {
      if (shouldResumeForegroundWorkForPageShow(document.visibilityState)) resumeForegroundWork();
    }
    function handleBeforeUnload() {
      pauseForegroundWork("unloading");
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      pauseForegroundWork("unloading");
    };
  }, []);

  useEffect(() => {
    gatewayUrlRef.current = gatewayUrl;
  }, [gatewayUrl]);

  useEffect(() => {
    sessionKeyRef.current = sessionKey;
  }, [sessionKey]);

  useEffect(() => {
    lastSeenNodeIdRef.current = lastSeenNodeId;
  }, [lastSeenNodeId]);

  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);

  useEffect(() => {
    preferredReviewProviderRef.current = preferredReviewProvider;
  }, [preferredReviewProvider]);

  useEffect(() => {
    voiceRecordingLimitSecondsRef.current = voiceRecordingLimitSeconds;
  }, [voiceRecordingLimitSeconds]);

  useEffect(() => {
    talkReviewStatusRef.current = talkReviewStatus;
  }, [talkReviewStatus]);

  useEffect(() => {
    voiceDraftRef.current = voiceDraft;
  }, [voiceDraft]);

  useEffect(() => {
    voiceDraftPendingPhaseRef.current = voiceDraftPendingPhase;
  }, [voiceDraftPendingPhase]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    sessionTranscriptRef.current = sessionTranscript;
  }, [sessionTranscript]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (retryDueAtMs === null) return undefined;
    setRetryClockMs(Date.now());
    const timer = window.setInterval(() => setRetryClockMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [retryDueAtMs]);

  useEffect(() => {
    canvasTextRef.current = canvasText;
  }, [canvasText]);

  useEffect(() => {
    canvasTutorialPendingRef.current = canvasTutorialPending;
  }, [canvasTutorialPending]);

  useEffect(() => {
    canvasTutorialCompletedRef.current = canvasTutorialCompleted;
  }, [canvasTutorialCompleted]);

  useEffect(() => {
    pendingApprovalRef.current = pendingApproval;
  }, [pendingApproval]);

  useEffect(() => {
    const unsetSnapshot = setBackgroundState(BACKGROUND_STATE_KEY, () => ({
      settingsVersion: SETTINGS_VERSION,
      gatewayUrl: storageSafeGatewayUrl(gatewayUrlRef.current),
      selectedSessionKey: sessionKeyRef.current,
      voiceMode: voiceModeRef.current,
      preferredReviewProvider: preferredReviewProviderRef.current,
      voiceRecordingLimitSeconds: voiceRecordingLimitSecondsRef.current,
      glassView: "sessionHome",
      sessionLogCursor: sessionLogCursorRef.current,
    } satisfies ClientBackgroundSnapshot));

    const unsetRestore = onBackgroundRestore(BACKGROUND_STATE_KEY, (snapshot) => {
      const restored = parseBackgroundSnapshot(snapshot);
      if (restored.settingsVersion !== SETTINGS_VERSION) return;
      if (typeof restored.gatewayUrl === "string" && restored.gatewayUrl.trim()) {
        setActiveGatewayUrl(restored.gatewayUrl, { setupDraft: true });
      }
      if (typeof restored.selectedSessionKey === "string" && restored.selectedSessionKey) {
        setActiveSessionKey(restored.selectedSessionKey);
      }
      if (restored.voiceMode) {
        setActiveVoiceMode(restored.voiceMode);
      }
      if (typeof restored.preferredReviewProvider === "string") {
        setActivePreferredReviewProvider(restored.preferredReviewProvider);
      }
      if (typeof restored.voiceRecordingLimitSeconds === "number") {
        setActiveVoiceRecordingLimitSeconds(restored.voiceRecordingLimitSeconds);
      }
      if (typeof restored.sessionLogCursor === "number") {
        sessionLogCursorRef.current = Math.min(restored.sessionLogCursor, maxSessionLogCursor());
      }
      setActiveGlassView("sessionHome");
    });

    return () => {
      unsetRestore();
      unsetSnapshot();
    };
  }, []);

  useEffect(() => {
    const settings = {
      gatewayUrl,
      ...(sessionKey ? { selectedSessionKey: sessionKey } : {}),
      ...(lastSeenNodeId ? { lastSeenNodeId } : {}),
      voiceMode,
      ...(preferredReviewProvider ? { preferredReviewProvider } : {}),
      voiceRecordingLimitSeconds,
      canvasTutorialCompleted,
    };
    saveBrowserClientSettings(settings);
    const bridge = bridgeRef.current;
    if (bridge) void saveBridgeClientSettings(bridge, settings).catch(() => {});
  }, [gatewayUrl, sessionKey, lastSeenNodeId, voiceMode, preferredReviewProvider, voiceRecordingLimitSeconds, canvasTutorialCompleted]);

  async function renderGlass(input: GlassRenderInput, bridge = bridgeRef.current) {
    const frame = glassFrameFromInput(input);
    const previewText = glassHudFrameToText(frame);
    glassPreviewTextRef.current = previewText;
    return renderGlassTextFrame(bridge, frame);
  }

  async function renderOpenClawAskCanvas(options: OpenClawAskCanvasOptions, bridge = bridgeRef.current) {
    glassPreviewTextRef.current = openClawAskPreviewText(options);
    try {
      const dataUrl = await openClawAskCanvasDataUrl(options);
      const tiles = await canvasImagePayloadToTiles({
        dataUrl,
        alt: `OpenClaw prompt: ${options.ask}`,
      });
      const rendered = await renderGlassImageCanvas(bridge, tiles);
      if (rendered) return true;
      devLog("[Even G2] OpenClaw ask canvas image refused; rendering text fallback");
      return renderGlass(openClawAskFallbackFrame(options), bridge);
    } catch (error) {
      devLog("[Even G2] OpenClaw ask canvas failed", error);
      return renderGlass(openClawAskFallbackFrame(options), bridge);
    }
  }

  function renderSetupPrompt(bridge = bridgeRef.current) {
    const frame = setupHudFrame();
    const ask = heyClawAskFromText(frame.body);
    if (!ask) return renderGlass(frame, bridge);
    return renderOpenClawAskCanvas({
      ask,
      header: frame.header,
      hint: frame.hint,
    }, bridge);
  }

  function renderGatewayConnectingFrame(bridge = bridgeRef.current) {
    void renderGlass(gatewayConnectingHudFrame(), bridge);
  }

  async function renderConnectionGuidance(statusText: string, bridge = bridgeRef.current) {
    const guidance = guidanceForConnectionState(statusText, Boolean(gatewayUrl.trim()));
    if (!guidance) return;
    const frame = connectionGuidanceHudFrame(guidance);
    const ask = heyClawAskFromGuidance(guidance) || heyClawAskFromText(frame.body);
    if (ask) {
      await renderOpenClawAskCanvas({
        ask,
        header: frame.header,
        hint: frame.hint,
      }, bridge);
      return;
    }
    await renderGlass(frame, bridge);
  }

  function renderGlassVoiceSetupStep(bridge = bridgeRef.current) {
    setActiveGlassView("voiceSetup");
    void renderGlass(voiceSetupStepHudFrame(voiceModeRef.current), bridge);
  }

  function requestSessionTranscript(
    nextSessionKey = sessionKeyRef.current,
    options: { limit?: number; expand?: boolean; force?: boolean } = {},
  ) {
    const ws = wsRef.current;
    if (!ws || !isGatewayTransportOpen(ws.readyState, WebSocket.OPEN) || !nextSessionKey) return;
    const requestedLimit = sessionTranscriptRequestLimit(options.limit, sessionTranscriptRawLimitRef.current);
    if (
      !options.force
      && sessionTranscriptRequestedSessionKeyRef.current === nextSessionKey
      && sessionTranscriptLoadingLimitRef.current !== null
      && sessionTranscriptLoadingLimitRef.current >= requestedLimit
    ) return;
    sessionTranscriptLoadingLimitRef.current = requestedLimit;
    sessionTranscriptRequestedSessionKeyRef.current = nextSessionKey;
    if (options.expand) pendingHistoryExpandRef.current = { sessionKey: nextSessionKey, limit: requestedLimit };
    emitE2eSessionState({ action: "request-transcript", sessionKey: nextSessionKey, limit: requestedLimit });
    sendGatewayOutboxRequest(ws, gatewaySessionTranscriptGetRequest(nextSessionKey, requestedLimit));
  }

  function currentDisplaySessions() {
    return displaySessionsOrFallback(sessionsRef.current);
  }

  function applySessionList(nextRawSessions: OpenClawSession[]) {
    const nextFilteredSessions = filterDisplaySessions(nextRawSessions);
    rawSessionsRef.current = nextRawSessions;
    if (!jsonEqual(sessionsRef.current, nextFilteredSessions)) {
      sessionsRef.current = nextFilteredSessions;
      setSessions(nextFilteredSessions);
    }
    return nextFilteredSessions;
  }

  function setActiveSessionTranscript(nextMessages: SessionTranscriptMessage[]) {
    if (jsonEqual(sessionTranscriptRef.current, nextMessages)) return;
    sessionTranscriptRef.current = nextMessages;
    setSessionTranscript(nextMessages);
  }

  function setActiveCanvasText(nextText: string) {
    if (canvasTextRef.current === nextText) return;
    canvasTextRef.current = nextText;
    setCanvasText(nextText);
  }

  function setActiveCanvasState(input: { mode: CanvasMode; text: string }) {
    canvasModeRef.current = input.mode;
    setActiveCanvasText(input.text);
  }

  function setActiveCanvasTutorialCompleted(completed: boolean) {
    if (canvasTutorialCompletedRef.current === completed) return;
    canvasTutorialCompletedRef.current = completed;
    setCanvasTutorialCompleted(completed);
  }

  function setActiveCanvasTutorialPending(pending: boolean) {
    if (canvasTutorialPendingRef.current === pending) return;
    canvasTutorialPendingRef.current = pending;
    setCanvasTutorialPending(pending);
  }

  function setActiveNodeApprovalStatus(nextStatus: NodeApprovalRequired | null) {
    nodeApprovalStatusRef.current = nextStatus;
    setNodeApprovalStatus(nextStatus);
  }

  function getActiveSessionLabel() {
    const activeKey = sessionKeyRef.current;
    const currentSessions = currentDisplaySessions();
    const activeSession = currentSessions.find((session) => session.key === activeKey) || fallbackSession(activeKey);
    return labelForSession(activeSession);
  }

  function resetSessionLogCursor() {
    sessionLogCursorRef.current = 0;
  }

  function resetSessionTranscriptState() {
    setActiveSessionTranscript([]);
    setSessionTranscriptError("");
    sessionTranscriptRawLimitRef.current = SESSION_TRANSCRIPT_INITIAL_RAW_LIMIT;
    sessionTranscriptHasFullHistoryRef.current = false;
    clearSessionTranscriptLoadingState();
    resetSessionLogCursor();
  }

  function clearReviewVoiceVerification() {
    setReviewVoiceVerifiedAtMs(null);
    setReviewVoiceVerifiedProviderId("");
  }

  function markReviewVoiceVerified(providerId = "") {
    setReviewVoiceVerifiedAtMs(Date.now());
    setReviewVoiceVerifiedProviderId(providerId || talkReviewProviderId(talkReviewStatusRef.current));
  }

  function clearSessionTranscriptLoadingState() {
    sessionTranscriptLoadingLimitRef.current = null;
    pendingHistoryExpandRef.current = null;
  }

  function resetPairingScopedState() {
    resetSessionTranscriptState();
    setActiveSessionKey("");
    applySessionList([]);
    setActiveNodeSnapshot(null);
    setActivePendingApproval(null);
    setActiveNodeApprovalStatus(null);
    clearReviewVoiceVerification();
  }

  function maxSessionLogCursor(messages = sessionTranscriptRef.current) {
    return maxSessionLogCursorForMessages(messages);
  }

  function stripBootstrapSetupTokenFromState() {
    const safeGatewayUrl = storageSafeGatewayUrl(gatewayUrlRef.current);
    if (!safeGatewayUrl || safeGatewayUrl === gatewayUrlRef.current) return;
    setActiveGatewayUrl(safeGatewayUrl);
    setSetupScanStatus("Setup paired. Stored Gateway URL without the one-time setup token.");
  }

  function renderGlassSessionHome(statusText = statusRef.current, options: { force?: boolean } = {}) {
    if (!options.force && (glassViewRef.current === "voiceDraftPending" || glassViewRef.current === "voiceDraft")) return;
    setActiveGlassView("sessionHome");
    void renderGlass(currentSessionFrame(statusText));
  }

  function clearCanvasTutorialTimer() {
    clearWindowTimeoutRef(canvasTutorialTimerRef);
  }

  async function renderCanvasTutorialImage(step: 0 | 1, bridge = bridgeRef.current) {
    const tiles = await canvasImagePayloadToTiles({
      dataUrl: canvasTutorialImageDataUrl(step),
      alt: step === 0 ? "OpenClaw canvas intro" : "OpenClaw canvas capabilities",
    });
    return renderGlassImageCanvas(bridge, tiles);
  }

  async function renderCanvasTutorialFrame(step: CanvasTutorialStep, generation: number, bridge = bridgeRef.current) {
    if (!shouldRenderCanvasTutorialFrame({
      generation,
      currentGeneration: canvasTutorialGenerationRef.current,
      completed: canvasTutorialCompletedRef.current,
    })) return;
    if (step === 0 || step === 1) {
      const ok = await renderCanvasTutorialImage(step, bridge);
      if (!ok) {
        void renderOpenClawAskCanvas({
          ask: CANVAS_TUTORIAL_REQUEST,
          header: "Canvas is ready",
          hint: "tap skip",
        }, bridge);
      }
    } else {
      void renderOpenClawAskCanvas({
        ask: CANVAS_TUTORIAL_REQUEST,
        header: "Canvas is ready",
        hint: "tap skip",
      }, bridge);
    }
    const delay = canvasTutorialFrameDelayMs(step);
    if (delay > 0 && shouldRenderCanvasTutorialFrame({
      generation,
      currentGeneration: canvasTutorialGenerationRef.current,
      completed: canvasTutorialCompletedRef.current,
    })) {
      clearCanvasTutorialTimer();
      canvasTutorialTimerRef.current = window.setTimeout(() => {
        canvasTutorialTimerRef.current = null;
        void renderCanvasTutorialFrame(nextCanvasTutorialStep(step), generation, bridge);
      }, delay);
    }
  }

  function renderCanvasTutorial(options: { force?: boolean; bridge?: EvenAppBridge } = {}) {
    if (!options.force && canvasTutorialCompletedRef.current) return;
    clearCanvasTutorialTimer();
    if (options.force) {
      setActiveCanvasTutorialCompleted(false);
    }
    const generation = canvasTutorialGenerationRef.current + 1;
    canvasTutorialGenerationRef.current = generation;
    setActiveCanvasTutorialPending(true);
    setStatus("canvas tutorial");
    setActiveGlassView("canvasTutorial");
    void renderCanvasTutorialFrame(0, generation, options.bridge);
  }

  function completeCanvasTutorial() {
    clearCanvasTutorialTimer();
    canvasTutorialGenerationRef.current += 1;
    setActiveCanvasTutorialCompleted(true);
    setActiveCanvasTutorialPending(false);
  }

  function skipCanvasTutorial() {
    completeCanvasTutorial();
    setStatus("ready");
    renderGlassSessionHome("ready", { force: true });
  }

  function currentSessionFrame(statusText = statusRef.current) {
    return formatGlassSessionViewFrame({
      activeSessionLabel: getActiveSessionLabel(),
      messages: sessionTranscriptRef.current,
      statusText,
      logCursor: sessionLogCursorRef.current,
    });
  }

  function renderGlassVoicePanel(frame: Omit<GlassVoicePanelFrame, "base">) {
    const base = currentSessionFrame(statusRef.current);
    const panelFrame = { ...frame, base };
    glassPreviewTextRef.current = voicePanelPreviewText(base, frame.title, frame.body, frame.hint);
    void renderGlassVoicePanelFrame(bridgeRef.current, panelFrame);
  }

  function renderListeningVoicePanel() {
    const mode = pendingSessionVoiceRef.current?.mode === "direct" ? "direct" : "review";
    const base = currentSessionFrame(statusRef.current);
    const panelFrame = {
      base: { ...base, header: recordingPulseHeader(mode, getActiveSessionLabel(), voiceRecordingPulseRef.current) },
      title: mode === "direct" ? "Send now" : "Review voice",
      body: voiceTextRef.current.trim() || recordingPlaceholder(),
      hint: mode === "direct" ? "tap send · 2-tap cancel" : "tap stop · 2-tap cancel",
    };
    glassPreviewTextRef.current = voicePanelPreviewText(panelFrame.base, panelFrame.title, panelFrame.body, panelFrame.hint);
    void renderGlassVoicePanelFrame(bridgeRef.current, panelFrame);
  }

  function clearVoiceRecordingPulseTimer() {
    if (voiceRecordingPulseTimerRef.current !== null) {
      window.clearInterval(voiceRecordingPulseTimerRef.current);
      voiceRecordingPulseTimerRef.current = null;
    }
  }

  function startVoiceRecordingPulse() {
    clearVoiceRecordingPulseTimer();
    voiceRecordingPulseRef.current = 0;
    voiceRecordingPulseTimerRef.current = window.setInterval(() => {
      if (glassViewRef.current !== "listening") {
        clearVoiceRecordingPulseTimer();
        return;
      }
      voiceRecordingPulseRef.current = (voiceRecordingPulseRef.current + 1) % 4;
      renderListeningVoicePanel();
    }, 700);
  }

  function renderGlassVoiceDraft(nextDraft = voiceDraftRef.current) {
    if (!nextDraft) {
      renderGlassSessionHome(statusRef.current);
      return;
    }
    setActiveGlassView("voiceDraft");
    renderGlassVoicePanel({
      title: "Review transcript",
      body: nextDraft.text.trim() || "No speech detected",
      hint: "tap send · 2-tap discard",
    });
  }

  function renderGlassVoiceDraftPending(phase = voiceDraftPendingPhaseRef.current) {
    const copy = voiceDraftPendingCopy(phase);
    setActiveGlassView("voiceDraftPending");
    renderGlassVoicePanel({
      title: copy.stepTitle,
      body: copy.detail,
      hint: "wait...",
    });
  }

  function renderGlassVoiceFailure(errorText: string) {
    setActiveGlassView("sessionHome");
    void renderGlass(voiceFailureHudFrame(errorText));
  }

  function renderGlassApproval(approval = pendingApprovalRef.current) {
    if (!approval) {
      renderGlassSessionHome(statusRef.current);
      return;
    }
    setActiveGlassView("approval");
    void renderGlass(formatGlassApprovalViewFrame({
      command: approval.command,
      ask: approval.ask,
      cwd: approval.cwd,
    }));
  }

  function installSimulatorGatewayTransport() {
    const fixtureGatewayEvents = new EventTarget();
    let transport: GatewayTransport;
    const emitFixtureGatewayMessage = (message: GatewayMessage) => window.setTimeout(() => handleGatewayMessage(transport, message), 0);
    transport = {
      readyState: WebSocket.OPEN,
      addEventListener: fixtureGatewayEvents.addEventListener.bind(fixtureGatewayEvents),
      close: () => undefined,
      send: (data: string) => {
        devLog("[OpenClaw Node] simulator fixture gateway send", data);
        const request = parseJsonObject(data);
        if (!request || typeof request !== "object" || Array.isArray(request)) return;
        const record = request as Record<string, unknown>;
        const type = typeof record.type === "string" ? record.type : "";
        emitE2eSessionState({ action: "gateway-send", type, sessionKey: record.sessionKey });
        if (type === "eveng2.session.config.get") {
          emitFixtureGatewayMessage({ type: "eveng2.session.config.snapshot", sessionKey: sessionKeyRef.current });
        } else if (type === "eveng2.session.list") {
          emitFixtureGatewayMessage({ type: "eveng2.session.list.result", sessions: rawSessionsRef.current });
        } else if (type === "eveng2.session.switch") {
          const nextSessionKey = typeof record.sessionKey === "string" ? record.sessionKey : "";
          if (!nextSessionKey) return;
          emitFixtureGatewayMessage({ type: "eveng2.session.switch.applied", sessionKey: nextSessionKey });
        } else if (type === "eveng2.session.transcript.get") {
          const requestedSessionKey = typeof record.sessionKey === "string" ? record.sessionKey : sessionKeyRef.current;
          emitFixtureGatewayMessage({
            type: "eveng2.session.transcript.snapshot",
            sessionKey: requestedSessionKey,
            sessionId: requestedSessionKey,
            messages: simulatorFixtureTranscriptForSession(requestedSessionKey),
            rawLimit: typeof record.limit === "number" ? record.limit : SESSION_TRANSCRIPT_INITIAL_RAW_LIMIT,
            rawCount: simulatorFixtureTranscriptForSession(requestedSessionKey).length,
            hasFullHistory: true,
          });
        } else if (type === "eveng2.approval.resolve") {
          const id = typeof record.id === "string" ? record.id : "";
          const requestId = typeof record.requestId === "string" ? record.requestId : "";
          const decision = typeof record.decision === "string" ? record.decision : null;
          emitFixtureGatewayMessage({
            type: "eveng2.approval.resolve.ack",
            id,
            requestId,
            decision,
            status: "accepted",
          });
          emitFixtureGatewayMessage({
            type: "eveng2.approval.resolved",
            id,
            requestId,
            decision,
          });
        }
      },
    };
    wsRef.current = transport;
  }

  function applySimulatorBaseState(fixtureMode: SimulatorFixtureMode) {
    const fixtureState = simulatorFixtureBaseState(fixtureMode);
    userEditedSettingsRef.current = true;
    setActiveGatewayUrl(fixtureState.gatewayUrl, { setupDraft: true });
    setActiveConnected(true);
    setStatus(fixtureState.status);
    setActiveSessionKey(fixtureState.sessionKey);
    applySessionList(fixtureState.sessions);
    setActiveSessionTranscript(fixtureState.transcript);
    setSessionTranscriptError("");
    sessionTranscriptHasFullHistoryRef.current = true;
    sessionTranscriptLoadingLimitRef.current = null;
    resetSessionLogCursor();
    setActiveNodeSnapshot(fixtureState.nodeSnapshot);
  }

  function applySimulatorModeState(fixtureMode: SimulatorFixtureMode, bridge: EvenAppBridge) {
    const plan = simulatorFixtureViewPlan(fixtureMode, window.location.search);
    switch (plan.action) {
      case "store-voice":
        pendingSessionVoiceRef.current = plan.pendingSessionVoice;
        voiceTextRef.current = plan.voiceText;
        setActiveVoiceListening();
        renderListeningVoicePanel();
        return true;
      case "voice-review": {
        setActiveGlassView("voiceDraft");
        setActiveVoiceDraft(plan.draft);
        const base = formatGlassSessionViewFrame({
          activeSessionLabel: "main",
          statusText: "ready",
          messages: plan.transcript,
        });
        void renderGlassVoicePanelFrame(bridge, {
          base,
          title: "Review transcript",
          body: plan.draft.text,
          hint: "tap send · 2-tap discard",
        });
        return true;
      }
      case "canvas":
        setActiveGlassView("canvas");
        setActiveCanvasText(plan.text);
        void renderGlass(plan.text, bridge);
        return true;
      case "emoji-probe":
        setActiveGlassView("canvas");
        setActiveCanvasText(plan.text);
        void renderGlassTextFrame(bridge, {
          header: "Emoji glyph probe",
          body: plan.text,
          hint: "raw glyph probe",
        }, { normalize: false });
        return true;
      case "canvas-tutorial":
        renderCanvasTutorial({ force: true, bridge });
        return true;
      case "approval":
        setActiveGlassView("approval");
        setActivePendingApproval(plan.approval);
        void renderGlass(formatGlassApprovalViewFrame(plan.approval), bridge);
        return true;
      case "recovery":
        setActiveGlassView("sessionHome");
        void renderGlass(glassStatusFrame(plan.frame.header, plan.frame.body, plan.frame.hint), bridge);
        return true;
      case "session-home":
        renderGlassSessionHome("ready", { force: true });
        return true;
    }
  }

  function applySimulatorFixture(bridge: EvenAppBridge) {
    const fixtureMode = simulatorFixtureMode();
    if (!isSimulatorFixtureMode(fixtureMode)) return false;
    evenHubEventDiagnosticLog(`[openclaw-even-g2-node] simFixture=${fixtureMode}`);
    installSimulatorGatewayTransport();
    applySimulatorBaseState(fixtureMode);
    return applySimulatorModeState(fixtureMode, bridge);
  }

  function requestGatewaySessionSwitch(nextSessionKey: string) {
    const ws = wsRef.current;
    if (!ws || !isGatewayTransportOpen(ws.readyState, WebSocket.OPEN)) return false;
    sendGatewayOutboxRequest(ws, gatewaySessionSwitchRequest(nextSessionKey));
    requestSessionTranscript(nextSessionKey, { force: true });
    return true;
  }

  function applyActiveSessionSelection(nextSessionKey: string, options: { resetTranscript?: boolean } = {}) {
    setActiveSessionKey(nextSessionKey);
    if (options.resetTranscript) resetSessionTranscriptState();
  }

  function requestEarlierSessionTranscript() {
    const currentSessionKey = sessionKeyRef.current;
    const plan = earlierSessionTranscriptRequestPlan({
      sessionKey: currentSessionKey,
      hasFullHistory: sessionTranscriptHasFullHistoryRef.current,
      loadingLimit: sessionTranscriptLoadingLimitRef.current,
      currentRawLimit: sessionTranscriptRawLimitRef.current,
    });
    if (plan.action === "limit-reached") {
      setStatus(plan.status);
      renderGlassSessionHome(plan.renderStatus);
      return plan.result;
    }
    if (plan.action === "request") {
      setStatus(plan.status);
      requestSessionTranscript(currentSessionKey, { limit: plan.limit, expand: true });
    }
    return plan.result;
  }

  function moveSessionLogCursor(direction: "up" | "down") {
    const maxCursor = maxSessionLogCursor();
    const next = nextSessionLogCursorForDirection({
      currentCursor: sessionLogCursorRef.current,
      maxCursor,
      direction,
    });
    sessionLogCursorRef.current = next;
    if (direction === "up" && next >= maxCursor) {
      if (requestEarlierSessionTranscript()) return;
      if (sessionTranscriptHasFullHistoryRef.current) {
        renderGlassSessionHome("start of log");
        return;
      }
    }
    renderGlassSessionHome(statusRef.current);
  }

  function appendOptimisticUserMessage(sessionKey: string, text: string, idempotencyKey: string) {
    const update = optimisticSessionUserMessageUpdate({
      currentSessionKey: sessionKeyRef.current,
      targetSessionKey: sessionKey,
      messages: sessionTranscriptRef.current,
      text,
      idempotencyKey,
      timestamp: new Date().toISOString(),
    });
    if (!update.appended) return;
    setActiveSessionTranscript(update.messages);
    resetSessionLogCursor();
  }

  function sendVoiceTextToSession(text: string, sessionKey: string, idempotencyKey: string) {
    const message = text.trim();
    if (!message) {
      setStatus("voice: no speech detected");
      renderGlassSessionHome("no speech");
      return;
    }
    const ws = wsRef.current;
    if (!ws || !isGatewayTransportOpen(ws.readyState, WebSocket.OPEN)) {
      setStatus("voice: OpenClaw disconnected");
      void renderGlass(voiceDisconnectedNotSentHudFrame());
      return;
    }
    appendOptimisticUserMessage(sessionKey, message, idempotencyKey);
    setStatus("voice: sending to session");
    emitE2eVoiceState({
      action: "send-voice-draft",
      mode: "review",
      sessionKey,
      textLength: message.length,
    });
    sendGatewayOutboxRequest(ws, gatewaySessionSendRequest(sessionKey, message, idempotencyKey));
    renderGlassSessionHome("voice submitted", { force: true });
  }

  function sendCurrentVoiceDraft() {
    const draft = voiceDraftRef.current;
    if (!draft) {
      renderGlassSessionHome(statusRef.current);
      return;
    }
    setActiveVoiceDraft(null);
    emitE2eVoiceState({
      action: "confirm-voice-draft",
      mode: "review",
      sessionKey: draft.targetSessionKey,
      textLength: draft.text.length,
    });
    sendVoiceTextToSession(draft.text, draft.targetSessionKey, draft.idempotencyKey);
  }

  function discardCurrentVoiceDraft() {
    emitE2eVoiceState({
      action: "discard-voice-draft",
      mode: "review",
      sessionKey: voiceDraftRef.current?.targetSessionKey,
    });
    setActiveVoiceDraft(null);
    setStatus("voice transcript discarded");
    renderGlassSessionHome("ready", { force: true });
  }

  async function startSessionVoice() {
    if (!connectedRef.current) {
      renderGatewayConnectingFrame();
      connect();
      return;
    }
    if (voiceModeRef.current === "off") {
      setStatus("voice input off");
      void renderGlass(voiceInputOffHudFrame());
      return;
    }
    if (listeningRef.current) {
      stopVoice();
      return;
    }
    if (voiceCaptureOpeningOrActive()) {
      setStatus("voice: busy");
      renderGlassSessionHome("voice busy");
      return;
    }
    setActiveVoiceDraft(null);
    setLastVoiceFailure(null);
    const idempotencyKey = createRequestId();
    const mode = sessionVoiceModeFromSetting(voiceModeRef.current);
    let transcriptionProvider: string | undefined;
    if (mode === "review") {
      const reviewStatus = talkReviewStatusRef.current.state === "ready"
        ? talkReviewStatusRef.current
        : await refreshTalkReviewStatus();
      if (reviewStatus.state !== "ready") {
        setStatus("voice setup needed");
        void renderGlass(voiceSetupNeededHudFrame(reviewStatus.detail));
        return;
      }
      transcriptionProvider = reviewStatus.providerId;
    }
    const initialPhase = initialVoiceDraftPendingPhase(mode);
    setActiveVoiceDraftPendingPhase(initialPhase);
    const pending = pendingSessionVoiceForStart({
      mode,
      targetSessionKey: sessionKeyRef.current,
      idempotencyKey,
      transcriptionProvider,
    });
    await startVoice({ sessionVoice: pending });
  }

  function logEvenHubEvent(event: EvenHubEvent, action: string | null) {
    if (!evenHubEventDiagnosticsEnabled()) return;
    const now = Date.now();
    const previous = lastEvenHubEventAtRef.current;
    lastEvenHubEventAtRef.current = now;
    const entry: EvenHubEventLog = {
      id: evenHubEventIdRef.current += 1,
      at: new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 }),
      deltaMs: previous === null ? null : now - previous,
      action: action || "-",
      payload: evenHubEventPayload(event),
    };
    evenHubEventDiagnosticLog("[Even G2 event]", entry);
    try {
      const current = JSON.parse(globalThis.localStorage?.getItem(EVEN_HUB_EVENT_STORAGE_KEY) || "[]") as unknown;
      const currentEvents = parseEvenHubEventLogs(current, Number.MAX_SAFE_INTEGER);
      const nextEvents = [entry, ...currentEvents].slice(0, MAX_EVEN_HUB_EVENTS);
      globalThis.localStorage?.setItem(EVEN_HUB_EVENT_STORAGE_KEY, JSON.stringify(nextEvents));
      setEvenHubEvents(nextEvents);
    } catch {
      // Even Hub event diagnostics must never affect glasses control handling.
    }
    if (shouldMirrorEvenHubEventsToDevServer()) {
      void fetch(EVEN_HUB_EVENT_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(entry),
        keepalive: true,
      }).catch(() => {
        // The endpoint only exists during local Vite development.
      });
    }
  }

  function executeGlassInputRoute(route: GlassInputRoute) {
    switch (route.action) {
      case "show-setup-required":
        void renderConnectionGuidance("setup required");
        return;
      case "connect":
        renderGatewayConnectingFrame();
        connect();
        return;
      case "approval-allow":
        resolveApproval("allow-once");
        return;
      case "approval-deny":
        resolveApproval("deny");
        return;
      case "render-approval":
        renderGlassApproval();
        return;
      case "hide-canvas":
        renderGlassSessionHome("canvas hidden");
        return;
      case "render-voice-setup":
        renderGlassVoiceSetupStep();
        return;
      case "render-session-home":
        renderGlassSessionHome(route.status, { force: route.force });
        return;
      case "render-voice-draft-pending":
        renderGlassVoiceDraftPending();
        return;
      case "send-voice-draft":
        sendCurrentVoiceDraft();
        return;
      case "discard-voice-draft":
        discardCurrentVoiceDraft();
        return;
      case "render-voice-draft":
        renderGlassVoiceDraft();
        return;
      case "move-session-log":
        moveSessionLogCursor(route.direction);
        return;
      case "request-exit":
        void requestGlassAppExit();
        return;
      case "start-session-voice":
        void startSessionVoice();
        return;
      case "skip-canvas-tutorial":
        skipCanvasTutorial();
        return;
      case "cancel-voice-input":
        clearListeningTapStopTimer();
        cancelVoiceInput();
        return;
      case "stop-voice":
        scheduleListeningTapStop();
        return;
      case "ignore":
        return;
    }
  }

  function handleEvenHubBridgeEvent(event: EvenHubEvent) {
    activateWebViewKeepAlive("evenHubEvent");
    const lifecycleAction = evenHubLifecycleActionFromEvent(event);
    const action = glassInputActionFromEvent(event);
    logEvenHubEvent(event, action);
    const lifecycleRoute = evenHubLifecycleRoute({
      action: lifecycleAction,
      shouldProcess: lifecycleAction ? shouldProcessLifecycleAction(lifecycleAction) : false,
    });
    if (executeEvenHubLifecycleRoute(lifecycleRoute)) return;
    if (action) handleGlassInputAction(action);
  }

  function executeEvenHubLifecycleRoute(route: EvenHubLifecycleRouteResult) {
    switch (route) {
      case "resume-foreground":
        resumeForegroundWork();
        return true;
      case "pause-foreground":
        handleForegroundExitSignal();
        return true;
      case "close-transport":
        closeAppTransport("closed");
        return true;
      case "ignore":
        return true;
      case "none":
        return false;
    }
  }

  function handleGlassInputAction(action: GlassInputEventAction) {
    devLog("[Even G2 input]", {
      action,
      view: glassViewRef.current,
      sessionLogCursor: sessionLogCursorRef.current,
    });
    const route = glassInputRoute({
      action,
      connected: connectedRef.current,
      hasGatewaySetup: Boolean(gatewayUrlRef.current.trim()),
      status: statusRef.current,
      view: glassViewRef.current,
    });
    executeGlassInputRoute(route);
  }

  function attachDeviceStatusBridgeListeners(
    bridge: EvenAppBridge,
    options: { isCancelled: () => boolean },
  ) {
    void bridge.getDeviceInfo()
      .then((info) => {
        if (options.isCancelled()) return;
        latestDeviceInfoRef.current = info;
        latestDeviceStatusRef.current = info?.status ?? latestDeviceStatusRef.current;
      })
      .catch((error) => {
        devLog("[Even G2] getDeviceInfo failed", error);
      });
    return bridge.onDeviceStatusChanged((status) => {
      latestDeviceStatusRef.current = status;
      latestDeviceInfoRef.current?.updateStatus(status);
      devLog("[Even G2 device status]", serializableDeviceStatus(status));
    });
  }

  async function loadAndApplyBridgeSettings(
    bridge: EvenAppBridge,
    options: { isCancelled: () => boolean },
  ) {
    try {
      const stored = await loadBridgeSettings(bridge, {
        gatewayUrl: gatewayUrlRef.current,
        selectedSessionKey: sessionKeyRef.current,
        lastSeenNodeId: lastSeenNodeIdRef.current,
        voiceMode: voiceModeRef.current,
        preferredReviewProvider: preferredReviewProviderRef.current,
        voiceRecordingLimitSeconds: voiceRecordingLimitSecondsRef.current,
        canvasTutorialCompleted: canvasTutorialCompletedRef.current,
      });
      if (options.isCancelled() || userEditedSettingsRef.current) return;
      if (applySimulatorFixture(bridge)) return;
      const plan = loadedBridgeSettingsPlan(stored);
      if (plan.selectedSessionKey) {
        setActiveSessionKey(plan.selectedSessionKey);
      }
      if (plan.lastSeenNodeId) {
        setActiveLastSeenNodeId(plan.lastSeenNodeId);
      }
      if (plan.voiceMode) {
        setActiveVoiceMode(plan.voiceMode);
      }
      if (plan.preferredReviewProvider) {
        setActivePreferredReviewProvider(plan.preferredReviewProvider);
      }
      setActiveVoiceRecordingLimitSeconds(plan.voiceRecordingLimitSeconds);
      setActiveCanvasTutorialCompleted(plan.canvasTutorialCompleted);
      if (plan.gatewayUrl) {
        setActiveGatewayUrl(plan.gatewayUrl, { setupDraft: true });
      }
      if (plan.presentation === "connecting") {
        renderGatewayConnectingFrame(bridge);
        return;
      }
      await renderSetupPrompt(bridge);
    } catch {
      // Best-effort bridge settings load; browser settings and setup UI remain available.
    }
  }

  useEffect(() => {
    function handleKeepAliveUserGesture() {
      activateWebViewKeepAlive("userGesture");
    }
    window.addEventListener("pointerdown", handleKeepAliveUserGesture, { passive: true });
    window.addEventListener("touchstart", handleKeepAliveUserGesture, { passive: true });
    window.addEventListener("keydown", handleKeepAliveUserGesture);
    return () => {
      window.removeEventListener("pointerdown", handleKeepAliveUserGesture);
      window.removeEventListener("touchstart", handleKeepAliveUserGesture);
      window.removeEventListener("keydown", handleKeepAliveUserGesture);
    };
  }, []);

  useEffect(() => {
    if (shouldDisableEvenBridge()) return;
    let cancelled = false;
    let unsubscribeEvenHubEvents: (() => void) | null = null;
    let unsubscribeDeviceStatus: (() => void) | null = null;
    waitForEvenAppBridge()
      .then((bridge) => {
        if (cancelled) return;
        bridgeRef.current = bridge;
        activateWebViewKeepAlive("bridgeReady");
        unsubscribeDeviceStatus = attachDeviceStatusBridgeListeners(bridge, {
          isCancelled: () => cancelled,
        });
        const unsubscribe = bridge.onEvenHubEvent(handleEvenHubBridgeEvent);
        unsubscribeEvenHubEvents = typeof unsubscribe === "function" ? unsubscribe : null;
        void loadAndApplyBridgeSettings(bridge, {
          isCancelled: () => cancelled,
        });
      })
      .catch(() => {
        bridgeRef.current = null;
      });
    return () => {
      cancelled = true;
      unsubscribeEvenHubEvents?.();
      unsubscribeDeviceStatus?.();
      deactivateKeepAlive();
    };
  }, []);

  function clearReconnectTimer() {
    clearWindowTimeoutRef(reconnectTimerRef);
    setRetryDueAtMs(null);
  }

  function retryOperatorApprovalNow(statusText: string) {
    const ws = wsRef.current;
    if (!(ws instanceof GatewayDirectTransport) || !ws.retryOperatorApproval()) return false;
    reconnectPausedRef.current = false;
    clearReconnectTimer();
    setStatus(statusText);
    return true;
  }

  function scheduleReconnect(reason = "disconnected", options: { operatorOnly?: boolean } = {}) {
    if (!gatewayUrlRef.current || reconnectTimerRef.current !== null) return;
    if (connectedRef.current && !options.operatorOnly) return;
    const attempt = Math.min(reconnectAttemptRef.current, 5);
    const delayMs = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * (2 ** attempt));
    reconnectAttemptRef.current += 1;
    setRetryDueAtMs(Date.now() + delayMs);
    setStatus(`${reason}; retrying in ${Math.ceil(delayMs / 1000)}s`);
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      setRetryDueAtMs(null);
      if (options.operatorOnly) {
        if (retryOperatorApprovalNow("checking operator approval")) return;
        if (connectedRef.current) return;
      }
      connect();
    }, delayMs);
  }

  function retryNow() {
    if (!gatewayUrlRef.current.trim()) return;
    if (retryOperatorApprovalNow("checking operator approval")) return;
    if (connectedRef.current) return;
    reconnectGatewayNow("retrying now");
  }

  function reconnectGatewayNow(statusText: string) {
    if (!gatewayUrlRef.current.trim()) return;
    reconnectPausedRef.current = false;
    clearReconnectTimer();
    setStatus(statusText);
    connect();
  }

  function checkGatewayStatus() {
    if (!gatewayUrlRef.current.trim()) return;
    const ws = wsRef.current;
    if (!ws || !isGatewayTransportOpen(ws.readyState, WebSocket.OPEN)) {
      retryNow();
      return;
    }
    reconnectPausedRef.current = false;
    clearReconnectTimer();
    setStatus("node approval required; checking");
    sendGatewayOutboxRequest(ws, gatewayNodeApprovalRefreshRequest());
    sendGatewaySessionBootstrapRequests(ws);
    requestSessionTranscript(sessionKeyRef.current, { force: true });
    void refreshTalkReviewStatus({ silent: true });
  }

  function openVoiceSetupPanel() {
    setVoicePanelOpen(true);
  }

  function disconnect() {
    clearReconnectTimer();
    closeVoiceTransportWithoutFinalize();
    setActiveTalkReviewStatus(unknownTalkCatalogReviewStatus());
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws && shouldCloseGatewayTransport(ws.readyState, WebSocket.CLOSING)) ws.close();
    setActiveConnected(false);
  }

  function closeAppTransport(statusText = "closed") {
    disconnect();
    setStatus(statusText);
  }

  async function forgetSetupCode() {
    userEditedSettingsRef.current = true;
    disconnect();
    setActiveGatewayUrl("", { setupDraft: true });
    resetPairingScopedState();
    setSetupScanStatus("Setup code removed. Scan a new OpenClaw QR to sign in again.");
    setActiveTalkReviewStatus(unknownTalkCatalogReviewStatus());
    clearBrowserClientSettings(localStorage, clearBrowserDeviceCredentials);
    const bridge = bridgeRef.current;
    if (bridge) await clearBridgeClientSettings(bridge).catch(() => undefined);
    await renderSetupPrompt();
  }

  async function setUpAgain() {
    await forgetSetupCode();
    await scanSetupQr();
  }

  function handleGatewayTransportOpened(ws: GatewayTransport) {
    reconnectAttemptRef.current = 0;
    reconnectPausedRef.current = false;
    setActiveConnected(true);
    setStatus("connected");
    stripBootstrapSetupTokenFromState();
    sendGatewaySessionBootstrapRequests(ws);
    void refreshTalkReviewStatus();
    requestSessionTranscript(sessionKeyRef.current, { force: true });
    renderGlassSessionHome("connected", { force: true });
  }

  function handleGatewayTransportClosed(event: Event) {
    wsRef.current = null;
    setActiveConnected(false);
    clearSessionTranscriptLoadingState();
    const reason = closeReasonFromEvent(event);
    const nextStatus = gatewayCloseStatus(reason, statusRef.current);
    setStatus(nextStatus);
    if (reason) void renderConnectionGuidance(nextStatus);
    if (!reconnectPausedRef.current) scheduleReconnect(reason ? "needs attention" : nextStatus);
  }

  function handleGatewayTransportError() {
    setActiveConnected(false);
    clearSessionTranscriptLoadingState();
    const nextStatus = gatewayErrorStatus(statusRef.current);
    setStatus(nextStatus);
    if (!reconnectPausedRef.current) scheduleReconnect(nextStatus);
  }

  function handleGatewayTransportMessage(ws: GatewayTransport, event: MessageEvent) {
    const msg = parseGatewayMessageData(event.data);
    if (!msg) return;
    handleGatewayMessage(ws, msg);
  }

  function connect() {
    reconnectPausedRef.current = false;
    clearReconnectTimer();
    stopVoice();
    clearSessionTranscriptLoadingState();
    const previous = wsRef.current;
    wsRef.current = null;
    if (previous && shouldCloseGatewayTransport(previous.readyState, WebSocket.CLOSING)) previous.close();
    const setupCodeOrUrl = gatewayUrlRef.current.trim();
    if (!setupCodeOrUrl) {
      setActiveConnected(false);
      setStatus("setup required");
      void renderConnectionGuidance("setup required");
      return;
    }
    setStatus("connecting");
    setActiveTalkReviewStatus(gatewayWaitingTalkCatalogReviewStatus(talkReviewStatusRef.current.providers));
    try {
      const ws: GatewayTransport = new GatewayDirectTransport({
        setupCodeOrUrl,
        token: "",
        selectedSessionKey: sessionKeyRef.current || undefined,
        storage: createBridgeMirroredCredentialStorage(bridgeRef.current),
      });
      wsRef.current = ws;
      attachCurrentGatewayTransportListeners(ws, {
        isCurrent: () => wsRef.current === ws,
        onOpen: () => handleGatewayTransportOpened(ws),
        onClose: handleGatewayTransportClosed,
        onError: handleGatewayTransportError,
        onMessage: (event) => handleGatewayTransportMessage(ws, event),
      });
      if (ws instanceof GatewayDirectTransport) ws.connect();
    } catch (err) {
      const nextStatus = err instanceof Error ? err.message : String(err);
      setStatus(nextStatus);
      void renderConnectionGuidance(nextStatus);
      scheduleReconnect("connection failed");
    }
  }

  useEffect(() => {
    if (!gatewayUrl) {
      clearReconnectTimer();
      if (!connected) setStatus("setup required");
      return;
    }
    if (connected || wsRef.current || reconnectTimerRef.current !== null) return;
    connect();
  }, [connected, gatewayUrl]);

  useEffect(() => {
    if (!connected || voiceMode !== "review") return undefined;
    void refreshTalkReviewStatus({ silent: true });
    const timer = window.setInterval(() => {
      void refreshTalkReviewStatus({ silent: true });
    }, 12000);
    return () => window.clearInterval(timer);
  }, [connected, voiceMode, preferredReviewProvider]);

  const acceptSetupCode = useCallback((setupCode: string) => {
    const normalized = setupCodeFromQrValue(setupCode);
    if (!normalized) {
      setSetupScanStatus("Setup code is empty.");
      void renderGlass(setupCodeMissingHudFrame());
      return;
    }
    try {
      parseSetupCode(normalized);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus("setup code invalid");
      setSetupScanStatus(message);
      void renderGlass(setupCodeInvalidHudFrame(message));
      return;
    }
    userEditedSettingsRef.current = true;
    setSetupScannerOpen(false);
    disconnect();
    setActiveGatewayUrl(normalized, { setupDraft: true });
    resetPairingScopedState();
    setSetupScanStatus("Setup QR scanned. Connecting...");
    void renderGlass(setupQrScannedHudFrame());
  }, []);

  function submitSetupCodeFallback(value = setupCodeDraft) {
    acceptSetupCode(value);
  }

  async function copyGatewaySetupRequest(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setGatewayRequestCopyStatus("Copied. Send it to your usual OpenClaw chat, then come back and check again.");
    } catch {
      setGatewayRequestCopyStatus("Copy failed. Select the text and send it to OpenClaw manually.");
    }
  }

  async function refreshTalkReviewStatus(options: { silent?: boolean } = {}): Promise<TalkCatalogReviewStatus> {
    const ws = wsRef.current;
    if (!ws || !isGatewayTransportOpen(ws.readyState, WebSocket.OPEN) || !ws.request) {
      const next = unknownTalkCatalogReviewStatus();
      setActiveTalkReviewStatus(next);
      return next;
    }
    if (!options.silent) {
      setActiveTalkReviewStatus(checkingTalkCatalogReviewStatus(talkReviewStatusRef.current.providers));
    }
    try {
      const catalog = await ws.request("talk.catalog", undefined, 8000);
      const next = analyzeTalkCatalogForReview(catalog, preferredReviewProviderRef.current);
      setActiveTalkReviewStatus(next);
      return next;
    } catch (error) {
      const next = unavailableTalkCatalogReviewStatus(error, talkReviewStatusRef.current.providers);
      setActiveTalkReviewStatus(next);
      return next;
    }
  }

  function handleGatewayReadyOrRuntimeStatus(msg: GatewayReadyOrRuntimeStatusMessage) {
    if (msg.type === "eveng2.runtime.status") {
      const update = runtimeStatusSessionUpdate(msg, sessionKeyRef.current);
      const hadPendingNodeApproval = Boolean(
        nodeApprovalStatusRef.current || nodeApprovalRequiredFromSnapshot(nodeSnapshotRef.current),
      );
      if (update.nextSessionKey) {
        setActiveSessionKey(update.nextSessionKey);
        if (update.shouldRequestTranscript) requestSessionTranscript(update.nextSessionKey);
      }
      if (update.hasNodeSnapshot) setActiveNodeSnapshot(update.nodeSnapshot);
      if (update.nodeApprovalRequired) {
        setActiveNodeApprovalStatus({ ...update.nodeApprovalRequired, requestId: undefined });
        const nextStatus = nodeApprovalRequiredStatus();
        setStatus(nextStatus);
        void renderConnectionGuidance(nextStatus);
        return;
      }
      const approvalState = update.nodeSnapshot?.approvalState;
      if (nodeApprovalStateExplicitlyReady(approvalState)) {
        setActiveNodeApprovalStatus(null);
        if (hadPendingNodeApproval && !canvasTutorialCompletedRef.current) {
          renderCanvasTutorial();
          return;
        }
      }
    }
    if (!pendingSessionVoiceRef.current) setStatus("ready");
    if (glassViewRef.current === "sessionHome") renderGlassSessionHome("ready");
  }

  function handleGatewayNodeApprovalMessage(msg: GatewayNodeApprovalMessage) {
    if (msg.type === "eveng2.node.approval.required") {
      if (msg.nodeId) mergeActiveNodeSnapshot({ nodeId: msg.nodeId });
      setActiveNodeApprovalStatus({ ...msg, requestId: undefined });
      const nextStatus = nodeApprovalRequiredStatus();
      setStatus(nextStatus);
      void renderConnectionGuidance(nextStatus);
      return;
    }
    setActiveNodeApprovalStatus(null);
    markActiveNodeApprovalReady();
    if (!canvasTutorialCompletedRef.current) {
      renderCanvasTutorial();
      return;
    }
    if (shouldRestoreReadyAfterNodeApproval(statusRef.current)) {
      setStatus("ready");
      if (glassViewRef.current === "sessionHome") renderGlassSessionHome("ready");
    }
  }

  function handleGatewaySessionMessage(ws: GatewayTransport, msg: GatewaySessionMessage) {
    switch (msg.type) {
      case "eveng2.session.config.snapshot":
      case "eveng2.session.switch.applied": {
        emitE2eSessionState({ action: msg.type, sessionKey: msg.sessionKey });
        const update = sessionConfigOrSwitchUpdate(msg, sessionKeyRef.current);
        if (update.nextSessionKey) {
          setActiveSessionKey(update.nextSessionKey);
          if (update.shouldResetTranscript) {
            resetSessionTranscriptState();
          }
          if (update.shouldRequestTranscript) requestSessionTranscript(update.nextSessionKey, { force: true });
          if (update.shouldRenderSessionHomeReady) {
            if (glassViewRef.current !== "sessionHome") renderGlassSessionHome("ready");
          }
        }
        return;
      }
      case "eveng2.session.create.failed":
        setStatus("session create failed");
        void renderGlass(formatGlassSessionCreateFailedFrame(msg.error));
        return;
      case "eveng2.session.list.result":
        emitE2eSessionState({ action: "session-list-result", count: msg.sessions?.length || 0 });
        handleGatewaySessionListResult(ws, msg);
        return;
      case "eveng2.session.transcript.snapshot":
        handleGatewaySessionTranscriptSnapshot(msg);
        return;
      case "eveng2.session.send.ack":
        handleGatewaySessionSendAck(msg);
        return;
    }
  }

  function handleGatewaySessionListResult(
    ws: GatewayTransport,
    msg: GatewaySessionListResultMessage,
  ) {
    const update = gatewaySessionListUpdate(msg.sessions, sessionKeyRef.current);
    applySessionList(update.sessions);
    if (update.shouldSwitchSession) {
      applyActiveSessionSelection(update.activeSessionKey, { resetTranscript: update.shouldResetTranscript });
      sendGatewayOutboxRequest(ws, gatewaySessionSwitchRequest(update.activeSessionKey));
      if (update.shouldRequestTranscript) requestSessionTranscript(update.activeSessionKey, { force: true });
      setStatus("selected session");
    }
    if (glassViewRef.current === "sessionHome") renderGlassSessionHome();
  }

  function handleGatewaySessionTranscriptSnapshot(
    msg: GatewaySessionTranscriptSnapshotMessage,
  ) {
    if (msg.sessionKey && msg.sessionKey !== sessionKeyRef.current) return;
    if (!msg.sessionKey && sessionTranscriptRequestedSessionKeyRef.current && sessionTranscriptRequestedSessionKeyRef.current !== sessionKeyRef.current) return;
    emitE2eSessionState({
      action: "transcript-snapshot",
      sessionKey: msg.sessionKey,
      count: msg.messages?.length || 0,
    });
    const update = sessionTranscriptSnapshotUpdate({
      snapshot: msg,
      loadingLimit: sessionTranscriptLoadingLimitRef.current,
      currentRawLimit: sessionTranscriptRawLimitRef.current,
      existingMessages: sessionTranscriptRef.current,
      currentCursor: sessionLogCursorRef.current,
      pendingExpand: pendingHistoryExpandRef.current,
    });
    applySessionTranscriptSnapshotUpdate(update);
    setSessionTranscriptError(msg.error || "");
    if (update.shouldAutoExpand && update.autoExpandLimit !== null) {
      setStatus("loading session log");
      if (glassViewRef.current === "sessionHome") renderGlassSessionHome("loading session log");
      requestSessionTranscript(msg.sessionKey || sessionKeyRef.current, { limit: update.autoExpandLimit, force: true });
      return;
    }
    sessionLogCursorRef.current = update.nextCursor;
    const nextStatus = nextSessionTranscriptStatusAfterSnapshot({
      error: msg.error,
      expandedHistory: update.expandedHistory,
      visibleScreenCount: update.visibleScreenCount,
      currentStatus: statusRef.current,
    });
    if (nextStatus !== statusRef.current) setStatus(nextStatus);
    if (glassViewRef.current === "sessionHome") renderGlassSessionHome(msg.error ? "log unavailable" : nextStatus);
  }

  function applySessionTranscriptSnapshotUpdate(
    update: SessionTranscriptSnapshotUpdate,
  ) {
    sessionTranscriptLoadingLimitRef.current = null;
    if (update.clearPendingExpand) pendingHistoryExpandRef.current = null;
    sessionTranscriptRawLimitRef.current = update.nextRawLimit;
    sessionTranscriptHasFullHistoryRef.current = update.hasFullHistory;
    if (!update.shouldKeepExistingExpandedHistory) {
      setActiveSessionTranscript(update.messages);
    }
  }

  function handleGatewaySessionSendAck(
    msg: GatewaySessionSendAckMessage,
  ) {
    setStatus("sent to OpenClaw");
    if (sessionSendAckMatchesCurrentSession(msg, sessionKeyRef.current)) {
      requestSessionTranscript(sessionKeyRef.current);
      if (glassViewRef.current === "sessionHome") renderGlassSessionHome("sent");
    }
  }

  function handleGatewayApprovalMessage(msg: GatewayApprovalMessage) {
    emitE2eApprovalState({
      action: msg.type,
      id: msg.id,
      requestId: msg.requestId,
      decision: "decision" in msg ? msg.decision : undefined,
      status: "status" in msg ? msg.status : undefined,
    });
    const update = gatewayApprovalUpdate(msg, pendingApprovalRef.current);
    if (update.action === "request") {
      setActivePendingApproval(update.pendingApproval);
      setStatus(update.status);
      renderGlassApproval(update.pendingApproval);
      return;
    }
    if (update.action === "resolved") {
      setPendingApproval((current) => {
        const nextUpdate = gatewayApprovalUpdate(msg, current);
        if (nextUpdate.action === "resolved" && nextUpdate.shouldClearPendingApproval) {
          pendingApprovalRef.current = null;
          if (glassViewRef.current === "approval") renderGlassSessionHome(nextUpdate.renderSessionHomeStatus);
        }
        return nextUpdate.action === "resolved" && nextUpdate.shouldClearPendingApproval ? null : current;
      });
      return;
    }
    if (update.action === "ack") {
      setStatus(update.status);
      if (!update.shouldClearPendingApproval) return;
      setActivePendingApproval(null);
      if (glassViewRef.current === "approval") renderGlassSessionHome(update.renderSessionHomeStatus);
    }
  }

  function handleGatewayErrorMessage(msg: GatewayErrorMessage) {
    const nextStatus = gatewayErrorStatusFromMessage(msg);
    const plan = connectionErrorPresentationPlan(nextStatus, msg.error, Boolean(gatewayUrlRef.current.trim()));
    const retryAwaitingApproval = msg.pauseReconnect === true && shouldRetryWhileAwaitingApproval(plan);
    reconnectPausedRef.current = (msg.pauseReconnect === true && !retryAwaitingApproval) || plan.reconnectReason === "";
    setStatus(nextStatus);
    if (plan.target === "guidance") void renderConnectionGuidance(plan.statusText);
    else void renderGlass(plan.frame);
    if ((msg.pauseReconnect !== true || retryAwaitingApproval) && plan.reconnectReason) {
      scheduleReconnect(retryAwaitingApproval ? nextStatus : plan.reconnectReason, { operatorOnly: retryAwaitingApproval });
    }
  }

  function handleGatewayMessage(ws: GatewayTransport, msg: GatewayMessage) {
    switch (msg.type) {
      case "ready":
      case "eveng2.runtime.status":
        handleGatewayReadyOrRuntimeStatus(msg);
        return;
      case "eveng2.node.command":
        void handleNodeCommand(msg);
        return;
      case "eveng2.node.approval.required":
      case "eveng2.node.approval.ready":
        handleGatewayNodeApprovalMessage(msg);
        return;
      case "eveng2.session.config.snapshot":
      case "eveng2.session.switch.applied":
      case "eveng2.session.create.failed":
      case "eveng2.session.list.result":
      case "eveng2.session.transcript.snapshot":
      case "eveng2.session.send.ack":
        handleGatewaySessionMessage(ws, msg);
        return;
      case "eveng2.approval.request":
      case "eveng2.approval.resolved":
      case "eveng2.approval.resolve.ack":
        handleGatewayApprovalMessage(msg);
        return;
      case "error":
        handleGatewayErrorMessage(msg);
        return;
      case "eveng2.session.voice.sent":
      case "pong":
        return;
    }
  }

  async function scanSetupQr() {
    setSetupScanStatus("");
    setSetupScannerOpen(true);
    await renderGlass(setupQrScanPromptHudFrame());
  }

  async function scanSetupQrWithNativeCamera() {
    const bridge = bridgeRef.current;
    if (!bridge) {
      setSetupScanStatus("Even Hub camera fallback is only available inside Even Hub.");
      return;
    }
    setSetupScanStatus("Opening Even Hub camera...");
    try {
      const image = await bridge.captureImageFromCamera();
      if (!image) {
        setSetupScanStatus("Camera closed before a QR was captured.");
        return;
      }
      setSetupScanStatus("Reading QR image...");
      const setupCode = await decodeSetupQrFromImage(image);
      if (!setupCode) {
        setSetupScanStatus("No setup QR found. Keep the QR large, flat, and fully inside the camera frame.");
        await renderGlass(setupQrNotFoundHudFrame());
        return;
      }
      acceptSetupCode(setupCode);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSetupScanStatus(message);
      await renderGlass(setupQrScanFailedHudFrame(message));
    }
  }

  function sendNodeCommandResult(
    id: string,
    ok: boolean,
    payload: Record<string, unknown> = {},
    error?: { code: string; message: string },
  ) {
    const ws = wsRef.current;
    const canSend = canSendGatewayNodeCommandResult({
      readyState: ws?.readyState,
      openState: WebSocket.OPEN,
      canSendOverride: ws?.canSendNodeCommandResult?.(),
    });
    if (!id || !ws || !canSend) return;
    sendGatewayOutboxRequest(ws, gatewayNodeCommandResultRequest(id, ok, payload, error));
  }

  function sendPlannedNodeCommandResult(result: PlannedNodeCommandResult) {
    sendNodeCommandResult(result.id, result.ok, result.payload, result.error);
  }

  function completePendingNodeVoiceCommand(result: PlannedNodeCommandResult) {
    clearPendingNodeVoiceCommand();
    sendPlannedNodeCommandResult(result);
    if (result.status) setStatus(result.status);
  }

  function hasForegroundBridge() {
    return isForegroundBridgeAvailable(Boolean(bridgeRef.current), document.visibilityState);
  }

  function handleDeviceNodeCommand(id: string, command: string) {
    if (nodeCommandFamily(command) !== "device") return false;
    const payload = deviceNodeCommandPayload(command, {
      connected: connectedRef.current,
      bridgeLive: hasForegroundBridge(),
      keepAlive: keepAliveState(),
      activeSessionKey: sessionKeyRef.current,
      view: glassViewRef.current,
      listening: listeningRef.current,
      deviceStatus: latestDeviceStatusRef.current,
      version: APP_VERSION,
      deviceInfo: latestDeviceInfoRef.current,
      canvasWidth: GLASS_CANVAS_WIDTH,
      canvasHeight: GLASS_CANVAS_HEIGHT,
      gatewayConnected: connectedRef.current,
    });
    if (!payload) return false;
    sendNodeCommandResult(id, true, payload);
    return true;
  }

  function clearPendingNodeVoiceStopTimer() {
    clearWindowTimeoutRef(pendingNodeVoiceStopTimerRef);
  }

  function clearPendingNodeVoiceCommand() {
    pendingNodeVoiceCommandIdRef.current = null;
    clearPendingNodeVoiceStopTimer();
  }

  function clearPendingSessionVoice() {
    pendingSessionVoiceRef.current = null;
  }

  function clearVoiceHardStopTimer() {
    clearWindowTimeoutRef(voiceHardStopTimerRef);
  }

  function clearVoiceFinalizeCloseTimer() {
    clearWindowTimeoutRef(voiceFinalizeCloseTimerRef);
  }

  function clearListeningTapStopTimer() {
    clearWindowTimeoutRef(listeningTapStopTimerRef);
  }

  function scheduleListeningTapStop() {
    clearListeningTapStopTimer();
    listeningTapStopTimerRef.current = window.setTimeout(() => {
      listeningTapStopTimerRef.current = null;
      stopVoice();
    }, 250);
  }

  function clearVoiceCaptureTimers() {
    clearVoiceHardStopTimer();
    clearVoiceFinalizeCloseTimer();
    clearListeningTapStopTimer();
    clearVoiceRecordingPulseTimer();
  }

  function clearCanvasRestoreTimer() {
    clearWindowTimeoutRef(canvasRestoreTimerRef);
  }

  function applyCanvasPresentationState(state: CanvasPresentationState, options: { preview?: boolean } = {}) {
    setActiveCanvasState(state);
    setActiveGlassView(state.view);
    if (options.preview) glassPreviewTextRef.current = state.previewText;
  }

  function renderCanvasUnavailable() {
    setActiveCanvasText("");
    renderGlassSessionHome("canvas unavailable");
  }

  function scheduleCanvasMessageRestore(restoreText: string, ttlMs: number) {
    canvasRestoreTimerRef.current = window.setTimeout(() => {
      canvasRestoreTimerRef.current = null;
      if (canvasTextRef.current !== restoreText) return;
      setActiveCanvasText("");
      renderGlassSessionHome("ready");
    }, ttlMs);
  }

  function scheduleVoiceHardStop(timeoutMs: number) {
    clearVoiceHardStopTimer();
    const safeTimeoutMs = voiceHardStopTimeoutMs(timeoutMs);
    voiceHardStopTimerRef.current = window.setTimeout(() => {
      voiceHardStopTimerRef.current = null;
      if (!voiceCaptureOpeningOrActive()) return;
      setStatus("voice: stopped after safety limit");
      stopVoice();
    }, safeTimeoutMs);
  }

  async function presentImageCanvas(id: string, imagePayload: CanvasImagePayload) {
    try {
      clearCanvasRestoreTimer();
      const tiles = await canvasImagePayloadToTiles(imagePayload);
      const rendered = await renderGlassImageCanvas(bridgeRef.current, tiles);
      if (!rendered) {
        renderGlassSessionHome("canvas unavailable");
        sendNodeCommandResult(id, false, {}, glassRenderFailedError("image canvas"));
        return;
      }
      const state = imageCanvasPresentationState(imagePayload);
      applyCanvasPresentationState(state, { preview: true });
      completeCanvasTutorial();
      sendNodeCommandResult(id, true, imageCanvasCommandResult({
        state,
        width: GLASS_CANVAS_WIDTH,
        height: GLASS_CANVAS_HEIGHT,
      }));
    } catch (error) {
      if (error instanceof CanvasImageSourceTooLargeError) {
        sendNodeCommandResult(id, false, {}, canvasImageTooLargeError({ maxPixels: error.maxPixels }));
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      sendNodeCommandResult(id, false, {}, canvasImageFailedError(message));
    }
  }

  async function presentMessageCanvas(
    id: string,
    params: Record<string, unknown>,
    kind: CanvasMessageKind,
    text: string,
  ) {
    clearCanvasRestoreTimer();
    const presentation = canvasMessagePresentationFromParams(params, kind, text);
    const glassFrame = glassStatusFrame(presentation.title, presentation.body, presentation.hint);
    const glassText = glassHudFrameToText(glassFrame);
    const state = messageCanvasPresentationState(kind, glassText);
    applyCanvasPresentationState(state);
    const rendered = await renderGlass(glassFrame);
    if (!rendered) {
      renderCanvasUnavailable();
      sendNodeCommandResult(id, false, {}, glassRenderFailedError("message canvas"));
      return;
    }
    scheduleCanvasMessageRestore(glassText, presentation.ttlMs);
    completeCanvasTutorial();
    sendNodeCommandResult(id, true, messageCanvasCommandResult(kind, presentation));
  }

  async function presentTextCanvas(id: string, text: string) {
    clearCanvasRestoreTimer();
    const state = textCanvasPresentationState(text);
    applyCanvasPresentationState(state);
    const rendered = await renderGlass(state.text);
    if (!rendered) {
      renderCanvasUnavailable();
      sendNodeCommandResult(id, false, {}, glassRenderFailedError("canvas"));
      return;
    }
    completeCanvasTutorial();
    sendNodeCommandResult(id, true, textCanvasCommandResult(text));
  }

  function hideCanvas(id: string) {
    clearCanvasRestoreTimer();
    setActiveCanvasState({ mode: "text", text: "" });
    renderGlassSessionHome("ready");
    sendNodeCommandResult(id, true, canvasHideCommandResult());
  }

  function sendCanvasSnapshot(id: string) {
    sendNodeCommandResult(id, true, canvasSnapshotCommandResult({
      glassView: glassViewRef.current,
      canvasText: canvasTextRef.current,
      canvasMode: canvasModeRef.current,
    }));
  }

  async function handleCanvasNodeCommand(id: string, command: string, msg: NodeCommandMessage) {
    if (nodeCommandFamily(command) !== "canvas") return false;
    const plan = canvasNodeCommandPlan(command, msg.params || {});
    if (!plan) return false;
    if (plan.requiresBridge && !hasForegroundBridge()) {
      sendNodeCommandResult(id, false, {}, evenG2BridgeUnavailableError());
      return true;
    }
    switch (plan.action) {
      case "present-image":
        await presentImageCanvas(id, plan.imagePayload);
        return true;
      case "remote-image-unsupported":
        sendNodeCommandResult(id, false, {}, canvasImageUrlUnsupportedError());
        return true;
      case "image-too-large":
        sendNodeCommandResult(id, false, {}, canvasImageTooLargeError(plan.maxBytes));
        return true;
      case "present-message":
        await presentMessageCanvas(id, plan.params, plan.kind, plan.text);
        return true;
      case "present-text":
        await presentTextCanvas(id, plan.text);
        return true;
      case "hide":
        hideCanvas(id);
        return true;
      case "snapshot":
        sendCanvasSnapshot(id);
        return true;
    }
  }

  async function handleTalkPttNodeCommand(id: string, command: string, msg: NodeCommandMessage) {
    if (nodeCommandFamily(command) !== "talk") return false;
    const plan = talkPttNodeCommandPlan(command, msg.params, msg.timeoutMs);
    if (!plan) return false;
    if (!hasForegroundBridge()) {
      sendNodeCommandResult(id, false, {}, evenG2BridgeUnavailableError());
      return true;
    }
    if (voiceCaptureOpeningOrActive()) {
      sendNodeCommandResult(id, false, {}, voiceBusyError());
      return true;
    }
    await startVoice({ nodeCommandId: id, autoStopMs: plan.durationMs });
    return true;
  }

  async function handleNodeCommand(msg: NodeCommandMessage) {
    const id = nodeCommandIdFromMessage(msg);
    const command = nodeCommandNameFromMessage(msg);
    if (msg.nodeId) mergeActiveNodeSnapshot({ nodeId: msg.nodeId });
    if (!id) return;
    if (handleDeviceNodeCommand(id, command)) return;
    if (await handleCanvasNodeCommand(id, command, msg)) return;
    if (await handleTalkPttNodeCommand(id, command, msg)) return;
    sendNodeCommandResult(id, false, {}, unsupportedNodeCommandError(command));
  }

  function refreshSessions() {
    const ws = wsRef.current;
    if (!ws || !isGatewayTransportOpen(ws.readyState, WebSocket.OPEN)) return;
    emitE2eSessionState({ action: "refresh-sessions", sessionKey: sessionKeyRef.current });
    sendGatewaySessionBootstrapRequests(ws);
    requestSessionTranscript(sessionKeyRef.current, { force: true });
  }

  function switchSession(nextSessionKey: string) {
    if (!nextSessionKey || nextSessionKey === sessionKey) return;
    emitE2eSessionState({ action: "switch-session", fromSessionKey: sessionKeyRef.current, toSessionKey: nextSessionKey });
    applyActiveSessionSelection(nextSessionKey, { resetTranscript: true });
    if (!requestGatewaySessionSwitch(nextSessionKey)) return;
    setStatus("selected session");
    renderGlassSessionHome("ready");
  }

  function resolveApproval(decision: "allow-once" | "deny") {
    const approval = pendingApprovalRef.current;
    if (!approval) return;
    const ws = wsRef.current;
    if (!ws || !isGatewayTransportOpen(ws.readyState, WebSocket.OPEN)) return;
    emitE2eApprovalState({
      action: "resolve-approval",
      decision,
      id: approval.id,
      requestId: approval.requestId,
    });
    sendGatewayOutboxRequest(ws, gatewayApprovalResolveRequest(approval, decision));
    setStatus("approval sent");
    void renderGlass(formatGlassApprovalDecisionFrame(decision));
  }

  function renderGlassExitUnavailable() {
    setStatus("exit unavailable");
    renderGlassSessionHome("exit unavailable", { force: true });
  }

  async function requestGlassAppExit() {
    const bridge = bridgeRef.current;
    if (!bridge) {
      renderGlassExitUnavailable();
      return;
    }
    setStatus("exit requested");
    try {
      const ok = await bridge.shutDownPageContainer(1);
      devLog("[Even G2] shutDownPageContainer result", ok, { exitMode: 1 });
      if (ok !== true) renderGlassExitUnavailable();
    } catch (error) {
      devLog("[Even G2] shutDownPageContainer failed", error);
      renderGlassExitUnavailable();
    }
  }

  function updateVoiceText(text: string) {
    voiceTextRef.current = text;
    if (listeningRef.current && glassViewRef.current === "listening") renderListeningVoicePanel();
  }

  function resetVoiceTranscript() {
    voiceTextRef.current = "";
  }

  function voiceCaptureOpeningOrActive() {
    return voiceCaptureOpeningOrActiveFromState({
      listening: listeningRef.current,
      hasVoiceTransport: Boolean(voiceWsRef.current),
      hasPendingNodeCommand: Boolean(pendingNodeVoiceCommandIdRef.current),
      hasPendingSessionVoice: Boolean(pendingSessionVoiceRef.current),
    });
  }

  function setPendingVoiceStart(options: { nodeCommandId?: string; sessionVoice?: PendingSessionVoice }) {
    pendingNodeVoiceCommandIdRef.current = options.nodeCommandId || null;
    pendingSessionVoiceRef.current = options.sessionVoice || null;
  }

  function scheduleVoiceStartTimers(options: { nodeCommandId?: string; autoStopMs?: number }) {
    const timerPlan = voiceStartTimerPlan({
      nodeCommandId: options.nodeCommandId,
      autoStopMs: options.autoStopMs,
      userLimitMs: voiceRecordingLimitSecondsRef.current * 1000,
      defaultLimitMs: DEFAULT_VOICE_RECORDING_LIMIT_MS,
    });
    scheduleVoiceHardStop(timerPlan.hardStopMs);
    if (timerPlan.nodeAutoStopMs !== null) {
      clearPendingNodeVoiceStopTimer();
      pendingNodeVoiceStopTimerRef.current = window.setTimeout(() => {
        stopVoice();
      }, timerPlan.nodeAutoStopMs);
    }
  }

  function applyReviewFailureFromVoice(errorText: string, pendingSessionVoice: PendingSessionVoice | null) {
    const reviewFailure = reviewVoiceFailureFromPendingSession(errorText, pendingSessionVoice);
    if (!reviewFailure) return;
    const next = applyReviewVoiceFailure(talkReviewStatusRef.current, reviewFailure);
    setActiveTalkReviewStatus(next);
  }

  function handleVoiceTranscriptionFailed(payload: ParsedVoiceGatewayMessage) {
    clearVoiceRecordingPulseTimer();
    const nodeCommandId = pendingNodeVoiceCommandIdRef.current;
    const pendingSessionVoice = pendingSessionVoiceRef.current;
    const plan = voiceTranscriptionFailedPlan({
      payload,
      nodeCommandId,
      pendingSessionVoice,
      fallbackMode: voiceModeRef.current,
      at: Date.now(),
    });
    if (plan.voiceFailure) {
      setLastVoiceFailure(plan.voiceFailure);
      clearReviewVoiceVerification();
    }
    if (plan.nodeCommandResult) {
      completePendingNodeVoiceCommand(plan.nodeCommandResult);
    }
    if (plan.shouldClearPendingSessionVoice) clearPendingSessionVoice();
    applyReviewFailureFromVoice(plan.errorText, pendingSessionVoice);
    closeVoiceTransportWithoutFinalize();
    setStatus(voiceFailureStatus(plan.errorText));
    if (plan.shouldRenderFailure) renderGlassVoiceFailure(plan.errorText);
  }

  function handleVoiceProcessing(payload: ParsedVoiceGatewayMessage) {
    const pendingSessionVoice = pendingSessionVoiceRef.current;
    if (pendingSessionVoice?.mode !== "review") return;
    const phase = voiceDraftPendingPhaseFromGatewayPayload(payload);
    emitE2eVoiceState({
      action: "voice-processing",
      mode: pendingSessionVoice.mode,
      phase,
      sessionKey: pendingSessionVoice.targetSessionKey,
    });
    setActiveVoiceDraftPendingPhase(phase);
    setStatus(`voice: ${phase}`);
    renderGlassVoiceDraftPending(phase);
  }

  function handleVoiceDraftReady(payload: ParsedVoiceGatewayMessage) {
    clearVoiceRecordingPulseTimer();
    const pendingSessionVoice = pendingSessionVoiceRef.current;
    clearPendingSessionVoice();
    const plan = voiceDraftReadyPlan(payload, {
      pendingSessionVoice,
      activeSessionKey: sessionKeyRef.current,
      createIdempotencyKey: createRequestId,
    });
    if (plan.noSpeech) {
      setStatus(plan.status);
      void renderGlass(voiceNoSpeechHudFrame());
      return;
    }
    if (!plan.draft) return;
    emitE2eVoiceState({
      action: "voice-draft-ready",
      mode: pendingSessionVoice?.mode || voiceModeRef.current,
      sessionKey: plan.draft.targetSessionKey,
      textLength: plan.draft.text.length,
    });
    setActiveVoiceDraft(plan.draft);
    setLastVoiceFailure(null);
    if ((pendingSessionVoice?.mode || voiceModeRef.current) === "review") {
      markReviewVoiceVerified(pendingSessionVoice?.transcriptionProvider);
    }
    setStatus(plan.status);
    renderGlassVoiceDraft(plan.draft);
  }

  function handleVoiceDraftFailed(payload: ParsedVoiceGatewayMessage) {
    clearVoiceRecordingPulseTimer();
    const pendingSessionVoice = pendingSessionVoiceRef.current;
    const plan = voiceDraftFailedPlan({
      payload,
      pendingSessionVoice,
      fallbackMode: voiceModeRef.current,
      at: Date.now(),
    });
    if (plan.shouldClearPendingSessionVoice) clearPendingSessionVoice();
    setLastVoiceFailure(plan.voiceFailure);
    clearReviewVoiceVerification();
    applyReviewFailureFromVoice(plan.errorText, pendingSessionVoice);
    closeVoiceTransportWithoutFinalize();
    setStatus(voiceFailureStatus(plan.errorText));
    renderGlassVoiceFailure(plan.errorText);
  }

  function handleSessionVoiceSent(payload: ParsedVoiceGatewayMessage) {
    clearVoiceRecordingPulseTimer();
    const nodeCommandId = pendingNodeVoiceCommandIdRef.current;
    const pendingSessionVoice = pendingSessionVoiceRef.current;
    const plan = sessionVoiceSentPlan(payload, {
      nodeCommandId,
      pendingSessionVoice,
      activeSessionKey: sessionKeyRef.current,
      createIdempotencyKey: createRequestId,
    });
    if (plan.nodeCommandResult) {
      completePendingNodeVoiceCommand(plan.nodeCommandResult);
    }
    if (plan.optimisticUserMessage) {
      clearPendingSessionVoice();
      appendOptimisticUserMessage(
        plan.optimisticUserMessage.sessionKey,
        plan.optimisticUserMessage.text,
        plan.optimisticUserMessage.idempotencyKey,
      );
    }
    emitE2eVoiceState({
      action: "session-voice-sent",
      mode: pendingSessionVoice?.mode || voiceModeRef.current,
      sessionKey: plan.sent.sessionKey,
      idempotencyKey: plan.sent.idempotencyKey,
    });
    setLastVoiceFailure(null);
    setStatus(plan.status);
    requestSessionTranscript(plan.sent.sessionKey);
    if (glassViewRef.current === "listening" || glassViewRef.current === "sessionHome") renderGlassSessionHome(plan.sessionHomeStatus);
  }

  function handleVoiceTranscriptEvent(
    eventName: string,
    payload: ParsedVoiceGatewayMessage,
  ) {
    const nodeCommandId = pendingNodeVoiceCommandIdRef.current;
    const pendingSessionVoice = pendingSessionVoiceRef.current;
    const plan = voiceTranscriptEventPlan({
      eventName,
      payload,
      currentText: voiceTextRef.current,
      nodeCommandId,
      pendingSessionVoice,
    });
    if (plan.nextText) updateVoiceText(plan.nextText);
    if (plan.nextText) {
      emitE2eVoiceState({
        action: plan.isFinal ? "transcript-final" : "transcript-partial",
        mode: pendingSessionVoice?.mode || voiceModeRef.current,
        textLength: plan.nextText.length,
      });
    }
    if (!plan.isFinal) return;
    clearVoiceRecordingPulseTimer();
    if (plan.nodeCommandResult) {
      completePendingNodeVoiceCommand(plan.nodeCommandResult);
    } else if (plan.standaloneTranscript) {
      setStatus(plan.standaloneTranscript.status);
      void renderGlass(standaloneVoiceTranscriptHudFrame(plan.standaloneTranscript.text));
    }
  }

  function handleVoiceGatewayMessage(event: MessageEvent) {
    const payload = parseVoiceGatewayMessageData(event.data);
    if (!payload) return;
    const route = voiceGatewayEventRoute(payload);
    switch (route.kind) {
      case "transcription-failed":
        handleVoiceTranscriptionFailed(payload);
        return;
      case "transcription-started":
        setStatus("voice: listening");
        return;
      case "voice-processing":
        handleVoiceProcessing(payload);
        return;
      case "voice-draft-ready":
        handleVoiceDraftReady(payload);
        return;
      case "voice-draft-failed":
        handleVoiceDraftFailed(payload);
        return;
      case "session-voice-sent":
        handleSessionVoiceSent(payload);
        return;
      case "transcript":
        handleVoiceTranscriptEvent(route.eventName, payload);
        return;
      case "unknown":
        return;
    }
  }

  function failPendingVoiceOpen(errorText: string, code = "VOICE_OPEN_FAILED") {
    const nodeCommandId = pendingNodeVoiceCommandIdRef.current;
    const pendingSessionVoice = pendingSessionVoiceRef.current;
    const plan = pendingVoiceOpenFailurePlan({
      error: errorText,
      code,
      nodeCommandId,
      pendingSessionVoice,
      fallbackMode: voiceModeRef.current,
      at: Date.now(),
    });
    clearPendingNodeVoiceCommand();
    clearPendingSessionVoice();
    if (plan.nodeCommandResult) {
      sendPlannedNodeCommandResult(plan.nodeCommandResult);
    }
    setStatus(voiceFailureStatus(errorText));
    if (plan.voiceFailure) {
      setLastVoiceFailure(plan.voiceFailure);
      clearReviewVoiceVerification();
    }
    if (plan.shouldRenderFailure) renderGlassVoiceFailure(errorText);
  }

  function closeVoiceTransportWithoutFinalize() {
    clearPendingNodeVoiceCommand();
    clearPendingSessionVoice();
    clearVoiceCaptureTimers();
    voiceTransportGenerationRef.current += 1;
    const voiceWs = voiceWsRef.current;
    voiceWsRef.current = null;
    if (voiceWs && shouldCloseVoiceTransportWithoutFinalize(voiceWs.readyState, WebSocket.CLOSING)) voiceWs.close();
    clearVoiceAudioSubscription();
    void bridgeRef.current?.audioControl(false).catch(() => undefined);
    stopVoiceMediaStream();
    setActiveListening(false);
  }

  function clearVoiceAudioSubscription() {
    const unsubscribeAudio = unsubscribeAudioRef.current;
    unsubscribeAudioRef.current = null;
    if (unsubscribeAudio) unsubscribeAudio();
  }

  function stopVoiceMediaStream() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  function cancelVoiceInput() {
    const hadPendingSessionVoice = Boolean(pendingSessionVoiceRef.current);
    emitE2eVoiceState({
      action: "cancel-voice",
      hadPendingSessionVoice,
      mode: pendingSessionVoiceRef.current?.mode || voiceModeRef.current,
    });
    setActiveVoiceDraft(null);
    setActiveVoiceDraftPendingPhase("preprocess");
    resetVoiceTranscript();
    closeVoiceTransportWithoutFinalize();
    setLastVoiceFailure(null);
    setStatus("voice canceled");
    renderGlassSessionHome(hadPendingSessionVoice ? "voice canceled" : "ready", { force: true });
  }

  function handleVoiceTransportClosed() {
    voiceWsRef.current = null;
    clearVoiceAudioSubscription();
    void bridgeRef.current?.audioControl(false).catch(() => undefined);
    clearVoiceCaptureTimers();
    setActiveListening(false);
    stopVoiceMediaStream();
    const nodeCommandId = pendingNodeVoiceCommandIdRef.current;
    const pendingSessionVoice = pendingSessionVoiceRef.current;
    const plan = voiceTransportClosedPlan({
      nodeCommandId,
      transcriptText: voiceTextRef.current,
      pendingSessionVoice,
    });
    if (plan.nodeCommandResult) {
      completePendingNodeVoiceCommand(plan.nodeCommandResult);
    }
    if (plan.sessionFailure) {
      clearPendingSessionVoice();
      setStatus(voiceFailureStatus(plan.sessionFailure.errorText));
      renderGlassVoiceFailure(plan.sessionFailure.errorText);
    }
  }

  async function handleVoiceTransportOpened(
    voiceWs: VoiceTransport,
    config: Record<string, unknown>,
    onOpen: (voiceWs: VoiceTransport) => Promise<boolean> | boolean,
  ) {
    try {
      sendGatewayOutboxRequest(voiceWs, gatewayUtteranceStartRequest(config, createRequestId()));
      return await onOpen(voiceWs);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err);
      failPendingVoiceOpen(errorText);
      closeVoiceTransportWithoutFinalize();
      return false;
    }
  }

  function handleVoiceTransportError() {
    setStatus("voice connection error");
    stopVoice();
  }

  async function openVoiceWebSocket(
    config: Record<string, unknown>,
    onOpen: (voiceWs: VoiceTransport) => Promise<boolean> | boolean,
  ) {
    if (!(wsRef.current instanceof GatewayDirectTransport)) {
      throw new Error("OpenClaw Gateway is not connected");
    }
    const voiceWs: VoiceTransport = wsRef.current.createVoiceTransport(config);
    const voiceGeneration = nextVoiceTransportGeneration(voiceTransportGenerationRef.current);
    voiceTransportGenerationRef.current = voiceGeneration;
    const isCurrentVoiceTransport = () => isCurrentVoiceTransportGeneration(voiceTransportGenerationRef.current, voiceGeneration);
    let settleOpen: (opened: boolean) => void = () => {};
    let openSettled = false;
    const openHandled = new Promise<boolean>((resolve) => {
      settleOpen = (opened) => {
        if (openSettled) return;
        openSettled = true;
        resolve(opened);
      };
    });
    voiceWsRef.current = voiceWs;
    attachGuardedVoiceTransportListeners(voiceWs, {
      isCurrent: isCurrentVoiceTransport,
      onOpen: async () => settleOpen(await handleVoiceTransportOpened(voiceWs, config, onOpen)),
      onMessage: (event) => handleVoiceGatewayMessage(event),
      onClose: () => {
        settleOpen(false);
        handleVoiceTransportClosed();
      },
      onError: () => {
        settleOpen(false);
        handleVoiceTransportError();
      },
    });
    if (!voiceWs.open) return true;
    await voiceWs.open();
    if (!isCurrentVoiceTransport()) settleOpen(false);
    return await openHandled;
  }

  async function startBridgeVoice(bridge: EvenAppBridge) {
    const voiceConfig = bridgeVoiceStartConfig({
      pendingSessionVoice: pendingSessionVoiceRef.current,
      transcriptionOnly: Boolean(pendingNodeVoiceCommandIdRef.current),
      activeSessionKey: sessionKeyRef.current,
      createIdempotencyKey: createRequestId,
    });
    return await openVoiceWebSocket(
      voiceConfig,
      async (voiceWs) => {
        const unsubscribeAudio = bridge.onEvenHubEvent((event: EvenHubEvent) => {
          const audioPcm = event.audioEvent?.audioPcm;
          if (!audioPcm || !canSendVoiceAudio({
            byteLength: audioPcm?.byteLength,
            readyState: voiceWs.readyState,
            openState: WebSocket.OPEN,
          })) return;
          voiceWs.send(arrayBufferBackedBytes(audioPcm));
        });
        unsubscribeAudioRef.current = unsubscribeAudio;
        const opened = await bridge.audioControl(true);
        if (!opened) throw new Error("G2 microphone did not open");
        if (voiceWsRef.current !== voiceWs || !isGatewayTransportOpen(voiceWs.readyState, WebSocket.OPEN)) {
          if (unsubscribeAudioRef.current === unsubscribeAudio) unsubscribeAudioRef.current = null;
          unsubscribeAudio();
          if (voiceWsRef.current === voiceWs) voiceWsRef.current = null;
          if (!voiceWsRef.current) void bridge.audioControl(false).catch(() => undefined);
          return false;
        }
        setActiveVoiceListening();
        startVoiceRecordingPulse();
        renderListeningVoicePanel();
        return true;
      },
    );
  }

  function stopVoice() {
    clearVoiceAudioSubscription();
    clearPendingNodeVoiceStopTimer();
    clearVoiceCaptureTimers();
    void bridgeRef.current?.audioControl(false).catch(() => undefined);
    const voiceWs = voiceWsRef.current;
    voiceWsRef.current = null;
    const closeAction = voiceWs
      ? voiceTransportCloseAction(voiceWs.readyState, { open: WebSocket.OPEN, closing: WebSocket.CLOSING })
      : "none";
    if (voiceWs && closeAction === "finalize") {
      emitE2eVoiceState({
        action: "finalize-voice",
        mode: pendingSessionVoiceRef.current?.mode || voiceModeRef.current,
        sessionKey: pendingSessionVoiceRef.current?.targetSessionKey || sessionKeyRef.current,
      });
      sendGatewayOutboxRequest(voiceWs, gatewayUtteranceFinalizeRequest());
      voiceFinalizeCloseTimerRef.current = window.setTimeout(() => {
        voiceFinalizeCloseTimerRef.current = null;
        if (shouldCloseVoiceTransportWithoutFinalize(voiceWs.readyState, WebSocket.CLOSING)) voiceWs.close();
      }, VOICE_FINALIZE_CLOSE_TIMEOUT_MS);
    } else if (voiceWs && closeAction === "close") {
      voiceWs.close();
    }
    stopVoiceMediaStream();
    setActiveListening(false);
    if (glassViewRef.current === "listening") {
      const pending = pendingSessionVoiceRef.current;
      const viewState = voiceStopListeningViewState(pending);
      if (viewState.draftPendingPhase) {
        setActiveVoiceDraftPendingPhase(viewState.draftPendingPhase);
        renderGlassVoiceDraftPending(viewState.draftPendingPhase);
      }
      else renderGlassSessionHome(viewState.sessionHomeStatus);
    }
  }

  async function startVoice(options: { nodeCommandId?: string; autoStopMs?: number; sessionVoice?: PendingSessionVoice } = {}) {
    const action = voiceStartAction({
      listening: listeningRef.current,
      hasVoiceTransport: Boolean(voiceWsRef.current),
      hasPendingNodeCommand: Boolean(pendingNodeVoiceCommandIdRef.current),
      hasPendingSessionVoice: Boolean(pendingSessionVoiceRef.current),
    });
    if (action === "stop-listening") {
      stopVoice();
      return;
    }
    if (action === "busy") {
      setStatus("voice: busy");
      return;
    }
    try {
      setStatus("voice: opening microphone");
      resetVoiceTranscript();
      setPendingVoiceStart(options);
      emitE2eVoiceState({
        action: "start-voice",
        mode: options.sessionVoice?.mode || voiceModeRef.current,
        sessionKey: options.sessionVoice?.targetSessionKey || sessionKeyRef.current,
        hasNodeCommand: Boolean(options.nodeCommandId),
      });
      const bridge = bridgeRef.current;
      if (bridge) {
        const started = await startBridgeVoice(bridge);
        if (!started) return;
      }
      else throw new Error("Voice input requires a live Even G2 bridge. Browser microphone fallback is disabled for Gateway direct voice.");
      scheduleVoiceStartTimers(options);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err);
      failPendingVoiceOpen(errorText);
      closeVoiceTransportWithoutFinalize();
    }
  }

  const connectionState = connectionStateLabel(connected);
  const approvalTitle = pendingApproval?.command || pendingApproval?.ask || pendingApproval?.id || "OpenClaw request";
  const activeSessionLabel = labelForSession(sessions.find((session) => session.key === sessionKey) || fallbackSession(sessionKey));
  const sessionSelectOptions = sessionSelectOptionsForState(sessions, sessionKey);
  const hasGatewaySetup = hasGatewaySetupUrl(gatewayUrl);
  const nodeConnected = nodeSnapshot?.nodeConnected === true;
  const g2BridgeLive = hasForegroundBridge();
  const foregroundClientCount = g2BridgeLive ? Math.max(1, nodeSnapshot?.foreground?.clientCount ?? 1) : 0;
  const nodeStatusLabel = phoneNodeStatusLabel({
    connected,
    nodeConnected,
    foregroundClientCount,
    lastError: nodeSnapshot?.openclaw?.lastError,
  });
  const nodeDetail = nodeDetailText({
    lastError: nodeSnapshot?.openclaw?.lastError,
    hasGatewaySetup,
    activeSessionLabel,
  });
  const displayedNodeApprovalStatus = nodeApprovalStatus || nodeApprovalRequiredFromSnapshot(nodeSnapshot);
  const statusGuidance = guidanceForConnectionState(status, Boolean(gatewayUrl.trim()));
  const connectionGuidance = displayedNodeApprovalStatus
    ? nodeApprovalGuidance()
    : statusGuidance;
  const storedGatewayLabel = hasGatewaySetup ? shortText(storageSafeGatewayUrl(gatewayUrl), 120) : "";
  const appOrigin = currentAppOrigin();
  const originNotAllowed = /origin not allowed|allowedorigins/i.test(status);
  const retryStatusLabel = phoneRetryStatusLabel(retryDueAtMs, retryClockMs);
  const connectionIssue = phoneConnectionIssueKind({
    connected,
    hasGatewaySetup,
    status,
  });
  const showRetryNow = hasGatewaySetup && !connected;
  const showOperatorApprovalCheck = hasGatewaySetup &&
    connected &&
    !displayedNodeApprovalStatus &&
    connectionGuidance?.title === "Operator approval required";
  const showCheckAgain = hasGatewaySetup && connected && (
    Boolean(displayedNodeApprovalStatus) ||
    showOperatorApprovalCheck
  );
  const voiceGatewayGuidance = voiceModeGatewayGuidance(voiceMode);
  const showSetupFlow = !hasGatewaySetup;
  const showCanvasTutorial = shouldShowCanvasTutorial({
    pending: canvasTutorialPending,
    completed: canvasTutorialCompleted,
    showSetupFlow,
  });
  const displayedTalkReviewStatus = applyReviewVoiceFailure(talkReviewStatus, lastVoiceFailure);
  const showVoiceSetupAction = hasGatewaySetup &&
    connected &&
    voiceMode === "review" &&
    !showCheckAgain &&
    (displayedTalkReviewStatus.state === "needs-setup" || displayedTalkReviewStatus.state === "unavailable");
  const liveStateLabel = phoneLiveStateLabel({
    hasGatewaySetup,
    connected,
    nodeApprovalPending: Boolean(displayedNodeApprovalStatus),
    nodeConnected,
  });
  const liveActionLabel = phoneLiveActionLabel({ showSetupFlow, showCheckAgain, showRetryNow, showVoiceSetup: showVoiceSetupAction });
  const showEventDiagnostics = evenHubEventUiDiagnosticsEnabled() || Boolean(sessionTranscriptError);
  const voiceEnabled = voiceMode !== "off";
  const reviewSelected = voiceMode === "review";
  const reviewVoiceVerifiedForCurrentProvider = Boolean(
    reviewVoiceVerifiedAtMs &&
    displayedTalkReviewStatus.state === "ready" &&
    talkReviewProviderId(displayedTalkReviewStatus) &&
    reviewVoiceVerifiedProviderId === talkReviewProviderId(displayedTalkReviewStatus),
  );
  const readinessItems = phoneReadinessChecklist({
    connected,
    connectionGuidanceTitle: connectionGuidance?.title,
    connectionIssue,
    foregroundClientCount,
    gatewayUrl,
    hasGatewaySetup,
    nodeApprovalPending: Boolean(displayedNodeApprovalStatus),
    nodeConnected,
    reviewStatusState: displayedTalkReviewStatus.state,
    reviewVoiceVerified: reviewVoiceVerifiedForCurrentProvider,
    sessionKey,
    showCanvasTutorial,
    voiceMode,
  });
  const showGatewaySetupRequest = Boolean(voiceGatewayGuidance.request) && voiceMode !== "off";
  const voiceFailureTitleText = lastVoiceFailure ? voiceRecoveryTitle(lastVoiceFailure.error, lastVoiceFailure.mode) : "";
  const voiceFailureActionText = lastVoiceFailure ? voiceRecoveryAction(lastVoiceFailure.error, lastVoiceFailure.mode) : "";
  const voiceFailureErrorText = lastVoiceFailure ? phoneVoiceFailureErrorText(lastVoiceFailure.error) : "";
  const reviewProviderOptions = displayedTalkReviewStatus.providers;
  const selectedReviewProviderMissing = phoneSelectedReviewProviderMissing(preferredReviewProvider, reviewProviderOptions);
  const canvasTextLabel = canvasText ? shortText(canvasText, 120) : "";
  const voiceModeLabelText = voiceModeLabel(voiceMode);
  const diagnosticsDeviceId = nodeSnapshot?.deviceId || "";
  const diagnosticsNodeId = nodeSnapshot?.nodeId || lastSeenNodeId;
  const diagnosticsNodeApprovalState = displayedNodeApprovalStatus?.approvalState || nodeSnapshot?.approvalState || "";

  function handleNodeLiveAction() {
    if (showSetupFlow) {
      void scanSetupQr();
      return;
    }
    if (showRetryNow) {
      retryNow();
      return;
    }
    if (showCheckAgain) {
      if (showOperatorApprovalCheck) {
        if (retryOperatorApprovalNow("checking operator approval")) return;
        checkGatewayStatus();
        return;
      }
      checkGatewayStatus();
      return;
    }
    if (showVoiceSetupAction) {
      openVoiceSetupPanel();
      return;
    }
    retryNow();
  }

  useEffect(() => {
    if (!simulatorSessionSelectorFlowEnabled() || simulatorSessionSelectorFlowRanRef.current) return;
    if (!connected || sessionSelectOptions.length < 2) return;
    const targetSession = sessionSelectOptions.find((session) => session.key !== sessionKey);
    if (!targetSession) return;
    simulatorSessionSelectorFlowRanRef.current = true;
    window.setTimeout(() => {
      const select = document.querySelector('[aria-label="Selected OpenClaw session"]') as HTMLSelectElement | null;
      if (!select) {
        emitE2eSessionState({ action: "selector-flow-missing" });
        return;
      }
      emitE2eSessionState({
        action: "selector-flow-start",
        fromSessionKey: sessionKeyRef.current,
        toSessionKey: targetSession.key,
      });
      select.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
      select.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, targetSession.key);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      emitE2eSessionState({
        action: "selector-flow-change-dispatched",
        toSessionKey: targetSession.key,
      });
    }, 500);
  }, [connected, sessionKey, sessionSelectOptions]);

  return (
    <main className={styles.appShell}>
      <section className={styles.panel}>
        <div className={styles["title-row"]}>
          <div>
            <div className={styles["app-eyebrow"]}>Glasses node</div>
            <h1 className={styles.title}>OpenClaw Node</h1>
          </div>
        </div>

        <NodeLiveStatusPanel
          appOrigin={appOrigin}
          connectionGuidance={connectionGuidance}
          liveActionLabel={liveActionLabel}
          liveStateLabel={liveStateLabel}
          originNotAllowed={originNotAllowed}
          readinessItems={readinessItems}
          setupScanStatus={setupScanStatus}
          voiceFailureActionText={voiceFailureActionText}
          voiceFailureErrorText={shortText(voiceFailureErrorText, 220)}
          voiceFailureTitleText={lastVoiceFailure ? voiceFailureTitleText : ""}
          onLiveAction={handleNodeLiveAction}
        />

        {setupScannerOpen ? (
          <SetupQrScanner
            onCancel={() => {
              setSetupScannerOpen(false);
              setSetupScanStatus("Setup QR scan cancelled.");
              void renderConnectionGuidance(statusRef.current);
            }}
            onNativeCapture={bridgeRef.current ? scanSetupQrWithNativeCamera : undefined}
            onSetupCode={acceptSetupCode}
          />
        ) : null}

        {showSetupFlow ? (
          <ManualSetupPanel
            setupCodeDraft={setupCodeDraft}
            onSetupCodeDraftChange={(value) => {
              userEditedSettingsRef.current = true;
              setSetupCodeDraft(value);
            }}
            onSubmit={submitSetupCodeFallback}
          />
        ) : null}

        {!showSetupFlow ? (
          <SessionContextPanel
            connected={connected}
            sessionKey={sessionKey}
            sessionSelectOptions={sessionSelectOptions}
            onRefreshSessions={refreshSessions}
            onSwitchSession={switchSession}
          />
        ) : null}

        {pendingApproval ? (
          <ApprovalPanel
            approvalTitle={approvalTitle}
            cwd={pendingApproval.cwd}
            onResolve={resolveApproval}
          />
        ) : null}

        {!showSetupFlow ? (
          <details
            className={styles.advanced}
            open={voicePanelOpen}
            onToggle={(event) => setVoicePanelOpen((event.currentTarget as HTMLDetailsElement).open)}
          >
            <summary>Voice input</summary>
            <section className={styles["voice-settings"]} aria-label="Voice input settings">
              <VoiceModeControls
                reviewSelected={reviewSelected}
                voiceEnabled={voiceEnabled}
                voiceMode={voiceMode}
                onVoiceModeChange={setActiveVoiceMode}
              />

              {voiceEnabled ? (
                <VoiceRecordingLimitSelect
                  voiceRecordingLimitSeconds={voiceRecordingLimitSeconds}
                  onVoiceRecordingLimitChange={setActiveVoiceRecordingLimitSeconds}
                />
              ) : null}

              {voiceEnabled && reviewSelected ? (
                <ReviewProviderSelect
                  preferredReviewProvider={preferredReviewProvider}
                  providers={reviewProviderOptions}
                  selectedReviewProviderMissing={selectedReviewProviderMissing}
                  onPreferredReviewProviderChange={(providerId) => {
                    setActivePreferredReviewProvider(providerId);
                    setLastVoiceFailure(null);
                  }}
                />
              ) : null}

              {voiceEnabled && reviewSelected ? (
                <ReviewAvailabilityPanel
                  connected={connected}
                  preferredReviewProvider={preferredReviewProvider}
                  reviewVoiceVerifiedAtMs={reviewVoiceVerifiedAtMs}
                  reviewVoiceVerifiedProviderId={reviewVoiceVerifiedProviderId}
                  selectedReviewProviderMissing={selectedReviewProviderMissing}
                  status={displayedTalkReviewStatus}
                  onCheckAgain={() => {
                    setLastVoiceFailure(null);
                    void refreshTalkReviewStatus();
                  }}
                />
              ) : null}

              <VoiceGatewaySetupGuidance
                copyStatus={gatewayRequestCopyStatus}
                failureAction={lastVoiceFailure ? voiceFailureActionText : ""}
                failureTitle={lastVoiceFailure ? voiceFailureTitleText : ""}
                request={voiceGatewayGuidance.request}
                showRequest={showGatewaySetupRequest}
                onCopyRequest={(request) => void copyGatewaySetupRequest(request)}
              />
            </section>
          </details>
        ) : null}

        {!showSetupFlow ? (
          <ConnectionSettingsPanel
            defaultOpen={devInitialPanel === "connection"}
            connectionState={connectionState}
            retryStatusLabel={retryStatusLabel}
            status={status}
            storedGatewayLabel={storedGatewayLabel}
            onSetUpAgain={() => void setUpAgain()}
          />
        ) : null}

        <DiagnosticsPanel
          defaultOpen={devInitialPanel === "diagnostics"}
          activeSessionLabel={activeSessionLabel}
          appOrigin={appOrigin}
          appVersion={APP_VERSION}
          canvasTextLabel={canvasTextLabel}
          connectionState={connectionState}
          deviceId={diagnosticsDeviceId}
          evenHubEvents={evenHubEvents}
          glassView={glassView}
          hasGatewaySetup={hasGatewaySetup}
          nodeApprovalState={diagnosticsNodeApprovalState}
          nodeDetail={nodeDetail}
          nodeId={diagnosticsNodeId}
          nodeStatusLabel={nodeStatusLabel}
          sessionKey={sessionKey}
          sessionTranscriptError={sessionTranscriptError}
          showEventDiagnostics={showEventDiagnostics}
          voiceModeLabelText={voiceModeLabelText}
        />
      </section>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  const rootGlobal = globalThis as RootGlobal;
  rootGlobal.__openClawEvenG2Root ??= createRoot(rootElement);
  rootGlobal.__openClawEvenG2Root.render(<App />);
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      rootGlobal.__openClawEvenG2Root?.unmount();
      rootGlobal.__openClawEvenG2Root = undefined;
    });
  }
}
