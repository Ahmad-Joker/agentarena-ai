/**
 * Types for the parts of the HarnessRouter / UHP contract this app relies on.
 * Every field below is documented in the sources listed in docs/HARNESSROUTER_RESEARCH.md.
 * Parsing is deliberately tolerant: unknown fields are ignored, missing optional fields stay undefined.
 */
import { z } from "zod";

export const harnessSummarySchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    base: z.string().optional(),
    // Harness objects in responses use camelCase (documented in the skill api-reference).
    defaultModel: z.string().nullish(),
  })
  .passthrough();
export type HarnessSummary = z.infer<typeof harnessSummarySchema>;

export const harnessListSchema = z.object({ harnesses: z.array(harnessSummarySchema) }).passthrough();

export const uhpDiscoverySchema = z
  .object({
    versions: z.array(z.string()).optional(),
    default_version: z.string().optional(),
    version_to_send: z.string().optional(),
  })
  .passthrough();

export const usageSchema = z
  .object({
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
    cache_read_tokens: z.number().optional(),
  })
  .passthrough();
export type ProviderUsage = z.infer<typeof usageSchema>;

const outputContentSchema = z.object({ type: z.string(), text: z.string().optional() }).passthrough();
const outputItemSchema = z
  .object({
    type: z.string(),
    id: z.string().optional(),
    role: z.string().optional(),
    name: z.string().optional(),
    content: z.array(outputContentSchema).optional(),
  })
  .passthrough();

export const RESPONSE_STATUSES = ["in_progress", "completed", "incomplete", "failed", "cancelled"] as const;

export const responseObjectSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    model: z.string().nullish(),
    output: z.array(outputItemSchema).default([]),
    usage: usageSchema.nullish(),
    error: z.object({ code: z.string().optional(), message: z.string().optional() }).passthrough().nullish(),
    incomplete_details: z.object({ reason: z.string().optional() }).passthrough().nullish(),
    metadata: z.object({ session_id: z.string().optional() }).passthrough().nullish(),
  })
  .passthrough();
export type ResponseObject = z.infer<typeof responseObjectSchema>;

/** GET /v1/sessions/{id}: `spend_usd` and `created_at` arrive as strings (documented quirk). */
export const sessionSchema = z
  .object({
    id: z.string().optional(),
    session_id: z.string().optional(),
    status: z.string().optional(),
    turn_status: z.string().nullish(),
    spend_usd: z.union([z.string(), z.number()]).nullish(),
    max_cost_usd: z.union([z.string(), z.number()]).nullish(),
    model: z.string().nullish(),
    usage: usageSchema.nullish(),
    last_response_id: z.string().nullish(),
  })
  .passthrough();
export type SessionObject = z.infer<typeof sessionSchema>;

export const sessionFileSchema = z
  .object({
    id: z.string().optional(),
    file_id: z.string().optional(),
    container_id: z.string().optional(),
    filename: z.string().optional(),
    path: z.string().optional(),
    bytes: z.number().optional(),
    media_type: z.string().optional(),
    changed: z.boolean().optional(),
    produced: z.boolean().optional(),
  })
  .passthrough();
export const sessionFilesSchema = z
  .object({ session_id: z.string().optional(), count: z.number().optional(), files: z.array(sessionFileSchema) })
  .passthrough();
export type SessionFile = z.infer<typeof sessionFileSchema>;

export const uploadedFileSchema = z.object({ id: z.string(), filename: z.string().optional() }).passthrough();

/** Input content blocks (docs/upload-files). */
export type InputContent = { type: "input_text"; text: string } | { type: "input_file"; file_id: string };

/** Normalized stream events consumed by the orchestrator, independent of provider wire format. */
export type AgentStreamEvent =
  | { kind: "created"; responseId: string; sessionId?: string; raw: string }
  | { kind: "progress"; message: string; raw: string }
  | { kind: "tool"; name: string; raw: string }
  | { kind: "text_delta"; delta: string; raw: string }
  | {
      kind: "terminal";
      status: "completed" | "incomplete" | "failed" | "cancelled";
      response?: ResponseObject;
      reason?: string;
      raw: string;
    };
