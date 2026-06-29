import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ReviewAvailabilityPanel,
  ReviewProviderSelect,
  VOICE_MODE_OPTIONS,
  VoiceGatewaySetupGuidance,
  VoiceModeControls,
  VoiceRecordingLimitSelect,
} from "./voice-settings-view";
import type { TalkCatalogReviewStatus } from "./talk-catalog";

type ReactActGlobal = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

(globalThis as ReactActGlobal).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function setSelectValue(select: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value);
}

async function render(element: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
}

describe("ReviewAvailabilityPanel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders review status and disables refresh while disconnected", async () => {
    const status: TalkCatalogReviewStatus = {
      state: "checking",
      label: "Review waits for Gateway",
      detail: "Waiting for Gateway connection before reading Talk capabilities.",
      providers: [],
    };

    await render(
      <ReviewAvailabilityPanel
        connected={false}
        preferredReviewProvider=""
        selectedReviewProviderMissing={false}
        status={status}
        onCheckAgain={() => undefined}
      />,
    );

    const panel = document.querySelector('[aria-label="Review availability"]');
    expect(panel?.textContent).toContain("Review status");
    expect(panel?.textContent).toContain("Review waits for Gateway");
    expect((panel?.querySelector("button") as HTMLButtonElement | null)?.disabled).toBe(true);
  });

  it("explains a saved provider that is missing from the Gateway list", async () => {
    const status: TalkCatalogReviewStatus = {
      state: "needs-setup",
      label: "Review needs Gateway setup",
      detail: "Selected provider is not available.",
      providerId: "custom-stt",
      providers: [],
    };

    await render(
      <ReviewAvailabilityPanel
        connected
        preferredReviewProvider="custom-stt"
        selectedReviewProviderMissing
        status={status}
        onCheckAgain={() => undefined}
      />,
    );

    expect(document.body.textContent).toContain("Saved provider");
    expect(document.body.textContent).toContain("custom-stt");
    expect((document.querySelector("button") as HTMLButtonElement | null)?.disabled).toBe(false);
  });
});

describe("VoiceModeControls", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("switches voice mode from the toggle and mode buttons", async () => {
    const onVoiceModeChange = vi.fn();
    await render(
      <VoiceModeControls
        reviewSelected
        voiceEnabled
        voiceMode="review"
        onVoiceModeChange={onVoiceModeChange}
      />,
    );

    const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const sendNow = [...document.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Send now")) as HTMLButtonElement;

    await act(async () => {
      checkbox.click();
      sendNow.click();
    });

    expect(onVoiceModeChange).toHaveBeenCalledWith("off");
    expect(onVoiceModeChange).toHaveBeenCalledWith("direct");
  });

  it("keeps the two user-facing voice mode options stable", () => {
    expect(VOICE_MODE_OPTIONS).toEqual([
      { mode: "review", label: "Review", detail: "Show transcript first" },
      { mode: "direct", label: "Send now", detail: "Fastest path" },
    ]);
  });
});

describe("VoiceRecordingLimitSelect", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders known recording limits and emits the selected value", async () => {
    const onChange = vi.fn();
    await render(
      <VoiceRecordingLimitSelect
        voiceRecordingLimitSeconds={60}
        onVoiceRecordingLimitChange={onChange}
      />,
    );

    const select = document.querySelector("select") as HTMLSelectElement;
    expect(select.textContent).toContain("10 minutes");

    await act(async () => {
      setSelectValue(select, "120");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith("120");
  });
});

describe("ReviewProviderSelect", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders providers from talk.catalog and emits the selected provider", async () => {
    const onChange = vi.fn();
    await render(
      <ReviewProviderSelect
        preferredReviewProvider=""
        providers={[{ id: "openai", label: "OpenAI Realtime Transcription" }]}
        selectedReviewProviderMissing={false}
        onPreferredReviewProviderChange={onChange}
      />,
    );

    const select = document.querySelector("select") as HTMLSelectElement;
    expect(select.textContent).toContain("Gateway default");
    expect(select.textContent).toContain("OpenAI Realtime Transcription");

    await act(async () => {
      setSelectValue(select, "openai");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith("openai");
  });

  it("keeps a saved missing provider visible", async () => {
    await render(
      <ReviewProviderSelect
        preferredReviewProvider="custom-stt"
        providers={[]}
        selectedReviewProviderMissing
        onPreferredReviewProviderChange={() => undefined}
      />,
    );

    expect(document.body.textContent).toContain("custom-stt (not available)");
  });
});

describe("VoiceGatewaySetupGuidance", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders setup request and copies the exact request text", async () => {
    const onCopyRequest = vi.fn();
    await render(
      <VoiceGatewaySetupGuidance
        copyStatus="Copied."
        failureAction=""
        failureTitle=""
        request="Set up OpenClaw Even G2 Review voice."
        showRequest
        onCopyRequest={onCopyRequest}
      />,
    );

    const guidance = document.querySelector('[aria-label="Voice Gateway setup guidance"]');
    expect(guidance?.textContent).toContain("Message to OpenClaw");
    expect(guidance?.textContent).toContain("Set up OpenClaw Even G2 Review voice.");
    expect(guidance?.textContent).toContain("Copied.");
    expect(guidance?.querySelector("a")?.getAttribute("href")).toContain("docs/gateway-voice-setup.md");

    await act(async () => {
      (guidance?.querySelector("button") as HTMLButtonElement).click();
    });

    expect(onCopyRequest).toHaveBeenCalledWith("Set up OpenClaw Even G2 Review voice.");
  });

  it("can show recovery guidance without a setup request", async () => {
    await render(
      <VoiceGatewaySetupGuidance
        copyStatus=""
        failureAction="Check Gateway voice setup."
        failureTitle="Voice setup needed"
        request="Set up OpenClaw Even G2 Review voice."
        showRequest={false}
        onCopyRequest={() => undefined}
      />,
    );

    const guidance = document.querySelector('[aria-label="Voice Gateway setup guidance"]');
    expect(guidance?.textContent).toContain("Voice setup needed");
    expect(guidance?.textContent).toContain("Check Gateway voice setup.");
    expect(guidance?.textContent).not.toContain("Message to OpenClaw");
  });
});
