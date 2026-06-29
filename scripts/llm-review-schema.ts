export const LLM_REVIEW_VERDICTS = ["pass", "warn", "fail", "inconclusive"] as const;
export type LlmReviewVerdict = typeof LLM_REVIEW_VERDICTS[number];

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

export type LlmReviewStory = {
  concerns: string[];
  confidence: number;
  matchedEvidence: string[];
  requiredFixes: string[];
  storyId: LlmReviewStoryId;
  summary: string;
  verdict: LlmReviewVerdict;
};

export type LlmReview = {
  nextActions: string[];
  overallVerdict: LlmReviewVerdict;
  storyReviews: LlmReviewStory[];
  summary?: string;
};

const VERDICT_SET = new Set<string>(LLM_REVIEW_VERDICTS);
const STORY_ID_SET = new Set<string>(LLM_REVIEW_STORY_IDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function storyPath(index: number, field?: string) {
  return `storyReviews[${index}]${field ? `.${field}` : ""}`;
}

export function validateLlmReview(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["review must be a JSON object."];

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
  return errors;
}

export function createLlmReviewTemplate(): LlmReview {
  return {
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
