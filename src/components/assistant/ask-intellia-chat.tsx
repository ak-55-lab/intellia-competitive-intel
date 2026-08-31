"use client";

import { Loader2, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ResearchRun } from "@/types/research";

type Citation = { title: string; url: string; tier: string };
type ChatMessage = { role: "user" | "assistant"; text: string; citations?: Citation[] };

export function AskIntelliaChat({ run }: { run: ResearchRun | null }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "assistant", text: "Ask about a competitor, current public signals, positioning, objections, or the evidence behind a recommendation." }]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  async function ask() {
    const next = question.trim();
    if (!next || loading) return;
    setQuestion(""); setMessages((current) => [...current, { role: "user", text: next }]); setLoading(true);
    try {
      const response = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: next, run }) });
      const payload = await response.json() as { answer?: string; citations?: Citation[]; error?: string };
      if (!response.ok) throw new Error(payload.error === "assistant_rate_limited" ? "Ask Intellia is limited to 10 questions per hour." : payload.error ?? "Answer service unavailable");
      setMessages((current) => [...current, { role: "assistant", text: payload.answer ?? "No answer was returned.", citations: payload.citations }]);
    } catch (error) {
      setMessages((current) => [...current, { role: "assistant", text: error instanceof Error ? `I could not answer that yet: ${error.message}` : "I could not answer that yet." }]);
    } finally { setLoading(false); }
  }

  if (!open) return <button type="button" onClick={() => setOpen(true)} className="fixed bottom-4 left-4 z-[70] grid h-12 w-12 place-items-center rounded-full border border-[#31506d] bg-[#1f3a5f] text-white shadow-[0_12px_32px_rgba(22,33,58,0.24)]" aria-label="Open Ask Intellia"><MessageCircle className="h-5 w-5" /></button>;
  return <section className="fixed bottom-4 left-4 z-[70] flex max-h-[min(620px,calc(100vh-2rem))] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-[#d9dee7] bg-white shadow-[0_20px_60px_rgba(22,33,58,0.22)] sm:w-[410px]" role="dialog" aria-label="Ask Intellia assistant">
    <header className="flex items-center justify-between gap-3 bg-[#1f3a5f] px-4 py-3 text-white"><div className="flex items-center gap-2"><Sparkles className="h-4 w-4" /><div><h2 className="text-sm font-black">Ask Intellia</h2><p className="text-[10px] text-[#c7d2df]">External source-grounded answers</p></div></div><button onClick={() => setOpen(false)} aria-label="Close Ask Intellia" className="rounded p-1 hover:bg-white/10"><X className="h-4 w-4" /></button></header>
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#f7f8fa] p-4" aria-live="polite">{messages.map((message, index) => <div key={`${message.role}-${index}`} className={`rounded-lg border px-3 py-2.5 text-sm leading-6 ${message.role === "user" ? "ml-auto max-w-[88%] border-[#c4cbe0] bg-[#e8ebf3] text-[#1f3a5f]" : "max-w-[96%] border-line bg-white text-muted"}`}><FormattedAnswer text={message.text} />{message.citations?.length ? <div className="mt-2 space-y-1 border-t border-line pt-2">{message.citations.map((citation) => <a key={citation.url} href={citation.url} target="_blank" rel="noreferrer" className="block text-xs font-semibold text-[#315d84] underline">Tier {citation.tier} · {citation.title}</a>)}</div> : null}</div>)}{loading ? <div className="flex w-fit items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-xs text-faint"><Loader2 className="h-3.5 w-3.5 animate-spin" />Checking the external intelligence ledger</div> : null}</div>
    <form onSubmit={(event) => { event.preventDefault(); void ask(); }} className="flex gap-2 border-t border-line p-3"><input ref={inputRef} value={question} onChange={(event) => setQuestion(event.target.value)} className="field" placeholder="Ask about a competitor..." aria-label="Ask Intellia question" disabled={loading} /><button disabled={loading || !question.trim()} className="grid h-11 w-11 place-items-center rounded-lg bg-accent text-white disabled:opacity-50" aria-label="Send"><Send className="h-4 w-4" /></button></form>
  </section>;
}

function FormattedAnswer({ text }: { text: string }) { return <>{text.split(/\n{2,}/).map((paragraph, index) => <p key={index} className="mb-2 last:mb-0">{paragraph.replace(/^#{1,3}\s*/, "")}</p>)}</>; }
