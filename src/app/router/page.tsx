import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { SmartRouter } from "@/components/router/smart-router";
import { getEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Smart router" };

export default function RouterPage() {
  return (
    <>
      <PageHeader
        eyebrow="Routing"
        title="Smart router"
        description="Describe a task and pick what matters. The router classifies it with transparent keyword rules and recommends an agent only when past benchmarks provide enough evidence."
      />
      <SmartRouter mode={getEnv().AGENTARENA_MODE} />
    </>
  );
}
