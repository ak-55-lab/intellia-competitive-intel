"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  GitBranch,
  ShieldCheck
} from "lucide-react";

const nav = [
  { href: "/research", label: "Live Intelligence", icon: GitBranch }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-paper text-ink lg:grid lg:grid-cols-[244px_minmax(0,1fr)]">
      <aside className="sticky top-0 z-40 flex gap-2 overflow-x-auto border-r border-[#25344c] bg-nav px-3 py-3 text-white lg:h-screen lg:flex-col lg:overflow-y-auto lg:px-4 lg:py-5">
        <Link href="/research" className="mr-2 flex shrink-0 items-center gap-3 rounded-lg px-2 lg:mb-6 lg:mr-0">
          <span className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 bg-white/10 font-display text-xl font-semibold">I</span>
          <span className="hidden min-w-0 lg:block">
            <span className="block text-sm font-black tracking-normal">Intellia</span>
            <span className="block text-[10px] font-semibold uppercase text-[#9aa3b2]">Competitive Intelligence</span>
          </span>
        </Link>

        <nav className="flex gap-1 lg:flex-col">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`));
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                className={`flex h-10 shrink-0 items-center justify-center gap-3 rounded-lg px-3 text-sm font-medium transition lg:justify-start ${
                  active ? "bg-white text-[#142033] shadow-sm" : "text-[#c7c9d1] hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden lg:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="hidden rounded-lg border border-white/10 bg-white/[0.04] p-3 text-[11px] leading-5 text-[#b7bfce] lg:mt-auto lg:block">
          <b className="mb-2 flex items-center gap-2 text-xs text-white"><ShieldCheck className="h-3.5 w-3.5 text-[#8ec3a8]" /> Evidence-first</b>
          Every recommendation should resolve to a source, retrieval log, or field-intel caveat.
        </div>
      </aside>

      <main className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-white/90 px-4 py-3 backdrop-blur lg:px-7">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase text-faint">External Intelligence Workbench</p>
            <p className="text-sm font-semibold text-muted">Company in, evidence-backed seller context out.</p>
          </div>
          <span className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-bold text-muted shadow-sm">Public workspace</span>
        </header>
        <div className="mx-auto max-w-[1360px] px-4 py-6 lg:px-7">{children}</div>
      </main>
    </div>
  );
}
