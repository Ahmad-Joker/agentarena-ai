import { hashTask } from "@/lib/agents/prompt";
import { DEMO_TASKS } from "@/lib/fixtures/demo-tasks";
import { taskInputSchema } from "@/lib/domain/schemas";

let byHash: Map<string, string> | undefined;

/** Identifies built-in demo tasks by content hash (simulated agents only have solutions for these). */
export function fixtureKeyForHash(contentHash: string): string | undefined {
  byHash ??= new Map(DEMO_TASKS.map((f) => [hashTask(taskInputSchema.parse(f.task)), f.key]));
  return byHash.get(contentHash);
}
