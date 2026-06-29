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
    const review = createLlmReviewTemplate();
    Object.assign(review, { overallVerdict: "maybe" });
    Object.assign(review.storyReviews[0], { verdict: "ok", confidence: 1.2 });

    expect(validateLlmReview(review)).toEqual(expect.arrayContaining([
      "overallVerdict must be one of: pass, warn, fail, inconclusive.",
      "storyReviews[0].verdict must be one of: pass, warn, fail, inconclusive.",
      "storyReviews[0].confidence must be a number from 0 to 1.",
    ]));
  });

  it("requires non-empty summaries and string-array evidence fields", () => {
    const review = createLlmReviewTemplate();
    Object.assign(review.storyReviews[0], {
      concerns: "none",
      matchedEvidence: ["ok", 1],
      requiredFixes: [false],
      summary: "",
    });

    expect(validateLlmReview(review)).toEqual(expect.arrayContaining([
      "storyReviews[0].summary must be a non-empty string.",
      "storyReviews[0].matchedEvidence must be an array of strings.",
      "storyReviews[0].concerns must be an array of strings.",
      "storyReviews[0].requiredFixes must be an array of strings.",
    ]));
  });
});
