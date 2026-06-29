import type { TalkCatalogReviewStatus } from "./talk-catalog";
import {
  VOICE_RECORDING_LIMIT_OPTIONS_SECONDS,
  voiceRecordingLimitLabel,
} from "./voice-settings";
import type { VoiceMode } from "./voice-settings";
import styles from "./App.module.css";

export const GATEWAY_SETUP_DOC_URL = "https://github.com/solavrc/openclaw-even-g2-node/blob/main/docs/gateway-voice-setup.md";
export const VOICE_MODE_OPTIONS: Array<{ mode: Exclude<VoiceMode, "off">; label: string; detail: string }> = [
  { mode: "review", label: "Review", detail: "Show transcript first" },
  { mode: "direct", label: "Send now", detail: "Fastest path" },
];

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function reviewAvailabilityClass(state: TalkCatalogReviewStatus["state"]) {
  if (state === "ready") return styles["review-availability-ready"];
  if (state === "checking") return styles["review-availability-checking"];
  if (state === "needs-setup") return styles["review-availability-needs-setup"];
  if (state === "unavailable") return styles["review-availability-unavailable"];
  return styles["review-availability-unknown"];
}

export function VoiceModeControls({
  reviewSelected,
  voiceEnabled,
  voiceMode,
  onVoiceModeChange,
}: {
  reviewSelected: boolean;
  voiceEnabled: boolean;
  voiceMode: VoiceMode;
  onVoiceModeChange: (mode: VoiceMode) => void;
}) {
  return (
    <>
      <label className={styles["toggle-row"]}>
        <span>
          <strong>Voice input</strong>
          <small>Tap on the glasses starts recording.</small>
        </span>
        <input
          type="checkbox"
          checked={voiceEnabled}
          onChange={(event) => onVoiceModeChange(event.currentTarget.checked ? "review" : "off")}
        />
      </label>

      <div className={styles.field}>
        <span>When recording stops</span>
        <div className={styles["voice-mode-grid"]} role="radiogroup" aria-label="Voice mode">
          {VOICE_MODE_OPTIONS.map((option) => {
            const selected = option.mode === "review" ? reviewSelected : voiceMode === option.mode;
            return (
              <button
                key={option.mode}
                type="button"
                className={cx(styles["voice-mode-option"], selected && styles["voice-mode-option-active"])}
                aria-pressed={selected}
                disabled={!voiceEnabled}
                onClick={() => onVoiceModeChange(option.mode)}
              >
                <span>{option.label}</span>
                <small>{option.detail}</small>
              </button>
            );
          })}
        </div>
        <span className={styles["field-help"]}>
          Review streams OpenClaw Talk transcription while recording. Send now attaches the captured WAV directly to the selected session.
        </span>
      </div>
    </>
  );
}

export function VoiceRecordingLimitSelect({
  voiceRecordingLimitSeconds,
  onVoiceRecordingLimitChange,
}: {
  voiceRecordingLimitSeconds: number;
  onVoiceRecordingLimitChange: (value: string) => void;
}) {
  return (
    <div className={styles.field}>
      <span>Recording limit</span>
      <select
        className={styles["provider-select"]}
        aria-label="Voice recording limit"
        value={voiceRecordingLimitSeconds}
        onChange={(event) => onVoiceRecordingLimitChange(event.currentTarget.value)}
      >
        {VOICE_RECORDING_LIMIT_OPTIONS_SECONDS.map((seconds) => (
          <option key={seconds} value={seconds}>{voiceRecordingLimitLabel(seconds)}</option>
        ))}
      </select>
      <span className={styles["field-help"]}>
        Safety stop for normal glasses voice input. Default is 1 minute.
      </span>
    </div>
  );
}

export function ReviewProviderSelect({
  preferredReviewProvider,
  providers,
  selectedReviewProviderMissing,
  onPreferredReviewProviderChange,
}: {
  preferredReviewProvider: string;
  providers: TalkCatalogReviewStatus["providers"];
  selectedReviewProviderMissing: boolean;
  onPreferredReviewProviderChange: (providerId: string) => void;
}) {
  return (
    <div className={styles.field}>
      <span>Review provider</span>
      <select
        className={styles["provider-select"]}
        aria-label="Review provider preference"
        value={preferredReviewProvider}
        onChange={(event) => onPreferredReviewProviderChange(event.currentTarget.value)}
      >
        <option value="">Gateway default</option>
        {selectedReviewProviderMissing ? (
          <option value={preferredReviewProvider}>{preferredReviewProvider} (not available)</option>
        ) : null}
        {providers.map((provider) => (
          <option key={provider.id} value={provider.id}>{provider.label}</option>
        ))}
      </select>
      <span className={styles["field-help"]}>
        Optional override. Choices come from OpenClaw <code>talk.catalog</code>; provider credentials and models stay in Gateway.
      </span>
    </div>
  );
}

export function ReviewAvailabilityPanel({
  connected,
  preferredReviewProvider,
  selectedReviewProviderMissing,
  status,
  onCheckAgain,
}: {
  connected: boolean;
  preferredReviewProvider: string;
  selectedReviewProviderMissing: boolean;
  status: TalkCatalogReviewStatus;
  onCheckAgain: () => void;
}) {
  return (
    <div
      className={cx(styles["review-availability"], reviewAvailabilityClass(status.state))}
      aria-label="Review availability"
    >
      <div>
        <div className={styles["section-label"]}>Review status</div>
        <strong>{status.label}</strong>
        <p>{status.detail}</p>
        {selectedReviewProviderMissing ? (
          <p>
            Saved provider <code>{preferredReviewProvider}</code> is not in the current Gateway list.
            Choose Gateway default or send the setup request to OpenClaw.
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className={styles["secondary-action"]}
        disabled={!connected}
        onClick={onCheckAgain}
      >
        Check again
      </button>
    </div>
  );
}

export function VoiceGatewaySetupGuidance({
  copyStatus,
  failureAction,
  failureTitle,
  request,
  showRequest,
  onCopyRequest,
}: {
  copyStatus: string;
  failureAction: string;
  failureTitle: string;
  request?: string;
  showRequest: boolean;
  onCopyRequest: (request: string) => void;
}) {
  return (
    <div className={styles["gateway-hint"]} aria-label="Voice Gateway setup guidance">
      <p>Send this message to your usual OpenClaw chat if voice setup needs attention.</p>
      {failureTitle ? (
        <div className={styles["recovery-note"]} aria-label="Voice setup recovery">
          <strong>{failureTitle}</strong>
          <span>{failureAction}</span>
        </div>
      ) : null}
      {request && showRequest ? (
        <div className={styles["setup-request"]}>
          <div className={styles["setup-request-header"]}>
            <div className={styles["section-label"]}>Message to OpenClaw</div>
            <button
              type="button"
              className={styles["secondary-action"]}
              onClick={() => onCopyRequest(request)}
            >
              Copy request
            </button>
          </div>
          <p>{request}</p>
          {copyStatus ? <div className={styles["field-help"]}>{copyStatus}</div> : null}
        </div>
      ) : null}
      <a className={styles["reference-link"]} href={GATEWAY_SETUP_DOC_URL} target="_blank" rel="noreferrer">
        Gateway voice setup guide
      </a>
    </div>
  );
}
