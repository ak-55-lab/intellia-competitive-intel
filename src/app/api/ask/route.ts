import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { ResearchRun } from "@/types/research";
import { registerPublicAssistantRequest } from "@/server/intelligence/public-assistant-rate-limit";
import { loadLatestResearchRun } from "@/server/intelligence/research-run-store";

const schema = z.object({ question: z.string().trim().min(3).max(500), run: z.unknown().optional() });

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  if (!await registerPublicAssistantRequest(request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null)) return NextResponse.json({ error: "assistant_rate_limited" }, { status: 429 });

  const submittedRun = asResearchRun(parsed.data.run);
  const run = submittedRun ?? await loadLatestResearchRun();
  if (!run || run.dataMode !== "live") return NextResponse.json({ error: "live_research_required" }, { status: 409 });
  const sources = uniqueSources(run.competitors.flatMap((competitor) => competitor.contextNodes.flatMap((node) => node.sources ?? [])));
  const context = run.competitors.map((competitor) => ({
    name: competitor.name,
    positioning: competitor.sellerPositioning,
    snapshot: competitor.battlecard.snapshot,
    objections: competitor.battlecard.likelyObjections,
    questions: competitor.battlecard.questionsToAsk,
    sections: competitor.contextNodes.map((node) => ({ title: node.title, details: node.details, insights: node.insightItems?.map((item) => ({ title: item.title, summary: item.summary, sellerMove: item.sellerImplication })) }))
  }));
  const selectedSources = rankSources(sources, parsed.data.question).slice(0, 8);
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      instructions: "You are Ask Intellia, an external competitive-intelligence assistant for sellers. Use only the supplied verified run context. Do not invent competitor facts or claim evidence is current beyond the run timestamp. Give a concise seller-ready response in three short sections: Answer, Suggested seller move, Evidence caveat. Do not use markdown tables.",
      input: JSON.stringify({ question: parsed.data.question, generatedAt: run.generatedAt, company: run.companyName, competitorContext: context, sourceIndex: selectedSources.map((source, index) => ({ id: index + 1, title: source.title, url: source.url, tier: source.tier, type: source.sourceType })) }),
      max_output_tokens: 900
    });
    return NextResponse.json({ answer: response.output_text || "No answer was generated from the current evidence.", citations: selectedSources });
  } catch {
    return NextResponse.json({ error: "answer_generation_failed" }, { status: 502 });
  }
}

function asResearchRun(value: unknown): ResearchRun | null {
  if (!value || typeof value !== "object") return null;
  const run = value as Partial<ResearchRun>;
  if (typeof run.companyName !== "string" || typeof run.generatedAt !== "string" || run.dataMode !== "live" || !Array.isArray(run.competitors) || run.competitors.length === 0 || run.competitors.length > 10) return null;
  try {
    return JSON.stringify(run).length <= 650_000 ? run as ResearchRun : null;
  } catch {
    return null;
  }
}

function uniqueSources(sources: Array<{ title: string; url: string; tier: string; sourceType?: string }>) { const seen = new Set<string>(); return sources.filter((source) => !seen.has(source.url) && Boolean(source.url) && (seen.add(source.url), true)); }
function rankSources<T extends { title: string; url: string }>(sources: T[], question: string) { const terms = question.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2); return [...sources].sort((left, right) => score(right) - score(left)); function score(source: T) { const haystack = `${source.title} ${source.url}`.toLowerCase(); return terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0); } }
