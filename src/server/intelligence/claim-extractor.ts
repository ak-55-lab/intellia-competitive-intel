import OpenAI from "openai";
import type { BattlecardDraft, CollectedEvidence, ExtractedClaim, PilotCompetitor } from "@/server/intelligence/pilot-types";

type ExtractionOutput = {
  claims: ExtractedClaim[];
  battlecardDraft: BattlecardDraft;
  findings: string[];
};

type RawObject = Record<string, unknown>;

export async function extractClaimsAndDraftBattlecard(input: {
  company: PilotCompetitor;
  competitor: PilotCompetitor;
  evidence: CollectedEvidence[];
}): Promise<ExtractionOutput> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const compactEvidence = input.evidence.map((item) => ({
    id: item.id,
    title: item.title,
    url: item.url,
    sourceType: item.sourceType,
    sourceTier: item.sourceTier,
    region: item.region,
    excerpt: item.content.slice(0, 4000)
  }));

  const instructions = [
      "You are Intellia's competitive intelligence extraction agent.",
      "Use only supplied evidence. Do not invent facts.",
      "Mark uncertain seller guidance as INF. Public source claims from company or competitor websites can be A.",
      "Evidence may include GTM search lanes inspired by GTM Skills: Battlecard, Competitor positioning, Regional footprint, Pricing, Synthetic voice of customer, Brand mention monitor, Partner ecosystem, Events watch, AI initiatives, Hiring motion, Financial and ownership, Case study miner, Analyst ranking watch, The signal sourcer, Community radar, and Market landscape.",
      "Use the Battlecard and Competitor positioning lanes for strengths, weaknesses, positioning, win conditions, and talk tracks.",
      "Use Brand mention monitor and The signal sourcer lanes for recent events, partnerships, customer wins, hiring, funding, expansion, or launch signals.",
      "Use Case study miner for customer proof, logo signals, deployment story evidence, and vertical fit. Do not overstate logo usage beyond what the source says.",
      "Use Analyst ranking watch for Verdantix, Gartner, Forrester, IDC, or similar third-party ranking signals. Treat vendor-owned ranking mentions as claims about the vendor's quote unless the original analyst report is supplied.",
      "Use Partner ecosystem, Events watch, AI initiatives, Hiring motion, and Financial and ownership lanes to extract market signals and the seller implication of those signals.",
      "Use Regional footprint only for source-backed coverage, localization, support, hosting, office, customer, or regulatory-fit context. Do not turn a targeted search query into a coverage claim; identify uncertainty and the country-level proof the seller should request.",
      "Use Synthetic voice of customer and Community radar lanes only for sourced review/community themes; if they are absent or not competitor-specific, state that no usable review theme was found.",
      "Return strict JSON only with keys: claims, battlecardDraft, findings.",
      "claims must be an array of objects with predicate, value, claimType, confidence, sourceIds, region, status.",
      "Return at most 10 claims, at most 5 findings, at most 5 snapshot bullets, at most 5 pricingSignals, and at most 5 likelyObjections.",
      "Keep every string under 240 characters. Prefer concise source-grounded summaries over long excerpts.",
      "battlecardDraft must contain snapshot as string[], positioning as a string, likelyObjections as objects, questionsToAsk as string[], pricingSignals as string[], sourceWarnings as string[].",
      "For pricingSignals, distinguish public list pricing, quote-based packaging, implementation/service cost signals, and 'no reliable public pricing found'. Do not infer numbers unless the supplied evidence states them.",
      "Use review_search evidence for seller-useful review themes, but treat it as directional and lower-confidence than vendor or customer-owned sources.",
      "Every likelyObjections item must have non-empty objection, reframe, and sayThis strings.",
      "findings must be string[].",
      "Every claim must include sourceIds from the supplied evidence IDs and status pending."
    ].join("\n");
  const prompt = JSON.stringify({
    company: input.company,
    competitor: input.competitor,
    evidence: compactEvidence
  });
  const response = await createWithModelFallback(client, instructions, prompt);

  const parsed = parseJson(response.output_text || "{}");
  return {
    claims: normalizeClaims(parsed.claims, input.evidence),
    battlecardDraft: normalizeDraft(parsed.battlecardDraft),
    findings: arrayOfStrings(parsed.findings)
  };
}

async function createWithModelFallback(client: OpenAI, instructions: string, input: string) {
  const candidates = [
    process.env.OPENAI_MODEL,
    process.env.OPENAI_FALLBACK_MODEL,
    "gpt-5.6-terra",
    "gpt-5.5-pro",
    "gpt-5.4",
    "gpt-5.6-luna",
    "gpt-4o-mini"
  ].filter((model, index, models): model is string => Boolean(model) && models.indexOf(model) === index);

  let lastError: unknown;
  for (const model of candidates) {
    try {
      console.log(`Extraction model: ${model}`);
      return await client.responses.create({
        model,
        instructions,
        input,
        max_output_tokens: 6000
      });
    } catch (error) {
      lastError = error;
      const code = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "";
      if (code !== "model_not_found") throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("No OpenAI model candidate succeeded");
}

function parseJson(text: string): Record<string, unknown> {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned) as Record<string, unknown>;
}

function normalizeClaims(value: unknown, evidence: CollectedEvidence[]): ExtractedClaim[] {
  const items = Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : [];
  const evidenceIds = new Set(evidence.map((item) => item.id));

  return items
    .map((item) => item as Partial<ExtractedClaim>)
    .filter((item) => item.predicate && item.value)
    .map((item) => ({
      predicate: String(item.predicate),
      value: String(item.value),
      claimType: String(item.claimType ?? "positioning"),
      confidence: normalizeConfidence(item.confidence),
      sourceIds: Array.isArray(item.sourceIds) ? item.sourceIds.map(String).filter((id) => evidenceIds.has(id)) : [],
      region: String(item.region ?? "Global"),
      status: "pending"
    }));
}

function normalizeDraft(value: unknown): BattlecardDraft {
  const draft = (value ?? {}) as Partial<BattlecardDraft>;
  return {
    snapshot: arrayOfStrings(draft.snapshot),
    positioning: textValue(draft.positioning),
    likelyObjections: Array.isArray(draft.likelyObjections)
      ? draft.likelyObjections.map((item) => item as { objection?: unknown; reframe?: unknown; sayThis?: unknown }).map((item) => ({
          objection: textValue(item.objection),
          reframe: textValue(item.reframe),
          sayThis: textValue(item.sayThis)
        })).filter((item) => item.objection && item.reframe && item.sayThis)
      : [],
    questionsToAsk: arrayOfStrings(draft.questionsToAsk),
    pricingSignals: arrayOfStrings(draft.pricingSignals),
    sourceWarnings: arrayOfStrings(draft.sourceWarnings)
  };
}

function arrayOfStrings(value: unknown) {
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean);
  if (isRecord(value)) return Object.values(value).map(textValue).filter(Boolean);
  return value ? [textValue(value)] : [];
}

function normalizeConfidence(value: unknown) {
  const direct = Number(value);
  if (Number.isFinite(direct)) return Math.min(1, Math.max(0, direct));
  if (isRecord(value)) {
    const candidates = [value.score, value.value, value.confidence, value.probability].map(Number);
    const found = candidates.find(Number.isFinite);
    if (found !== undefined) return Math.min(1, Math.max(0, found));
  }
  return 0.65;
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join("; ");
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, entry]) => `${key}: ${textValue(entry)}`)
      .join("; ");
  }
  return "";
}

function isRecord(value: unknown): value is RawObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
