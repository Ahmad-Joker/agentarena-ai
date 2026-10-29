import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { FlaskConical, Radio } from "lucide-react";
import { MobileNav, Sidebar } from "@/components/shell/sidebar";
import { getEnv } from "@/lib/env";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "AgentArena AI", template: "%s · AgentArena AI" },
  description: "Benchmark coding agents through HarnessRouter, evaluate them objectively and route tasks on evidence.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const mode = getEnv().AGENTARENA_MODE;
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-ink-800 focus:px-3 focus:py-2">
          Skip to content
        </a>
        <div className="flex">
          <Sidebar mode={mode} />
          <div className="min-w-0 flex-1">
            {mode === "DEMO" ? (
              <div className="flex items-center justify-center gap-2 border-b border-warning/20 bg-warning/[0.06] px-4 py-1.5 text-center text-[11px] font-medium tracking-wide text-warning" role="status">
                <FlaskConical className="size-3.5" aria-hidden />
                DEMO MODE · agents and their timings/costs are SIMULATED · solution evaluation runs for real
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 border-b border-success/20 bg-success/[0.06] px-4 py-1.5 text-[11px] font-medium tracking-wide text-success" role="status">
                <Radio className="size-3.5" aria-hidden />
                LIVE MODE · benchmarks execute through HarnessRouter and may be billed
              </div>
            )}
            <MobileNav />
            <main id="main" className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
