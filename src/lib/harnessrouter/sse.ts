/**
 * Parser for HarnessRouter's data-only SSE stream.
 * Documented: frames carry no `event:` line; the event name is the JSON `type` field,
 * and every frame has a `sequence_number` (docs/streaming-events).
 */
export interface RawStreamEvent {
  type: string;
  sequence_number?: number;
  [key: string]: unknown;
}

export class SseParser {
  private buffer = "";

  /** Feed a decoded text chunk; returns every complete event parsed so far. */
  push(chunk: string): RawStreamEvent[] {
    // Normalise over the whole buffer: a CRLF pair may be split across two network chunks.
    this.buffer = (this.buffer + chunk).replace(/\r\n/g, "\n");
    const events: RawStreamEvent[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n\n")) !== -1) {
      const frame = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const parsed = parseFrame(frame);
      if (parsed) events.push(parsed);
    }
    return events;
  }

  /** Flush a trailing frame that was not terminated by a blank line. */
  end(): RawStreamEvent[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    const parsed = rest ? parseFrame(rest) : undefined;
    return parsed ? [parsed] : [];
  }
}

function parseFrame(frame: string): RawStreamEvent | undefined {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n");
  if (!data || data === "[DONE]") return undefined;
  try {
    const value: unknown = JSON.parse(data);
    if (value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string") {
      return value as RawStreamEvent;
    }
  } catch {
    // Malformed frames are dropped; the stream's terminal event or polling decides the outcome.
  }
  return undefined;
}

export async function* readSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<RawStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of parser.push(decoder.decode(value, { stream: true }))) yield ev;
    }
    for (const ev of parser.push(decoder.decode())) yield ev;
    for (const ev of parser.end()) yield ev;
  } finally {
    reader.releaseLock();
  }
}
