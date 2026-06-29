import styles from "./App.module.css";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function connectionGuidanceActionParts(action: string) {
  const lines = action.split("\n").map((line) => line.trim()).filter(Boolean);
  const askIndex = lines.findIndex((line) => /^Or ask OpenClaw:?$/i.test(line));
  const ask = askIndex >= 0 ? lines[askIndex + 1]?.replace(/^"|"$/g, "") || "" : "";
  const beforeAsk = askIndex >= 0 ? lines.slice(0, askIndex) : lines;
  const afterAsk = askIndex >= 0 ? lines.slice(askIndex + 2) : [];
  const hostLines = [...beforeAsk, ...afterAsk]
    .filter((line) => !/^Run on OpenClaw host:?$/i.test(line));
  return {
    ask,
    host: hostLines.join("\n").replace(/`/g, ""),
  };
}

function guidanceActionLines(action: string) {
  return action
    .split("\n")
    .map((line) => line.trim().replace(/`/g, ""))
    .filter(Boolean);
}

export function ConnectionGuidanceAction({ action }: { action: string }) {
  const parts = connectionGuidanceActionParts(action);
  if (!parts.ask) {
    const [primary = action.replace(/`/g, ""), ...details] = guidanceActionLines(action);
    return (
      <div className={styles["guidance-action"]}>
        <div className={cx(styles["guidance-primary"], styles["guidance-primary-neutral"])}>
          <span>Next action</span>
          <strong>{primary}</strong>
        </div>
        {details.length ? (
          <div className={styles["guidance-secondary"]}>
            <span>Details</span>
            <code>{details.join("\n")}</code>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className={styles["guidance-action"]}>
      <div className={styles["guidance-primary"]}>
        <span>Ask OpenClaw with</span>
        <strong>"{parts.ask}"</strong>
      </div>
      {parts.host ? (
        <div className={styles["guidance-secondary"]}>
          <span>Or run on OpenClaw host</span>
          <code>{parts.host}</code>
        </div>
      ) : null}
    </div>
  );
}
