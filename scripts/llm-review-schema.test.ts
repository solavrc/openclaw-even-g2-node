import { describe, expect, it } from "vitest";
import {
  createLlmReviewTemplate,
  validateLlmReview,
} from "./llm-review-schema.ts";

describe("LLM review schema", () => {
  it("accepts the generated template", () => {
    expect(validateLlmReview(createLlmReviewTemplate())).toEqual([]);
  });

  it("requires all story ids exactly once", () => {
    const review = createLlmReviewTemplate();
    review.storyReviews = review.storyReviews.filter((story) => story.storyId !== "story-8");

    expect(validateLlmReview(review)).toEqual(expect.arrayContaining([
      "storyReviews must contain exactly 8 entries.",
      "storyReviews is missing story-8.",
    ]));
  });

  it("rejects invalid verdicts and confidence ranges", () => {
    const review = createLlmReviewTemplate() as unknown as {
      overallVerdict: string;
      storyReviews: Array<{ confidence: number; verdict: string }>;
    };
    review.overallVerdict = "maybe";
    review.storyReviews[0].verdict = "ok";
    review.storyReviews[0].confidence = 1.2;

    expect(validateLlmReview(review)).toEqual(expect.arrayContaining([
      "overallVerdict must be one of: pass, warn, fail, inconclusive.",
      "storyReviews[0].verdict must be one of: pass, warn, fail, inconclusive.",
      "storyReviews[0].confidence must be a number from 0 to 1.",
    ]));
  });

  it("requires non-empty summaries and string-array evidence fields", () => {
    const review = createLlmReviewTemplate() as unknown as {
      storyReviews: Array<{
        concerns: unknown;
        matchedEvidence: unknown;
        requiredFixes: unknown;
        summary: string;
      }>;
    };
    review.storyReviews[0].summary = "";
    review.storyReviews[0].matchedEvidence = ["ok", 1];
    review.storyReviews[0].concerns = "none";
    review.storyReviews[0].requiredFixes = [false];

    expect(validateLlmReview(review)).toEqual(expect.arrayContaining([
      "storyReviews[0].summary must be a non-empty string.",
      "storyReviews[0].matchedEvidence must be an array of strings.",
      "storyReviews[0].concerns must be an array of strings.",
      "storyReviews[0].requiredFixes must be an array of strings.",
    ]));
  });
});
