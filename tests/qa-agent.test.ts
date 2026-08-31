import { describe, expect, it } from "vitest";
import { vetResearchOutput } from "../src/server/intelligence/qa-agent";
import type { BattlecardDraft, CollectedEvidence, ExtractedClaim } from "../src/server/intelligence/pilot-types";

const draft: BattlecardDraft = {
  snapshot: ["A source-backed seller summary.", "A second seller summary.", "A third seller summary."],
  positioning: "Source-backed positioning guidance that is long enough to be useful in a seller conversation and can be traced to external evidence.",
  likelyObjections: [{ objection: "A buyer may prefer the incumbent.", reframe: "Test the workflow fit.", sayThis: "Let us compare the required workflow proof." }],
  questionsToAsk: ["Which regional, implementation, and workflow constraints matter most?"],
  pricingSignals: ["No reliable public list pricing was found."],
  sourceWarnings: []
};

function evidence(sourceType: CollectedEvidence["sourceType"]): CollectedEvidence {
  return { id: sourceType, title: `${sourceType} evidence`, url: `https://example.com/${sourceType}`, sourceType, sourceTier: sourceType === "web_search" ? "D" : "B", region: "Global", fetchedAt: "2026-01-01T00:00:00.000Z", content: "Substantive external evidence for quality-gate testing.", contentHash: sourceType, authorityScore: 0.8 };
}

const claim: ExtractedClaim = { predicate: "positioning", value: "Source-backed value", claimType: "competitor_positioning", confidence: 0.8, sourceIds: ["competitor_site"], region: "Global", status: "pending" };

describe("seller-facing quality gate", () => {
  it("rejects a live result with no regional evidence", () => {
    const result = vetResearchOutput({ evidence: [evidence("competitor_site"), evidence("web_search"), evidence("news_search")], claims: [claim], battlecardDraft: draft });
    expect(result.passed).toBe(false);
    expect(result.issues).toContain("No source-backed regional-footprint evidence was collected.");
  });

  it("accepts a well-sourced result that includes regional evidence", () => {
    const result = vetResearchOutput({ evidence: [evidence("competitor_site"), evidence("regional_search"), evidence("news_search")], claims: [claim], battlecardDraft: draft });
    expect(result.passed).toBe(true);
  });
});
