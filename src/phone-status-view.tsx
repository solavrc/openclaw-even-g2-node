import type { ConnectionGuidance } from "./connection-guidance";
import { ConnectionGuidanceAction } from "./connection-guidance-view";
import type { EvenHubEventLog } from "./even-hub-diagnostics";
import styles from "./App.module.css";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export type DiagnosticRowInput = {
  activeSessionLabel: string;
  appOrigin: string;
  appVersion: string;
  canvasTextLabel: string;
  connectionState: string;
  deviceId: string;
  glassView: string;
  hasGatewaySetup: boolean;
  nodeApprovalState: string;
  nodeDetail: string;
  nodeId: string;
  nodePendingRequestId: string;
  nodeStatusLabel: string;
  sessionKey: string;
  voiceModeLabelText: string;
};

export function diagnosticRows(input: DiagnosticRowInput) {
  return [
    { label: "Gateway", value: input.connectionState },
    { label: "Node", value: input.nodeStatusLabel },
    { label: "App origin", value: input.appOrigin || "Unavailable" },
    { label: "Version", value: input.appVersion },
    ...(input.hasGatewaySetup ? [
      ...(input.deviceId ? [{ label: "Device ID", value: input.deviceId }] : []),
      ...(input.nodeId ? [{ label: "Node ID", value: input.nodeId }] : []),
      ...(input.nodeApprovalState ? [{ label: "Node approval", value: input.nodeApprovalState }] : []),
      ...(input.nodePendingRequestId ? [{ label: "Node request", value: input.nodePendingRequestId }] : []),
      { label: "Session", value: input.activeSessionLabel },
      { label: "Session key", value: input.sessionKey || "Resolving" },
      { label: "View", value: input.glassView },
      { label: "Voice", value: input.voiceModeLabelText },
    ] : []),
    ...(input.canvasTextLabel ? [{ label: "Canvas", value: input.canvasTextLabel }] : []),
    ...(input.nodeDetail ? [{ label: "Detail", value: input.nodeDetail }] : []),
  ];
}

function OriginRecoveryNote({ appOrigin }: { appOrigin: string }) {
  return (
    <div className={cx(styles["recovery-note"], styles["guidance-note"])} aria-label="Gateway origin recovery">
      <strong>Allow this App origin in OpenClaw.</strong>
      <div className={styles["guidance-action"]}>
        <div className={cx(styles["guidance-primary"], styles["guidance-primary-neutral"])}>
          <span>Next action</span>
          <strong>Add this App origin to OpenClaw.</strong>
        </div>
        <div className={styles["guidance-secondary"]}>
          <span>Details</span>
          <code>{`gateway.controlUi.allowedOrigins\n${appOrigin || "this app origin"}\nThen tap Retry now.`}</code>
        </div>
      </div>
    </div>
  );
}

function VoiceRecoveryNote({
  actionText,
  errorText,
  titleText,
}: {
  actionText: string;
  errorText: string;
  titleText: string;
}) {
  if (!titleText) return null;
  return (
    <div className={styles["recovery-note"]} aria-label="Voice recovery">
      <strong>{titleText}</strong>
      <span>{actionText}</span>
      <code>{errorText}</code>
    </div>
  );
}

function ConnectionGuidanceNote({ guidance }: { guidance: ConnectionGuidance }) {
  return (
    <div className={cx(styles["recovery-note"], styles["guidance-note"])} aria-label="Connection guidance">
      <strong>{guidance.title}</strong>
      <span>{guidance.body}</span>
      {guidance.action ? <ConnectionGuidanceAction action={guidance.action} /> : null}
    </div>
  );
}

export function NodeLiveStatusPanel({
  appOrigin,
  connectionGuidance,
  connectionState,
  liveActionLabel,
  liveFacts,
  liveStateLabel,
  originNotAllowed,
  setupScanStatus,
  status,
  voiceFailureActionText,
  voiceFailureErrorText,
  voiceFailureTitleText,
  voiceStatusLabel,
  onLiveAction,
}: {
  appOrigin: string;
  connectionGuidance: ConnectionGuidance | null;
  connectionState: string;
  liveActionLabel: string;
  liveFacts: string[];
  liveStateLabel: string;
  originNotAllowed: boolean;
  setupScanStatus: string;
  status: string;
  voiceFailureActionText: string;
  voiceFailureErrorText: string;
  voiceFailureTitleText: string;
  voiceStatusLabel: string;
  onLiveAction: () => void;
}) {
  return (
    <section className={styles["node-live"]} aria-label="Node live status">
      <div className={styles["node-live-main"]}>
        <div>
          <div className={styles["section-label"]}>Node</div>
          <div className={styles["live-title"]}>{liveStateLabel}</div>
        </div>
        {liveActionLabel ? (
          <button
            type="button"
            className={styles["primary-action"]}
            aria-label={liveActionLabel}
            onClick={onLiveAction}
          >
            {liveActionLabel}
          </button>
        ) : null}
      </div>
      <div className={styles["fact-row"]} aria-label="Node facts">
        {liveFacts.map((fact) => <span key={fact}>{fact}</span>)}
      </div>
      <div className={styles["node-status-line"]}>{connectionState} · {status} · {voiceStatusLabel}</div>
      {connectionGuidance ? <ConnectionGuidanceNote guidance={connectionGuidance} /> : null}
      {setupScanStatus ? <div className={styles["preview-status"]}>{setupScanStatus}</div> : null}
      {originNotAllowed ? <OriginRecoveryNote appOrigin={appOrigin} /> : null}
      <VoiceRecoveryNote
        actionText={voiceFailureActionText}
        errorText={voiceFailureErrorText}
        titleText={voiceFailureTitleText}
      />
    </section>
  );
}

export function ConnectionSettingsPanel({
  connectionState,
  defaultOpen,
  retryStatusLabel,
  status,
  storedGatewayLabel,
  onSetUpAgain,
}: {
  connectionState: string;
  defaultOpen?: boolean;
  retryStatusLabel: string;
  status: string;
  storedGatewayLabel: string;
  onSetUpAgain: () => void;
}) {
  return (
    <details className={styles.advanced} open={defaultOpen || undefined}>
      <summary>Connection</summary>
      <section className={styles["connection-settings"]} aria-label="Connection settings">
        <div className={styles["status-table"]}>
          <div><span>Gateway</span><strong>{storedGatewayLabel || "Not paired"}</strong></div>
          <div><span>Status</span><strong>{connectionState} · {status}</strong></div>
          {retryStatusLabel ? <div><span>Retry</span><strong>{retryStatusLabel}</strong></div> : null}
        </div>
        <div className={styles["setup-actions"]}>
          <button
            type="button"
            className={styles["secondary-action"]}
            aria-label="Set up again"
            onClick={onSetUpAgain}
          >
            Set up again
          </button>
        </div>
        <p className={styles["field-help"]}>Clears this phone's pairing before scanning a fresh setup QR.</p>
      </section>
    </details>
  );
}

function DiagnosticsStatusTable({
  rows,
}: {
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <div className={styles["status-table"]}>
      {rows.map((row) => (
        <div key={row.label}><span>{row.label}</span><strong>{row.value}</strong></div>
      ))}
    </div>
  );
}

function EventDiagnosticsSection({
  evenHubEvents,
  sessionTranscriptError,
}: {
  evenHubEvents: EvenHubEventLog[];
  sessionTranscriptError: string;
}) {
  return (
    <section className={styles["event-log"]} aria-label="Node event log">
      <div className={styles["section-label"]}>Node log</div>
      {sessionTranscriptError ? (
        <div className={styles["empty-state"]}>Session log: {sessionTranscriptError}</div>
      ) : null}
      {evenHubEvents.length ? (
        evenHubEvents.slice(0, 8).map((event) => (
          <div className={styles["event-log-line"]} key={event.id}>
            <span>{event.at}</span>
            <strong>{event.action}</strong>
            <code>{JSON.stringify(event.payload)}</code>
          </div>
        ))
      ) : (
        <div className={styles["empty-state"]}>Raw Even Hub events appear here when debug logging is enabled.</div>
      )}
    </section>
  );
}

export function DiagnosticsPanel({
  activeSessionLabel,
  appOrigin,
  appVersion,
  canvasTextLabel,
  connectionState,
  deviceId,
  defaultOpen,
  evenHubEvents,
  glassView,
  hasGatewaySetup,
  nodeApprovalState,
  nodeDetail,
  nodeId,
  nodePendingRequestId,
  nodeStatusLabel,
  sessionKey,
  sessionTranscriptError,
  showEventDiagnostics,
  voiceModeLabelText,
}: {
  activeSessionLabel: string;
  appOrigin: string;
  appVersion: string;
  canvasTextLabel: string;
  connectionState: string;
  deviceId: string;
  defaultOpen?: boolean;
  evenHubEvents: EvenHubEventLog[];
  glassView: string;
  hasGatewaySetup: boolean;
  nodeApprovalState: string;
  nodeDetail: string;
  nodeId: string;
  nodePendingRequestId: string;
  nodeStatusLabel: string;
  sessionKey: string;
  sessionTranscriptError: string;
  showEventDiagnostics: boolean;
  voiceModeLabelText: string;
}) {
  const rows = diagnosticRows({
    activeSessionLabel,
    appOrigin,
    appVersion,
    canvasTextLabel,
    connectionState,
    deviceId,
    glassView,
    hasGatewaySetup,
    nodeApprovalState,
    nodeDetail,
    nodeId,
    nodePendingRequestId,
    nodeStatusLabel,
    sessionKey,
    voiceModeLabelText,
  });

  return (
    <details className={cx(styles.advanced, styles.diagnostics)} open={defaultOpen || undefined}>
      <summary>Advanced diagnostics</summary>

      <section className={styles["diagnostic-zone"]} aria-label="Connection diagnostics">
        <div className={styles["section-copy"]}>
          Use when setup, Gateway connection, or glasses input needs troubleshooting.
        </div>
        <DiagnosticsStatusTable rows={rows} />
      </section>

      {showEventDiagnostics ? (
        <EventDiagnosticsSection
          evenHubEvents={evenHubEvents}
          sessionTranscriptError={sessionTranscriptError}
        />
      ) : null}
    </details>
  );
}
