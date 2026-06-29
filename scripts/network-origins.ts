const DEVELOPMENT_ORIGIN_PATTERNS = [
  /^(?:https?|wss?):\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i,
  /^(?:https?|wss?):\/\/10\./i,
  /^(?:https?|wss?):\/\/172\.(?:1[6-9]|2\d|3[0-1])\./i,
  /^(?:https?|wss?):\/\/192\.168\./i,
  /^(?:https?|wss?):\/\/100\./i,
  /\.ts\.net(?::\d+)?$/i,
  /\.local(?::\d+)?$/i,
];

export function isDevelopmentNetworkOrigin(origin: string): boolean {
  return DEVELOPMENT_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

export type NetworkReviewMetadata = {
  whitelist: string[];
  developmentOrigins: string[];
  reviewRequired: boolean;
  reviewRisk: string | null;
  publicReleaseBlockedByNetworkReview: boolean;
};

export function networkReviewMetadata(whitelist: string[]): NetworkReviewMetadata {
  const developmentOrigins = whitelist.filter(isDevelopmentNetworkOrigin);
  const reviewRisk = developmentOrigins.length
    ? `Runtime user-owned OpenClaw Gateway WebSocket endpoint review is required, and the manifest still contains development/private whitelist origins: ${developmentOrigins.join(", ")}`
    : !whitelist.length
      ? "Runtime user-owned OpenClaw Gateway WebSocket endpoint is configured after install; Even Hub review must confirm the accepted network declaration."
      : null;

  return {
    whitelist,
    developmentOrigins,
    reviewRequired: Boolean(reviewRisk),
    reviewRisk,
    publicReleaseBlockedByNetworkReview: Boolean(reviewRisk),
  };
}
