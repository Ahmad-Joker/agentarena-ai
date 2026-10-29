import { redactString } from "@/lib/security/redact";

/**
 * Normalized HarnessRouter error. Mirrors the documented envelope
 * `{ error: { type, code, message, param?, detail? } }` (docs/errors-and-idempotency).
 * Branch on `code`, never on `message`.
 */
export class HarnessRouterError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly type: string,
    readonly code: string,
    message: string,
    readonly param?: string,
  ) {
    super(message);
    this.name = "HarnessRouterError";
  }

  /** Safe to retry the *same* request (same Idempotency-Key) after a backoff. */
  get retryable(): boolean {
    return this.httpStatus === 429 || this.httpStatus === 503 || this.httpStatus === 504 || this.code === "network_error";
  }

  /** The work may already have run: recover by polling, never resubmit (docs: 502 store_write_failed). */
  get requiresRecovery(): boolean {
    return this.code === "store_write_failed";
  }
}

const FALLBACK_CODES: Record<number, [string, string]> = {
  400: ["invalid_request_error", "invalid_input"],
  401: ["authentication_error", "invalid_credential"],
  402: ["billing_error", "payment_required"],
  403: ["permission_error", "insufficient_scope"],
  404: ["invalid_request_error", "not_found"],
  409: ["invalid_request_error", "conflict"],
  413: ["invalid_request_error", "file_too_large"],
  422: ["invalid_request_error", "invalid_request"],
  429: ["rate_limit_error", "rate_limited"],
  500: ["server_error", "internal_error"],
  502: ["server_error", "upstream_error"],
  503: ["server_error", "unavailable"],
  504: ["server_error", "timeout"],
};

export async function errorFromResponse(res: Response, secrets: readonly string[] = []): Promise<HarnessRouterError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const envelope =
    body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object"
      ? (body.error as Record<string, unknown>)
      : undefined;
  const [fallbackType, fallbackCode] = FALLBACK_CODES[res.status] ?? ["server_error", "unexpected_status"];
  const message = typeof envelope?.message === "string" ? envelope.message : `HarnessRouter returned HTTP ${res.status}`;
  return new HarnessRouterError(
    res.status,
    typeof envelope?.type === "string" ? envelope.type : fallbackType,
    typeof envelope?.code === "string" ? envelope.code : fallbackCode,
    redactString(message.slice(0, 500), secrets),
    typeof envelope?.param === "string" ? envelope.param : undefined,
  );
}

/** Human-facing explanation for the UI. Does not leak raw upstream bodies. */
export function describeError(err: HarnessRouterError): string {
  switch (err.code) {
    case "invalid_credential":
      return "HarnessRouter rejected the API key. Check HR_API_KEY on the server.";
    case "payment_required":
      return "HarnessRouter refused the task for lack of credit.";
    case "insufficient_scope":
      return "The API key does not have permission for this operation.";
    case "harness_not_found":
    case "not_found":
      return "The configured agent (harness id) was not found in this workspace.";
    case "rate_limited":
      return "Rate limited by HarnessRouter. Try again shortly or lower concurrency.";
    case "unsupported_protocol_version":
      return "The server does not support the UHP version this client sent.";
    default:
      return `HarnessRouter error (${err.code}).`;
  }
}
