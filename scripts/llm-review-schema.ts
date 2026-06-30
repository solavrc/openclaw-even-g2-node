export const LLM_REVIEW_VERDICTS = ["pass", "warn", "fail", "inconclusive"] as const;
export type LlmReviewVerdict = typeof LLM_REVIEW_VERDICTS[number];

export const LLM_REVIEW_COVERAGE_STATUSES = ["observed", "partial", "unobserved", "not-applicable"] as const;
export type LlmReviewCoverageStatus = typeof LLM_REVIEW_COVERAGE_STATUSES[number];

export const LLM_REVIEW_STORY_IDS = [
  "story-1",
  "story-2",
  "story-3",
  "story-4",
  "story-5",
  "story-6",
  "story-7",
  "story-8",
] as const;

export type LlmReviewStoryId = typeof LLM_REVIEW_STORY_IDS[number];

export const LLM_REVIEW_COVERAGE_IDS = [
  "story-1.1",
  "story-1.2",
  "story-1.3",
  "story-1.4",
  "story-1.5",
  "story-1.6",
  "story-2.1",
  "story-2.2",
  "story-2.3",
  "story-2.4",
  "story-2.5",
  "story-3.1",
  "story-3.2",
  "story-3.3",
  "story-3.4",
  "story-4.1",
  "story-4.2",
  "story-4.3",
  "story-4.4",
  "story-4.5",
  "story-4.6",
  "story-5.1",
  "story-5.2",
  "story-5.3",
  "story-5.4",
  "story-5.5",
  "story-5.6",
  "story-6.1",
  "story-6.2",
  "story-6.3",
  "story-6.4",
  "story-6.5",
  "story-6.6",
  "story-6.7",
  "story-7.1",
  "story-7.2",
  "story-7.3",
  "story-7.4",
  "story-7.5",
  "story-7.6",
  "story-8.1",
  "story-8.2",
  "story-8.3",
  "story-8.4",
  "story-8.5",
  "story-8.6",
  "story-8.7",
  "story-8.8",
] as const;

export type LlmReviewCoverageId = typeof LLM_REVIEW_COVERAGE_IDS[number];

export type LlmReviewStory = {
  concerns: string[];
  confidence: number;
  matchedEvidence: string[];
  requiredFixes: string[];
  storyId: LlmReviewStoryId;
  summary: string;
  verdict: LlmReviewVerdict;
};

export type LlmReviewCoverage = {
  concerns: string[];
  coverageId: LlmReviewCoverageId | string;
  evidence: string[];
  status: LlmReviewCoverageStatus;
};

export type LlmReview = {
  coverageReviews: LlmReviewCoverage[];
  nextActions: string[];
  overallVerdict: LlmReviewVerdict;
  storyReviews: LlmReviewStory[];
  summary?: string;
};

const VERDICT_SET = new Set<string>(LLM_REVIEW_VERDICTS);
const STORY_ID_SET = new Set<string>(LLM_REVIEW_STORY_IDS);
const COVERAGE_STATUS_SET = new Set<string>(LLM_REVIEW_COVERAGE_STATUSES);

export function coverageIdsFromUserStoriesMarkdown(markdown: string): string[] {
  return [...markdown.matchAll(/^###\s+(\d+\.\d+)\s+/gm)].map((match) => `story-${match[1]}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function storyPath(index: number, field?: string) {
  return `storyReviews[${index}]${field ? `.${field}` : ""}`;
}

function coveragePath(index: number, field?: string) {
  return `coverageReviews[${index}]${field ? `.${field}` : ""}`;
}

export function validateLlmReview(value: unknown, options: { coverageIds?: readonly string[] } = {}): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["review must be a JSON object."];
  const coverageIds = options.coverageIds?.length ? options.coverageIds : LLM_REVIEW_COVERAGE_IDS;
  const coverageIdSet = new Set<string>(coverageIds);

  if (!VERDICT_SET.has(String(value.overallVerdict))) {
    errors.push(`overallVerdict must be one of: ${LLM_REVIEW_VERDICTS.join(", ")}.`);
  }
  if (value.summary !== undefined && typeof value.summary !== "string") {
    errors.push("summary must be a string when present.");
  }
  if (!stringArray(value.nextActions)) {
    errors.push("nextActions must be an array of strings.");
  }
  if (!Array.isArray(value.storyReviews)) {
    errors.push("storyReviews must be an array.");
    return errors;
  }
  if (value.storyReviews.length !== LLM_REVIEW_STORY_IDS.length) {
    errors.push(`storyReviews must contain exactly ${LLM_REVIEW_STORY_IDS.length} entries.`);
  }

  const seen = new Set<string>();
  value.storyReviews.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`${storyPath(index)} must be an object.`);
      return;
    }
    const storyId = typeof item.storyId === "string" ? item.storyId : "";
    if (!STORY_ID_SET.has(storyId)) {
      errors.push(`${storyPath(index, "storyId")} must be one of: ${LLM_REVIEW_STORY_IDS.join(", ")}.`);
    } else if (seen.has(storyId)) {
      errors.push(`${storyPath(index, "storyId")} duplicates ${storyId}.`);
    } else {
      seen.add(storyId);
    }
    if (!VERDICT_SET.has(String(item.verdict))) {
      errors.push(`${storyPath(index, "verdict")} must be one of: ${LLM_REVIEW_VERDICTS.join(", ")}.`);
    }
    if (typeof item.confidence !== "number" || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) {
      errors.push(`${storyPath(index, "confidence")} must be a number from 0 to 1.`);
    }
    if (typeof item.summary !== "string" || item.summary.trim().length === 0) {
      errors.push(`${storyPath(index, "summary")} must be a non-empty string.`);
    }
    for (const field of ["matchedEvidence", "concerns", "requiredFixes"] as const) {
      if (!stringArray(item[field])) errors.push(`${storyPath(index, field)} must be an array of strings.`);
    }
  });

  for (const storyId of LLM_REVIEW_STORY_IDS) {
    if (!seen.has(storyId)) errors.push(`storyReviews is missing ${storyId}.`);
  }

  if (!Array.isArray(value.coverageReviews)) {
    errors.push("coverageReviews must be an array.");
    return errors;
  }
  if (value.coverageReviews.length !== coverageIds.length) {
    errors.push(`coverageReviews must contain exactly ${coverageIds.length} entries.`);
  }

  const seenCoverage = new Set<string>();
  value.coverageReviews.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`${coveragePath(index)} must be an object.`);
      return;
    }
    const coverageId = typeof item.coverageId === "string" ? item.coverageId : "";
    if (!coverageIdSet.has(coverageId)) {
      errors.push(`${coveragePath(index, "coverageId")} must be one of: ${coverageIds.join(", ")}.`);
    } else if (seenCoverage.has(coverageId)) {
      errors.push(`${coveragePath(index, "coverageId")} duplicates ${coverageId}.`);
    } else {
      seenCoverage.add(coverageId);
    }
    if (!COVERAGE_STATUS_SET.has(String(item.status))) {
      errors.push(`${coveragePath(index, "status")} must be one of: ${LLM_REVIEW_COVERAGE_STATUSES.join(", ")}.`);
    }
    if (!stringArray(item.evidence)) errors.push(`${coveragePath(index, "evidence")} must be an array of strings.`);
    if (!stringArray(item.concerns)) errors.push(`${coveragePath(index, "concerns")} must be an array of strings.`);
  });

  for (const coverageId of coverageIds) {
    if (!seenCoverage.has(coverageId)) errors.push(`coverageReviews is missing ${coverageId}.`);
  }
  return errors;
}

export function createLlmReviewTemplate(coverageIds: readonly string[] = LLM_REVIEW_COVERAGE_IDS): LlmReview {
  return {
    coverageReviews: coverageIds.map((coverageId) => ({
      concerns: ["Not reviewed yet."],
      coverageId,
      evidence: [],
      status: "unobserved",
    })),
    overallVerdict: "inconclusive",
    summary: "Replace this template with the Coding Agent's fuzzy user-story review.",
    storyReviews: LLM_REVIEW_STORY_IDS.map((storyId) => ({
      concerns: [],
      confidence: 0,
      matchedEvidence: [],
      requiredFixes: [],
      storyId,
      summary: "Not reviewed yet.",
      verdict: "inconclusive",
    })),
    nextActions: ["Read review-prompt.md and evidence.json, then replace this template with the agent review."],
  };
}
