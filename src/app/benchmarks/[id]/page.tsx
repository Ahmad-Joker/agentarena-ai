import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getBenchmarkDetail } from "@/lib/services/queries";
import { toBenchmarkDto } from "@/lib/services/dto";
import { BenchmarkView } from "@/components/benchmark/benchmark-view";
import { ID_PATTERN } from "@/lib/api";

export const metadata: Metadata = { title: "Arena" };

export default async function BenchmarkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID_PATTERN.test(id)) notFound();
  const detail = await getBenchmarkDetail(prisma, id);
  if (!detail) notFound();
  return <BenchmarkView initial={toBenchmarkDto(detail)} />;
}
