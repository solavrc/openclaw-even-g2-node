import { describe, expect, it } from "vitest";
import {
  analyzeTalkCatalogForReview,
  applyReviewVoiceFailure,
  checkingTalkCatalogReviewStatus,
  gatewayWaitingTalkCatalogReviewStatus,
  unavailableTalkCatalogReviewStatus,
} from "./talk-catalog";

describe("analyzeTalkCatalogForReview", () => {
  it("marks review ready when the active provider supports gateway relay transcription", () => {
    expect(analyzeTalkCatalogForReview({
      transcription: {
        activeProvider: "openai",
        providers: [
          {
            id: "openai",
            label: "OpenAI Realtime Transcription",
            configured: true,
            modes: ["transcription"],
            transports: ["gateway-relay"],
            brains: ["none"],
          },
        ],
      },
    })).toMatchObject({
      state: "ready",
      label: "Review provider listed",
      providerId: "openai",
    });
  });

  it("does not silently fall back when the active provider is stale", () => {
    expect(analyzeTalkCatalogForReview({
      transcription: {
        activeProvider: "xai",
        providers: [
          {
            id: "openai",
            label: "OpenAI Realtime Transcription",
            configured: true,
            modes: ["transcription"],
            transports: ["gateway-relay"],
            brains: ["none"],
          },
        ],
      },
    })).toMatchObject({
      state: "needs-setup",
      label: "Review needs Gateway setup",
      providerId: "xai",
      providers: [
        { id: "openai", label: "OpenAI Realtime Transcription" },
      ],
    });
  });

  it("does not silently fall back when the active provider id is missing", () => {
    expect(analyzeTalkCatalogForReview({
      transcription: {
        activeProvider: "missing-provider",
        providers: [
          {
            id: "openai",
            label: "OpenAI Realtime Transcription",
            configured: true,
            modes: ["transcription"],
            transports: ["gateway-relay"],
            brains: ["none"],
          },
          {
            id: "custom-stt",
            label: "Custom Realtime Transcription",
            configured: true,
            modes: ["transcription"],
            transports: ["gateway-relay"],
            brains: ["none"],
          },
        ],
      },
    })).toMatchObject({
      state: "needs-setup",
      label: "Review needs Gateway setup",
      providerId: "missing-provider",
    });
  });

  it("uses the first valid catalog provider when no active provider is reported", () => {
    expect(analyzeTalkCatalogForReview({
      transcription: {
        providers: [
          {
            id: "openai",
            label: "OpenAI Realtime Transcription",
            configured: true,
            modes: ["transcription"],
            transports: ["gateway-relay"],
            brains: ["none"],
          },
          {
            id: "custom-stt",
            label: "Custom Realtime Transcription",
            configured: true,
            modes: ["transcription"],
            transports: ["gateway-relay"],
            brains: ["none"],
          },
        ],
      },
    })).toMatchObject({
      state: "ready",
      label: "Review provider listed",
      providerId: "openai",
    });
  });

  it("uses a preferred provider from the catalog when selected", () => {
    expect(analyzeTalkCatalogForReview({
      transcription: {
        activeProvider: "openai",
        providers: [
          {
            id: "openai",
            label: "OpenAI Realtime Transcription",
            configured: true,
            modes: ["transcription"],
            transports: ["gateway-relay"],
            brains: ["none"],
          },
          {
            id: "custom-stt",
            label: "Custom Realtime Transcription",
            configured: true,
            modes: ["transcription"],
            transports: ["gateway-relay"],
            brains: ["none"],
          },
        ],
      },
    }, "custom-stt")).toMatchObject({
      state: "ready",
      label: "Review provider listed",
      providerId: "custom-stt",
      providers: [
        { id: "openai", label: "OpenAI Realtime Transcription" },
        { id: "custom-stt", label: "Custom Realtime Transcription" },
      ],
    });
  });

  it("does not silently fall back when a preferred provider is unavailable", () => {
    const status = analyzeTalkCatalogForReview({
      transcription: {
        activeProvider: "openai",
        providers: [
          {
            id: "openai",
            label: "OpenAI Realtime Transcription",
            configured: true,
            modes: ["transcription"],
            transports: ["gateway-relay"],
            brains: ["none"],
          },
        ],
      },
    }, "custom-stt");
    expect(status).toMatchObject({
      state: "needs-setup",
      providerId: "custom-stt",
      providers: [
        { id: "openai", label: "OpenAI Realtime Transcription" },
      ],
    });
    expect(status.detail).toContain("Refresh the OpenClaw plugin registry");
  });

  it("does not silently fall back when a preferred provider cannot support Review", () => {
    const status = analyzeTalkCatalogForReview({
      transcription: {
        activeProvider: "openai",
        providers: [
          {
            id: "openai",
            label: "OpenAI Realtime Transcription",
            configured: true,
            modes: ["transcription"],
            transports: ["gateway-relay"],
            brains: ["none"],
          },
          {
            id: "custom-stt",
            label: "Custom Realtime Transcription",
            configured: false,
            modes: ["transcription"],
            transports: ["gateway-relay"],
            brains: ["none"],
          },
        ],
      },
    }, "custom-stt");

    expect(status).toMatchObject({
      state: "needs-setup",
      providerId: "custom-stt",
      providers: [
        { id: "openai", label: "OpenAI Realtime Transcription" },
      ],
    });
    expect(status.detail).toContain("not configured for gateway-relay transcription with brain none");
  });

  it("points stale activeProvider recovery at the plugin registry and Gateway restart", () => {
    const status = analyzeTalkCatalogForReview({
      transcription: {
        activeProvider: "xai",
        providers: [
          {
            id: "openai",
            label: "OpenAI Realtime Transcription",
            configured: false,
            modes: ["transcription"],
            transports: ["gateway-relay"],
            brains: ["none"],
          },
        ],
      },
    });
    expect(status).toMatchObject({
      state: "needs-setup",
      providerId: "xai",
    });
    expect(status.detail).toContain("Refresh the OpenClaw plugin registry and restart Gateway");
  });

  it("requires gateway relay transport and brain none", () => {
    expect(analyzeTalkCatalogForReview({
      transcription: {
        activeProvider: "xai",
        providers: [
          {
            id: "xai",
            configured: true,
            modes: ["stt-tts"],
            transports: ["provider-websocket"],
            brains: ["agent-consult"],
          },
        ],
      },
    }).state).toBe("needs-setup");
  });

  it("treats a listed provider as needing attention after a live Review failure", () => {
    const listed = analyzeTalkCatalogForReview({
      transcription: {
        activeProvider: "openai",
        providers: [
          {
            id: "openai",
            label: "OpenAI Realtime Transcription",
            configured: true,
            modes: ["transcription"],
            transports: ["gateway-relay"],
            brains: ["none"],
          },
        ],
      },
    });

    expect(applyReviewVoiceFailure(listed, {
      mode: "review",
      providerId: "openai",
      error: "OpenAI Realtime transcription client secret failed (404)",
    })).toMatchObject({
      state: "needs-setup",
      label: "Review needs Gateway attention",
      providerId: "openai",
      detail: expect.stringContaining("last live Review attempt failed"),
    });
  });

  it("does not mark another provider unhealthy after a different provider fails", () => {
    const listed = analyzeTalkCatalogForReview({
      transcription: {
        activeProvider: "custom-stt",
        providers: [
          {
            id: "custom-stt",
            label: "Custom Realtime Transcription",
            configured: true,
            modes: ["transcription"],
            transports: ["gateway-relay"],
            brains: ["none"],
          },
        ],
      },
    });

    expect(applyReviewVoiceFailure(listed, {
      mode: "review",
      providerId: "openai",
      error: "OpenAI failed",
    })).toEqual(listed);
  });
});

describe("Talk catalog review status helpers", () => {
  const providers = [{ id: "openai", label: "OpenAI Realtime Transcription" }];

  it("builds the checking status while preserving known providers", () => {
    expect(checkingTalkCatalogReviewStatus(providers)).toEqual({
      state: "checking",
      label: "Checking Review availability",
      detail: "Reading OpenClaw Talk transcription capabilities from Gateway.",
      providers,
    });
  });

  it("builds the gateway waiting status while preserving known providers", () => {
    expect(gatewayWaitingTalkCatalogReviewStatus(providers)).toEqual({
      state: "checking",
      label: "Review waits for Gateway",
      detail: "Waiting for Gateway connection before reading Talk capabilities.",
      providers,
    });
  });

  it("builds an unavailable status from an error", () => {
    expect(unavailableTalkCatalogReviewStatus(new Error("boom"), providers)).toEqual({
      state: "unavailable",
      label: "Review availability check failed",
      detail: "boom",
      providers,
    });
  });
});
