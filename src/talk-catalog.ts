export type TalkCatalogReviewProvider = {
  id: string;
  label: string;
};

type TalkCatalogReviewStatusBase = {
  label: string;
  detail: string;
  providers: TalkCatalogReviewProvider[];
};

export type TalkCatalogReviewStatus =
  | {
      state: "unknown" | "checking";
    } & TalkCatalogReviewStatusBase
  | {
      state: "ready";
      providerId: string;
    } & TalkCatalogReviewStatusBase
  | {
      state: "needs-setup" | "unavailable";
      providerId?: string;
    } & TalkCatalogReviewStatusBase;

export type TalkCatalogReviewFailure = {
  error: string;
  mode?: string;
  providerId?: string;
};

type ProviderRecord = {
  id: string;
  label: string;
  configured: boolean;
  modes: string[];
  transports: string[];
  brains: string[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function providersFrom(value: unknown): ProviderRecord[] {
  return Array.isArray(value)
    ? value.map((item) => {
      const provider = record(item);
      return {
        id: stringValue(provider.id),
        label: stringValue(provider.label),
        configured: booleanValue(provider.configured),
        modes: stringList(provider.modes),
        transports: stringList(provider.transports),
        brains: stringList(provider.brains),
      };
    }).filter((provider) => provider.id)
    : [];
}

function supportsReview(provider: ProviderRecord) {
  return provider.configured
    && provider.modes.includes("transcription")
    && provider.transports.includes("gateway-relay")
    && provider.brains.includes("none");
}

function providerName(provider: ProviderRecord) {
  return provider.label || provider.id;
}

function publicProviders(providers: ProviderRecord[]): TalkCatalogReviewProvider[] {
  return providers.map((provider) => ({
    id: provider.id,
    label: providerName(provider),
  }));
}

function reviewReadyStatus(
  provider: ProviderRecord,
  detail: string,
  providers: TalkCatalogReviewProvider[],
): TalkCatalogReviewStatus {
  return {
    state: "ready",
    label: "Review provider listed",
    providerId: provider.id,
    detail,
    providers,
  };
}

function reviewNeedsSetupStatus(
  detail: string,
  providers: TalkCatalogReviewProvider[],
  providerId?: string,
): TalkCatalogReviewStatus {
  return {
    state: "needs-setup",
    label: "Review needs Gateway setup",
    ...(providerId ? { providerId } : {}),
    detail,
    providers,
  };
}

function firstValidProviderStatus(
  validProviders: ProviderRecord[],
  reviewProviders: TalkCatalogReviewProvider[],
  detailForProvider: (provider: ProviderRecord) => string,
) {
  const provider = validProviders[0];
  return provider ? reviewReadyStatus(provider, detailForProvider(provider), reviewProviders) : null;
}

function preferredProviderReviewStatus(
  preferredProvider: string,
  providers: ProviderRecord[],
  reviewProviders: TalkCatalogReviewProvider[],
): TalkCatalogReviewStatus {
  const preferred = providers.find((provider) => provider.id === preferredProvider);
  if (!preferred) {
    return reviewNeedsSetupStatus(
      `Selected Review provider "${preferredProvider}" is not available in talk.catalog. Refresh the OpenClaw plugin registry, restart Gateway, or choose Gateway default.`,
      reviewProviders,
      preferredProvider,
    );
  }
  if (!supportsReview(preferred)) {
    return reviewNeedsSetupStatus(
      `${providerName(preferred)} is selected for Review, but it is not configured for gateway-relay transcription with brain none.`,
      reviewProviders,
      preferred.id,
    );
  }
  return reviewReadyStatus(
    preferred,
    `${providerName(preferred)} is listed for Review Talk transcription. The live provider is verified when recording starts.`,
    reviewProviders,
  );
}

function activeProviderReviewStatus(
  activeProvider: string,
  providers: ProviderRecord[],
  reviewProviders: TalkCatalogReviewProvider[],
): TalkCatalogReviewStatus {
  const active = providers.find((provider) => provider.id === activeProvider);
  if (!active) {
    return reviewNeedsSetupStatus(
      `OpenClaw reports activeProvider "${activeProvider}", but that provider is not available in talk.catalog. Refresh the OpenClaw plugin registry and restart Gateway.`,
      reviewProviders,
      activeProvider,
    );
  }
  if (!supportsReview(active)) {
    return reviewNeedsSetupStatus(
      `${providerName(active)} is selected, but it is not configured for gateway-relay transcription with brain none.`,
      reviewProviders,
      active.id,
    );
  }
  return reviewReadyStatus(
    active,
    `${providerName(active)} is listed for OpenClaw Talk transcription. The live provider is verified when recording starts.`,
    reviewProviders,
  );
}

export function analyzeTalkCatalogForReview(catalog: unknown, preferredProviderId = ""): TalkCatalogReviewStatus {
  const root = record(catalog);
  const transcription = record(root.transcription);
  const activeProvider = stringValue(transcription.activeProvider);
  const preferredProvider = stringValue(preferredProviderId);
  const providers = providersFrom(transcription.providers);
  const validProviders = providers.filter(supportsReview);
  const reviewProviders = publicProviders(validProviders);

  if (!providers.length) {
    return {
      state: "unavailable",
      label: "Review is not available",
      detail: "OpenClaw Talk reported no transcription providers. Use the setup request to enable Gateway voice setup.",
      providers: [],
    };
  }

  if (preferredProvider) {
    return preferredProviderReviewStatus(preferredProvider, providers, reviewProviders);
  }

  if (activeProvider) {
    return activeProviderReviewStatus(activeProvider, providers, reviewProviders);
  }

  const firstValid = firstValidProviderStatus(
    validProviders,
    reviewProviders,
    (provider) => `${providerName(provider)} is listed for OpenClaw Talk transcription. The live provider is verified when recording starts.`,
  );
  if (firstValid) return firstValid;

  return reviewNeedsSetupStatus(
    "OpenClaw Talk has providers, but none are configured for gateway-relay transcription with brain none.",
    [],
  );
}

export function unknownTalkCatalogReviewStatus(): TalkCatalogReviewStatus {
  return {
    state: "unknown",
    label: "Review availability not checked",
    detail: "Connect to OpenClaw Gateway to check whether Review can stream Talk transcription.",
    providers: [],
  };
}

export function checkingTalkCatalogReviewStatus(providers: TalkCatalogReviewProvider[]): TalkCatalogReviewStatus {
  return {
    state: "checking",
    label: "Checking Review availability",
    detail: "Reading OpenClaw Talk transcription capabilities from Gateway.",
    providers,
  };
}

export function gatewayWaitingTalkCatalogReviewStatus(providers: TalkCatalogReviewProvider[]): TalkCatalogReviewStatus {
  return {
    state: "checking",
    label: "Review waits for Gateway",
    detail: "Waiting for Gateway connection before reading Talk capabilities.",
    providers,
  };
}

export function unavailableTalkCatalogReviewStatus(error: unknown, providers: TalkCatalogReviewProvider[]): TalkCatalogReviewStatus {
  return {
    state: "unavailable",
    label: "Review availability check failed",
    detail: error instanceof Error ? error.message : String(error),
    providers,
  };
}

export function talkCatalogReviewStatusesEqual(
  left: TalkCatalogReviewStatus,
  right: TalkCatalogReviewStatus,
) {
  const leftProviderId = "providerId" in left ? left.providerId || "" : "";
  const rightProviderId = "providerId" in right ? right.providerId || "" : "";
  return left.state === right.state
    && left.label === right.label
    && left.detail === right.detail
    && leftProviderId === rightProviderId
    && left.providers.length === right.providers.length
    && left.providers.every((provider, index) => {
      const other = right.providers[index];
      return provider.id === other?.id && provider.label === other.label;
    });
}

export function applyReviewVoiceFailure(
  status: TalkCatalogReviewStatus,
  failure: TalkCatalogReviewFailure | null | undefined,
): TalkCatalogReviewStatus {
  if (!failure || failure.mode !== "review" || status.state !== "ready") return status;
  const failedProvider = (failure.providerId || "").trim();
  if (failedProvider && failedProvider !== status.providerId) return status;
  const provider = status.providers.find((item) => item.id === status.providerId);
  const providerLabel = provider?.label || status.providerId;
  const errorText = failure.error.replace(/^error:\s*/i, "").trim();
  return {
    state: "needs-setup",
    label: "Review needs Gateway attention",
    providerId: status.providerId,
    providers: status.providers,
    detail: `${providerLabel} is listed in talk.catalog, but the last live Review attempt failed before transcript text was returned.${errorText ? ` Gateway error: ${errorText}` : ""}`,
  };
}
