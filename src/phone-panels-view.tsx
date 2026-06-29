import type { OpenClawSession } from "./glass";
import type { ApprovalDecision } from "./gateway-outbox";
import styles from "./App.module.css";

export function ManualSetupPanel({
  setupCodeDraft,
  onSetupCodeDraftChange,
  onSubmit,
}: {
  setupCodeDraft: string;
  onSetupCodeDraftChange: (value: string) => void;
  onSubmit: (value?: string) => void;
}) {
  return (
    <section className={styles["setup-panel"]} aria-label="Gateway setup">
      <section className={styles["manual-setup"]} aria-label="Manual setup code fallback">
        <div>
          <div className={styles["section-label"]}>Manual fallback</div>
          <div className={styles["section-copy"]}>
            Use this only when QR scanning is unavailable.
            The normal setup path is the Scan setup QR button.
          </div>
        </div>
        <div className={styles.field}>
          <span>Manual setup code</span>
          <div className={styles["setup-code-row"]}>
            <input
              aria-label="Manual setup code"
              value={setupCodeDraft}
              onChange={(event) => onSetupCodeDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSubmit();
              }}
              onPaste={(event) => {
                const pasted = event.clipboardData.getData("text");
                if (pasted.trim()) window.setTimeout(() => onSubmit(pasted), 0);
              }}
              placeholder="Setup code"
            />
            <button
              className={styles["secondary-action"]}
              type="button"
              disabled={!setupCodeDraft.trim()}
              onClick={() => onSubmit()}
            >
              Connect
            </button>
          </div>
          <span className={styles["field-help"]}>Fallback when QR scanning is unavailable. Generate the code on the OpenClaw host with <code>openclaw qr</code>.</span>
        </div>
      </section>
    </section>
  );
}

export function SessionContextPanel({
  connected,
  sessionKey,
  sessionSelectOptions,
  onRefreshSessions,
  onSwitchSession,
}: {
  connected: boolean;
  sessionKey: string;
  sessionSelectOptions: OpenClawSession[];
  onRefreshSessions: () => void;
  onSwitchSession: (sessionKey: string) => void;
}) {
  return (
    <section className={styles["session-context"]} aria-label="Selected session">
      <div>
        <div className={styles["section-label"]}>Session</div>
        <div className={styles["session-shell"]}>
          <div className={styles["session-title"]}>{sessionKey || "Resolving session"}</div>
          <span className={styles["session-chevron"]} aria-hidden="true">›</span>
          <select
            aria-label="Selected OpenClaw session"
            className={styles["session-select"]}
            value={sessionKey}
            disabled={!connected || sessionSelectOptions.length === 0}
            onMouseDown={onRefreshSessions}
            onFocus={onRefreshSessions}
            onClick={onRefreshSessions}
            onChange={(event) => onSwitchSession(event.target.value)}
          >
            {sessionSelectOptions.length ? sessionSelectOptions.map((session) => (
              <option key={session.key} value={session.key}>{session.key}</option>
            )) : <option value="">Resolving session</option>}
          </select>
        </div>
      </div>
    </section>
  );
}

export function ApprovalPanel({
  approvalTitle,
  cwd,
  onResolve,
}: {
  approvalTitle: string;
  cwd?: string | null;
  onResolve: (decision: ApprovalDecision) => void;
}) {
  return (
    <div className={styles.approval}>
      <div className={styles["approval-title"]}>Approval required</div>
      <div className={styles["approval-command"]}>{approvalTitle}</div>
      {cwd ? <div className={styles["approval-meta"]}>{cwd}</div> : null}
      <div className={styles["approval-actions"]}>
        <button type="button" onClick={() => onResolve("allow-once")}>Approve</button>
        <button type="button" onClick={() => onResolve("deny")}>Reject</button>
      </div>
    </div>
  );
}
