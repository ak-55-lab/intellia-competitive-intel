"use client";

import "@xyflow/react/dist/style.css";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import { Activity, CheckCircle2, CircleDollarSign, ExternalLink, ListChecks, Network, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AskIntelliaChat } from "@/components/assistant/ask-intellia-chat";
import type { SellerProfile } from "@/lib/seller-profile";
import type { ResearchCompetitor, ResearchRun } from "@/types/research";

type ResearchConfig = SellerProfile & { mode: "live" };
type StoredRun = ResearchRun | { run: null; stale?: boolean };
type CollectionStatus = { status: "collecting" | "idle" | "failed" | "unavailable"; latestRunAt: string | null; latestCompany: string | null; error?: string | null };
type View = "graph" | "matrix";
const readStorageKey = "intellia.read-seller-signals.v1";
const tenantStorageKey = "intellia.tenant-workspace.v1";
type TenantConfig = { companyName: string; companyWebsite: string; competitorCount: number };

export function ResearchCanvas() {
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [profile, setProfile] = useState<ResearchConfig | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedContextId, setSelectedContextId] = useState<string | null>(null);
  const [view, setView] = useState<View>("graph");
  const [readSignals, setReadSignals] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [collection, setCollection] = useState<CollectionStatus | null>(null);
  const [tenant, setTenant] = useState<TenantConfig>({ companyName: "", companyWebsite: "", competitorCount: 3 });
  const [publicRunning, setPublicRunning] = useState(false);
  const collectionRef = useRef<CollectionStatus | null>(null);

  useEffect(() => {
    try { setReadSignals(new Set(JSON.parse(window.localStorage.getItem(readStorageKey) ?? "[]") as string[])); } catch { /* ignore corrupted local UI state */ }
    try { const saved = JSON.parse(window.localStorage.getItem(tenantStorageKey) ?? "null") as TenantConfig | null; if (saved?.companyName && saved.companyWebsite) setTenant(saved); } catch { /* ignore corrupted local UI state */ }
    void fetch("/api/research/config", { cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error("Workspace configuration is unavailable."); return await response.json() as ResearchConfig; })
      .then((configured) => { setProfile(configured); setTenant((current) => current.companyWebsite ? current : { companyName: configured.companyName, companyWebsite: configured.companyWebsite, competitorCount: Math.min(10, configured.defaultCompetitorCount) }); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Workspace configuration is unavailable."));
    void fetch("/api/research/run", { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as StoredRun : { run: null })
      .then((payload) => {
        if ("run" in payload) { if (payload.stale) setError("The latest intelligence run has expired. Start a new verified run."); return; }
        selectRun(payload);
      }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const loadStatus = () => void fetch("/api/research/status", { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as CollectionStatus : null)
      .then((next) => {
        if (!next) return;
        const previous = collectionRef.current;
        collectionRef.current = next;
        if (previous?.status === "collecting" && next.status === "idle") {
          void fetch("/api/research/run", { cache: "no-store" })
            .then(async (response) => response.ok ? await response.json() as StoredRun : { run: null })
            .then((payload) => { if (!("run" in payload)) selectRun(payload); })
            .catch(() => undefined);
        }
        if (next.status === "failed" && next.error) setError(publicRunError(next.error));
        setCollection(next);
      })
      .catch(() => undefined);
    loadStatus();
    const interval = window.setInterval(loadStatus, 10_000);
    return () => window.clearInterval(interval);
  }, []);

  const selected = run?.competitors.find((competitor) => competitor.id === selectedId) ?? null;
  const selectedContext = selected?.contextNodes.find((node) => node.id === selectedContextId) ?? null;
  const graph = useMemo(() => graphFor(run, selectedId, selectedContextId, readSignals), [run, selectedId, selectedContextId, readSignals]);
  const unread = run ? unreadCount(run, readSignals) : 0;

  function selectRun(nextRun: ResearchRun) { setRun(nextRun); setSelectedId(null); setSelectedContextId(null); }
  function selectContext(contextId: string) {
    if (!run) return;
    setSelectedContextId(contextId);
    const next = new Set(readSignals); next.add(`${run.id}:${contextId}`); setReadSignals(next);
    window.localStorage.setItem(readStorageKey, JSON.stringify([...next].slice(-500)));
  }

  async function analyzeCompany(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPublicRunning(true); setError("");
    try {
      const response = await fetch("/api/research/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyWebsite: tenant.companyWebsite, companyName: tenant.companyName || undefined, competitorCount: tenant.competitorCount })
      });
      const payload = await response.json() as ResearchRun | { status?: string; error?: string; retryAfterMinutes?: number; maxRunsPerHour?: number };
      if (response.status === 202 && "status" in payload && payload.status === "collecting") {
        window.localStorage.setItem(tenantStorageKey, JSON.stringify(tenant));
        setCollection((current) => current ? { ...current, status: "collecting", error: null } : { status: "collecting", latestRunAt: null, latestCompany: null, error: null });
        return;
      }
      if (!response.ok || !("competitors" in payload)) {
        const message = "error" in payload ? publicRunError(payload.error, payload.retryAfterMinutes, payload.maxRunsPerHour) : "Analysis could not complete.";
        throw new Error(message);
      }
      selectRun(payload);
      window.localStorage.setItem(tenantStorageKey, JSON.stringify(tenant));
      setCollection((current) => current ? { ...current, status: "idle" } : current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Analysis could not complete."); }
    finally { setPublicRunning(false); }
  }
  return <div className="grid gap-5 xl:grid-cols-[286px_minmax(0,1fr)]">
    <aside className="surface h-fit overflow-hidden xl:sticky xl:top-20">
      <div className="border-b border-line p-5"><p className="font-mono text-[10px] font-bold uppercase text-faint">Tenant configuration</p><h2 className="mt-1 font-display text-xl font-semibold">Company brain</h2><p className="mt-2 text-xs leading-5 text-muted">Configure the focal company once, then run its selected competitor coverage.</p></div>
      <form onSubmit={analyzeCompany} className="space-y-4 p-5">
        <label className="block text-xs font-bold uppercase text-muted">Company name<input required value={tenant.companyName} onChange={(event) => setTenant((current) => ({ ...current, companyName: event.target.value }))} className="field mt-2" placeholder="Company name" /></label>
        <label className="block text-xs font-bold uppercase text-muted">Company website<input required type="url" value={tenant.companyWebsite} onChange={(event) => setTenant((current) => ({ ...current, companyWebsite: event.target.value }))} className="field mt-2" placeholder="https://company.com" /></label>
        <label className="block text-xs font-bold uppercase text-muted">Competitors<select value={tenant.competitorCount} onChange={(event) => setTenant((current) => ({ ...current, competitorCount: Number(event.target.value) }))} className="field mt-2">{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => <option key={value} value={value}>{value} competitors</option>)}</select></label>
        <button disabled={publicRunning || collection?.status === "collecting"} className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-accent px-4 text-sm font-black text-white disabled:opacity-60">{publicRunning ? "Collecting evidence…" : collection?.status === "collecting" ? "Collection in progress" : "Run intelligence"}</button>
        <p className="text-[11px] leading-5 text-faint">Intellia discovers a live candidate pool with You.com, then researches the top selected competitors. This browser remembers its tenant configuration.</p>
      </form>
    </aside>
    <div className="min-w-0 space-y-5">
    <section className="surface overflow-hidden">
      <div className="border-b border-line p-5"><p className="font-mono text-[10px] font-bold uppercase text-faint">Seller intelligence</p><h1 className="mt-1 font-display text-3xl font-semibold text-ink">External competitive intelligence</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted">Source-backed competitive evidence, seller talk tracks, and a full retrieval trace in one workspace.</p></div>
      <div className="flex flex-wrap items-center justify-between gap-4 p-5"><div className="rounded-lg border border-line bg-[#fbfaf7] px-4 py-3"><div className="font-mono text-[10px] font-bold uppercase text-faint">Configured company brain</div><div className="mt-1 text-sm font-black">{tenant.companyName || profile?.companyName || "Not configured"}</div><div className="text-xs text-muted">{tenant.companyWebsite || profile?.companyWebsite || "Enter a public company website"}</div></div><p className="max-w-md text-sm leading-6 text-muted">Every seller node is sourced from the run’s external evidence and trace ledger.</p></div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3 text-xs font-semibold text-muted"><span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-win" /> Evidence and QA required</span><span className="inline-flex items-center gap-1"><RefreshCw className="h-3.5 w-3.5 text-win" /> {collection?.status === "collecting" ? "Discovering competitors and collecting evidence…" : "Live discovery and evidence collection enabled"}</span>{run ? <><span>Verified {formatDate(run.generatedAt)} · {unread} new signals</span>{run.discovery ? <span>You.com discovered {run.discovery.candidatePoolSize} candidates across {run.discovery.searchedQueries} searches</span> : null}</> : collection?.latestRunAt ? <span>Last published {formatDate(collection.latestRunAt)}</span> : null}</div>
      {error ? <p role="alert" className="border-t border-[#e3c1b7] bg-[#f7e9e5] px-5 py-3 text-sm font-semibold text-[#8a3226]">{error}</p> : null}
    </section>
    {run ? <>
      <div className="surface flex flex-wrap gap-1 p-2"><Tab active={view === "graph"} onClick={() => setView("graph")} icon={<Network className="h-4 w-4" />}>Signal graph</Tab><Tab active={view === "matrix"} onClick={() => setView("matrix")} icon={<Activity className="h-4 w-4" />}>Evidence matrix</Tab></div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_430px]">
        {view === "graph" ? <section className="surface overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4"><div><p className="font-mono text-[10px] font-bold uppercase text-faint">Signal graph</p><h2 className="font-display text-2xl font-semibold">What changed, by seller section</h2></div><span className="chip text-[#2c3a63]">{unread} new</span></div><div className="flex flex-wrap items-center gap-3 border-b border-line bg-[#fbfaf7] px-4 py-3 text-xs leading-5 text-muted"><span>Click <b>{run.companyName}</b> for its company-brain battlecard and market overview. Click any competitor to open its seller sections, then a numbered node to mark its source-backed signals as read.</span><span className="inline-flex items-center gap-1 rounded-full border border-[#d9dee7] bg-white px-2 py-0.5 font-semibold text-[#2c3a63]"><span className="grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 font-mono text-[9px] text-white">3</span> unread evidence</span></div><div className="h-[640px] bg-[#fbfaf7]"><ReactFlow nodes={graph.nodes} edges={graph.edges} fitView fitViewOptions={{ padding: 0.18 }} onNodeClick={(_, node) => { const data = node.data as { companyId?: boolean; competitorId?: string; contextId?: string }; if (data.contextId) selectContext(data.contextId); else if (data.competitorId) { setSelectedId(data.competitorId); setSelectedContextId(null); } else if (data.companyId) { setSelectedId(null); setSelectedContextId(null); } }}><Background color="#d9dee7" gap={18} /><Controls /></ReactFlow></div></section> : <EvidenceMatrix run={run} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setSelectedContextId(null); }} />}
        <SellerDetail competitor={selected} run={run} selectedContext={selectedContext} readSignals={readSignals} onSelectContext={selectContext} onClearContext={() => setSelectedContextId(null)} onSelectCompetitor={(id) => { setSelectedId(id); setSelectedContextId(null); }} />
      </div>
    </> : <section className="surface grid min-h-[280px] place-items-center p-8 text-center"><div className="max-w-lg"><Network className="mx-auto h-8 w-8 text-[#2c3a63]" /><h2 className="mt-3 font-display text-3xl font-semibold">No published intelligence yet</h2><p className="mt-3 text-sm leading-6 text-muted">Use the company analysis form above, or wait for the protected scheduled collection to publish verified external evidence.</p></div></section>}
    <AskIntelliaChat key={run?.id ?? "empty"} run={run} />
    </div>
  </div>;
}

function Tab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) { return <button onClick={onClick} className={`inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-bold ${active ? "bg-[#2c3a63] text-white" : "text-muted hover:bg-[#faf9f6]"}`}>{icon}{children}</button>; }
function SellerDetail({ competitor, run, selectedContext, readSignals, onSelectContext, onClearContext, onSelectCompetitor }: { competitor: ResearchCompetitor | null; run: ResearchRun; selectedContext: ResearchCompetitor["contextNodes"][number] | null; readSignals: Set<string>; onSelectContext: (id: string) => void; onClearContext: () => void; onSelectCompetitor: (id: string) => void }) {
  if (!competitor) return <CompanyBrainDetail run={run} onSelectCompetitor={onSelectCompetitor} />;
  return <aside className="surface overflow-hidden"><div className="border-b border-line p-5"><p className="font-mono text-[10px] font-bold uppercase text-faint">Seller battlecard</p><h2 className="mt-1 font-display text-2xl font-semibold">{competitor.name}</h2><p className="mt-2 text-sm leading-6 text-muted">{competitor.sellerPositioning}</p><div className="mt-3 flex flex-wrap gap-2"><span className="chip text-[#2c3a63]">{competitor.battlecard.evidenceCount} evidence items</span>{competitor.battlecard.qaScore !== undefined ? <span className="chip text-win">QA {formatQaScore(competitor.battlecard.qaScore)}/100</span> : null}</div></div><div className="flex flex-wrap gap-2 border-b border-line p-3"><button onClick={onClearContext} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${selectedContext ? "border-line text-muted" : "border-[#3d4e80] bg-[#e8ebf3] text-[#2c3a63]"}`}>Overview</button>{competitor.contextNodes.map((node) => { const unread = unreadFor(run.id, node.id, node.newSignals, readSignals); return <button key={node.id} onClick={() => onSelectContext(node.id)} className={`relative rounded-full border px-2.5 py-1.5 text-xs font-bold ${selectedContext?.id === node.id ? "border-[#3d4e80] bg-[#e8ebf3] text-[#2c3a63]" : "border-line text-muted hover:border-[#c4cbe0]"}`}>{node.title}{unread ? <span className="ml-1 rounded-full bg-accent px-1.5 py-0.5 font-mono text-[9px] text-white">{unread}</span> : null}</button>; })}</div><div id="seller-overview" className="space-y-4 p-5">{selectedContext ? <ContextDetail competitor={competitor} node={selectedContext} /> : <BattlecardOverview competitor={competitor} onSelectContext={onSelectContext} />}</div></aside>;
}

function formatQaScore(score: number) {
  return Math.round(score <= 1 ? score * 100 : score);
}
function CompanyBrainDetail({ run, onSelectCompetitor }: { run: ResearchRun; onSelectCompetitor: (id: string) => void }) {
  const sources = uniqueRunSources(run);
  const signals = run.competitors.reduce((total, competitor) => total + competitor.contextNodes.reduce((sum, node) => sum + (node.insightItems?.length ?? node.newSignals ?? 0), 0), 0);
  const discoveryQuestions = Array.from(new Set(run.competitors.flatMap((competitor) => competitor.battlecard.questionsToAsk))).slice(0, 5);
  return <aside className="surface overflow-hidden"><div className="border-b border-line p-5"><p className="font-mono text-[10px] font-bold uppercase text-faint">Company brain battlecard</p><h2 className="mt-1 font-display text-2xl font-semibold">{run.companyName}</h2><p className="mt-2 text-sm leading-6 text-muted">The focal seller context for this run—organized around the competitive evidence collected against the configured market set.</p><div className="mt-3 flex flex-wrap gap-2"><span className="chip text-[#2c3a63]">{run.competitors.length} competitors mapped</span><span className="chip text-win">{sources.length} unique sources</span><span className="chip text-[#2c3a63]">{signals} observed signals</span></div></div><div className="space-y-4 p-5"><DetailSection title="Executive snapshot" icon={<Sparkles className="h-4 w-4" />}><Bullet>Configured company: {run.companyWebsite}</Bullet><Bullet>This run compares {run.companyName} against {run.competitors.length} selected competitors using externally retrieved evidence.</Bullet><Bullet>Published {formatDate(run.generatedAt)}. Source quality, retrieval trace, and evidence caveats are available at the competitor and section level.</Bullet></DetailSection><DetailSection title="Competitive map" icon={<Network className="h-4 w-4" />}>{run.competitors.map((competitor) => <button key={competitor.id} onClick={() => onSelectCompetitor(competitor.id)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-white p-3 text-left text-sm hover:border-[#c4cbe0]"><span><b>{competitor.name}</b><span className="mt-1 block text-xs text-muted">{competitor.sellerPositioning}</span></span><span className="font-mono text-[10px] text-[#315d84]">Open brief →</span></button>)}</DetailSection><DetailSection title="Seller discovery moves" icon={<ListChecks className="h-4 w-4" />}>{discoveryQuestions.length ? discoveryQuestions.map((question) => <Bullet key={question}>{question}</Bullet>) : <Bullet>No evidence-backed discovery questions were extracted in this run.</Bullet>}</DetailSection><DetailSection title="Cross-market evidence" icon={<ExternalLink className="h-4 w-4" />}>{sources.slice(0, 8).map((source) => <a key={`${source.url}-${source.title}`} href={source.url} target="_blank" rel="noreferrer" className="block rounded-lg border border-line bg-[#fbfaf7] p-3 text-xs hover:border-[#c4cbe0]"><span className="font-mono font-bold text-[#2c3a63]">Tier {source.tier}</span><span className="mx-2 text-faint">/</span><span className="font-bold text-ink">{source.title}</span><span className="mt-1 block break-all text-faint">{source.url}</span></a>)}</DetailSection></div></aside>;
}
function BattlecardOverview({ competitor, onSelectContext }: { competitor: ResearchCompetitor; onSelectContext: (id: string) => void }) { return <><DetailSection title="Executive snapshot" icon={<Sparkles className="h-4 w-4" />}>{competitor.battlecard.snapshot.map((item) => <Bullet key={item}>{item}</Bullet>)}</DetailSection><DetailSection title="Likely objections and talk track" icon={<ListChecks className="h-4 w-4" />}>{competitor.battlecard.likelyObjections.slice(0, 3).map((item) => <div key={item.objection} className="rounded-lg border border-line bg-[#fbfaf7] p-3 text-sm"><p className="font-bold text-ink">Buyer may say: {item.objection}</p><p className="mt-2 text-muted">Reframe: {item.reframe}</p><p className="mt-2 rounded bg-[#e8ebf3] p-2 font-semibold text-[#2c3a63]">Say this: {item.sayThis}</p></div>)}</DetailSection><DetailSection title="Discovery questions" icon={<CheckCircle2 className="h-4 w-4" />}>{competitor.battlecard.questionsToAsk.map((question) => <Bullet key={question}>{question}</Bullet>)}</DetailSection><DetailSection title="Seller sections" icon={<Network className="h-4 w-4" />}>{competitor.contextNodes.map((node) => <button key={node.id} onClick={() => onSelectContext(node.id)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-white p-3 text-left text-sm hover:border-[#c4cbe0]"><span><b>{node.title}</b><span className="mt-1 block text-xs text-muted">{node.sellerImportance}</span></span><span className="font-mono text-[10px] text-faint">{node.sources?.length ?? 0} sources</span></button>)}</DetailSection></>; }
function ContextDetail({ competitor, node }: { competitor: ResearchCompetitor; node: ResearchCompetitor["contextNodes"][number] }) { return <><DetailSection title={node.title} icon={node.type === "pricing" ? <CircleDollarSign className="h-4 w-4" /> : <Activity className="h-4 w-4" />}><p className="text-xs leading-5 text-muted">{node.sellerImportance}</p>{node.insightItems?.length ? node.insightItems.slice(0, 4).map((item) => <div key={item.id} className="rounded-lg border border-line bg-[#fbfaf7] p-3"><p className="text-sm font-bold">{item.title}</p><p className="mt-1 text-xs leading-5 text-muted">{item.summary}</p><p className="mt-2 text-xs font-semibold text-[#2c3a63]">Seller move: {item.sellerImplication}</p></div>) : node.details.map((detail) => <Bullet key={detail}>{detail}</Bullet>)}</DetailSection>{node.sources?.length ? <DetailSection title="Sources" icon={<ExternalLink className="h-4 w-4" />}>{node.sources.slice(0, 6).map((source) => <a key={`${source.url}-${source.title}`} href={source.url} target="_blank" rel="noreferrer" className="block rounded-lg border border-line bg-white p-3 text-xs hover:border-[#c4cbe0]"><span className="font-mono font-bold text-[#2c3a63]">Tier {source.tier}</span><span className="mx-2 text-faint">/</span><span className="font-bold text-ink">{source.title}</span><span className="mt-1 block break-all text-faint">{source.url}</span></a>)}</DetailSection> : null}{node.trace?.length ? <DetailSection title="Trace / observability" icon={<Activity className="h-4 w-4" />}>{node.trace.map((entry, index) => <details key={`${entry.step}-${index}`} className="rounded-lg border border-line bg-[#fbfaf7] p-3" open><summary className="flex cursor-pointer items-center justify-between gap-3 text-xs font-bold"><span>{index + 1}. {entry.step}</span><span className="rounded-full border border-line bg-white px-2 py-0.5 font-mono text-[9px] uppercase text-faint">{entry.status.replace(/_/g, " ")}</span></summary><p className="mt-2 text-xs leading-5 text-muted">{entry.detail}</p><p className="mt-2 whitespace-pre-line rounded bg-white p-2 font-mono text-[10px] leading-4 text-faint">{entry.output ?? entry.input ?? "No additional output."}</p></details>)}</DetailSection> : null}{competitor.battlecard.sourceWarnings.length ? <DetailSection title="Evidence caveats" icon={<ShieldCheck className="h-4 w-4" />}>{competitor.battlecard.sourceWarnings.map((warning) => <Bullet key={warning}>{warning}</Bullet>)}</DetailSection> : null}</>; }
function DetailSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) { return <section><h3 className="mb-2 flex items-center gap-2 text-sm font-black text-ink">{icon}{title}</h3><div className="space-y-2">{children}</div></section>; }
function Bullet({ children }: { children: React.ReactNode }) { return <div className="flex gap-2 rounded-lg border border-line bg-[#fbfaf7] p-3 text-sm leading-5 text-ink"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-win" />{children}</div>; }
function EvidenceMatrix({ run, selectedId, onSelect }: { run: ResearchRun; selectedId: string | null; onSelect: (id: string | null) => void }) { const companySources = uniqueRunSources(run).filter((source) => source.sourceType === "company_site"); const marketSignals = run.competitors.reduce((total, competitor) => total + competitor.contextNodes.reduce((count, node) => count + (node.insightItems?.length ?? 0), 0), 0); return <section className="surface overflow-hidden"><div className="border-b border-line p-4"><p className="font-mono text-[10px] font-bold uppercase text-faint">Evidence matrix</p><h2 className="font-display text-2xl font-semibold">Evidence coverage vs. observed signal volume</h2><p className="mt-1 text-sm text-muted">The green marker is the focal-company brain; other markers are live-discovered competitors. This is not a competitive ranking.</p></div><div className="p-5"><div className="relative h-[610px] overflow-hidden rounded-lg border border-line bg-[#fbfaf7]"><div className="absolute inset-x-8 top-1/2 h-px bg-[#d8d5ca]" /><div className="absolute inset-y-8 left-1/2 w-px bg-[#d8d5ca]" /><span className="absolute bottom-4 left-1/2 -translate-x-1/2 font-mono text-[10px] font-bold uppercase text-faint">Evidence coverage</span><span className="absolute left-4 top-1/2 -translate-y-1/2 -rotate-90 font-mono text-[10px] font-bold uppercase text-faint">Observed signal volume</span><button onClick={() => onSelect(null)} style={{ left: `${Math.min(86, 18 + companySources.length * 9)}%`, top: `${100 - Math.min(86, 18 + Math.min(marketSignals, 12) * 5)}%` }} className="absolute grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[#76a696] bg-[#eaf1ef] text-xs font-black text-[#1d5a48] shadow-sm ring-2 ring-[#d7e8e1]">{initials(run.companyName)}<span className="absolute top-14 w-40 text-center text-[10px] font-bold text-ink">{run.companyName}<span className="block font-normal text-faint">Company brain · {companySources.length} direct sources</span></span></button>{run.competitors.map((competitor, index) => { const sources = uniqueCount(competitor.contextNodes.flatMap((node) => node.sources ?? [])); const signals = competitor.contextNodes.reduce((total, node) => total + (node.insightItems?.length ?? 0), 0); const x = Math.min(86, 18 + sources * 7 + (index % 2) * 3); const y = Math.min(86, 18 + signals * 12 + (index % 3) * 4); const selected = selectedId === competitor.id; return <button key={competitor.id} onClick={() => onSelect(competitor.id)} style={{ left: `${x}%`, top: `${100 - y}%` }} className={`absolute grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border text-xs font-black shadow-sm ${selected ? "border-[#1f3a5f] bg-[#1f3a5f] text-white ring-4 ring-[#e8ebf3]" : "border-[#c4cbe0] bg-white text-[#1f3a5f]"}`}>{initials(competitor.name)}<span className="absolute top-14 w-40 text-center text-[10px] font-bold text-ink">{competitor.name}<span className="block font-normal text-faint">{sources} sources · {signals} signals</span></span></button>; })}</div></div></section>; }
function graphFor(run: ResearchRun | null, selectedId: string | null, selectedContextId: string | null, readSignals: Set<string>) { if (!run) return { nodes: [] as Node[], edges: [] as Edge[] }; const selected = run.competitors.find((competitor) => competitor.id === selectedId) ?? null; if (selected) { const nodes: Node[] = [{ id: "company", position: { x: 40, y: 280 }, data: { label: graphLabel(run.companyName), companyId: true }, style: graphStyle(true, false) }, { id: selected.id, position: { x: 340, y: 280 }, data: { label: graphLabel(selected.name), competitorId: selected.id }, style: graphStyle(false, true) }]; const edges: Edge[] = [{ id: `company-${selected.id}`, source: "company", target: selected.id, style: { stroke: "#2c3a63", strokeWidth: 2 } }]; selected.contextNodes.forEach((context, index) => { const angle = -Math.PI / 2 + index * (Math.PI * 2 / selected.contextNodes.length); const unread = unreadFor(run.id, context.id, context.newSignals, readSignals); nodes.push({ id: context.id, position: { x: 650 + Math.cos(angle) * 210, y: 280 + Math.sin(angle) * 205 }, data: { label: graphLabel(context.title, unread), competitorId: selected.id, contextId: context.id }, style: graphStyle(false, selectedContextId === context.id) }); edges.push({ id: `${selected.id}-${context.id}`, source: selected.id, target: context.id, style: { stroke: selectedContextId === context.id ? "#b8893b" : "#cfd6df", strokeWidth: selectedContextId === context.id ? 2.4 : 1.2 } }); }); return { nodes, edges }; } const nodes: Node[] = [{ id: "company", position: { x: 370, y: 280 }, data: { label: graphLabel(run.companyName), companyId: true }, style: graphStyle(true, false) }]; const edges: Edge[] = []; run.competitors.forEach((competitor, index) => { const angle = -Math.PI / 2 + index * (Math.PI * 2 / run.competitors.length); nodes.push({ id: competitor.id, position: { x: 370 + Math.cos(angle) * 285, y: 280 + Math.sin(angle) * 210 }, data: { label: graphLabel(competitor.name), competitorId: competitor.id }, style: graphStyle(false, competitor.id === selectedId) }); edges.push({ id: `company-${competitor.id}`, source: "company", target: competitor.id, style: { stroke: competitor.id === selectedId ? "#2c3a63" : "#cfd6df", strokeWidth: competitor.id === selectedId ? 2.2 : 1.2 } }); }); return { nodes, edges }; }
function graphLabel(label: string, unread = 0) { return <span className="relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap pr-1">{label}{unread ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 font-mono text-[10px] font-black text-white shadow-[0_2px_7px_rgba(184,137,59,0.45)]">{unread}</span> : null}</span>; }
function graphStyle(company: boolean, selected: boolean) { return { border: `1px solid ${selected ? "#1f3a5f" : "#c4cbe0"}`, borderRadius: "10px", background: company ? "#eaf1ef" : selected ? "#1f3a5f" : "#ffffff", color: selected ? "#ffffff" : "#16213a", fontWeight: 800, padding: "12px 16px", minWidth: "130px", textAlign: "center" as const, boxShadow: "0 1px 3px rgba(22,33,58,.08)" }; }
function unreadFor(runId: string, contextId: string, count: number | undefined, readSignals: Set<string>) { return readSignals.has(`${runId}:${contextId}`) ? 0 : count ?? 0; }
function unreadCount(run: ResearchRun, readSignals: Set<string>) { return run.competitors.reduce((total, competitor) => total + competitor.contextNodes.reduce((sum, node) => sum + unreadFor(run.id, node.id, node.newSignals, readSignals), 0), 0); }
function uniqueCount(sources: Array<{ url: string }>) { return new Set(sources.map((source) => source.url)).size; }
function uniqueRunSources(run: ResearchRun) { const seen = new Set<string>(); return run.competitors.flatMap((competitor) => competitor.contextNodes.flatMap((node) => node.sources ?? [])).filter((source) => Boolean(source.url) && !seen.has(source.url) && (seen.add(source.url), true)); }
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function formatDate(value: string) { return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function publicRunError(error: string | undefined, retryAfterMinutes?: number, maxRunsPerHour?: number) {
  if (error === "research_already_running") return "Another evidence collection is running. Watch the status above, then try again.";
  if (error === "public_run_rate_limited") return `Anonymous analysis is limited to ${maxRunsPerHour ?? 2} runs per hour. Try again in about ${retryAfterMinutes ?? 60} minutes.`;
  if (error === "invalid_public_website") return "Enter a public HTTPS company website (for example, https://company.com).";
  if (error === "live_research_not_configured") return "Live research is not fully configured. Check the production readiness status and provider variables.";
  if (error === "live_coverage_incomplete") return "The analysis did not meet the source, regional, QA, or persistence quality gate, so nothing was shown as seller-ready. Try again later or use a company with more public evidence.";
  if (error === "competitor_discovery_failed") return "Intellia could not verify enough direct competitors from live public search for this company. Check the company name and website, then try again.";
  if (error === "research_provider_throttled") return "A live research provider is temporarily throttling collection. Intellia will retry safely; please run again in a few minutes.";
  return "The live analysis could not complete. Try again shortly.";
}
