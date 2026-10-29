"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, FlaskConical, History, LayoutDashboard, Route, Settings, Swords } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/benchmarks/new", label: "New benchmark", icon: FlaskConical },
  { href: "/benchmarks", label: "History", icon: History },
  { href: "/leaderboard", label: "Leaderboard", icon: BarChart3 },
  { href: "/router", label: "Smart router", icon: Route },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ mode }: { mode: "DEMO" | "LIVE" }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : href === "/benchmarks" ? pathname === "/benchmarks" || /^\/benchmarks\/(?!new)/.test(pathname) : pathname.startsWith(href);

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-ink-800 bg-ink-950/70 px-3 py-5 backdrop-blur md:flex">
      <Link href="/" className="mb-8 flex items-center gap-2.5 px-2">
        <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-violet to-electric-deep shadow-[0_0_24px_-4px_rgb(139_92_246/0.7)]">
          <Swords className="size-4 text-white" aria-hidden />
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-semibold tracking-tight">AgentArena</span>
          <span className="block text-[10px] uppercase tracking-[0.18em] text-ink-400">for HarnessRouter</span>
        </span>
      </Link>
      <nav aria-label="Main" className="flex flex-col gap-0.5">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors",
              isActive(href) ? "bg-ink-800 text-ink-100 ring-1 ring-ink-700" : "text-ink-400 hover:bg-ink-900 hover:text-ink-200",
            )}
          >
            <Icon className={cn("size-4", isActive(href) ? "text-violet-soft" : "text-ink-500 group-hover:text-ink-300")} aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto rounded-lg border border-ink-800 bg-ink-900 p-3 text-[11px] leading-relaxed text-ink-400">
        <p className="mb-1 font-medium text-ink-300">{mode === "DEMO" ? "Demo mode" : "Live mode"}</p>
        {mode === "DEMO"
          ? "Agents are simulated. Code evaluation runs for real in the Docker sandbox."
          : "Benchmarks execute through HarnessRouter and may incur cost."}
      </div>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="scrollbar-thin flex gap-1 overflow-x-auto border-b border-ink-800 px-3 py-2 md:hidden">
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn("flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs", pathname === href ? "bg-ink-800 text-ink-100" : "text-ink-400")}
        >
          <Icon className="size-3.5" aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );
}
