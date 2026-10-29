import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { redactDeep, redactString } from "@/lib/security/redact";
import { assertSafeId, buildProviderUrl, validateBaseUrl } from "@/lib/security/url-guard";
import { isAllowedHost, isSameOriginMutation } from "@/lib/security/request-guard";

describe("redaction", () => {
  it("removes bearer tokens, key patterns and known secrets", () => {
    const s = redactString("Authorization: Bearer abcdefghijklmnop and sk-abcdefghijklmnopqrstu and api_key=supersecretvalue and mysecret123", ["mysecret123"]);
    expect(s).not.toMatch(/abcdefghijklmnop|sk-abcdefghijklmnopqrstu|supersecretvalue|mysecret123/);
    expect(s).toContain("api_key=[REDACTED]");
  });

  it("masks sensitive keys deeply, including download_url", () => {
    const out = redactDeep({ headers: { Authorization: "Bearer x" }, nested: [{ token: "t", download_url: "https://x" }], ok: "fine" });
    expect(out).toEqual({ headers: { Authorization: "[REDACTED]" }, nested: [{ token: "[REDACTED]", download_url: "[REDACTED]" }], ok: "fine" });
  });
});

describe("SSRF guard", () => {
  it("requires https except for loopback", () => {
    expect(() => validateBaseUrl("http://169.254.169.254")).toThrow();
    expect(() => validateBaseUrl("ftp://x.example")).toThrow();
    expect(() => validateBaseUrl("https://api.harnessrouter.ai?x=1")).toThrow();
    expect(validateBaseUrl("http://127.0.0.1:3000/api/harness").pathname).toBe("/api/harness");
  });

  it("keeps requests on the configured origin and prefix", () => {
    const base = validateBaseUrl("https://api.example.com/prefix");
    expect(buildProviderUrl(base, "/v1/x").toString()).toBe("https://api.example.com/prefix/v1/x");
    expect(() => buildProviderUrl(base, "//evil.com/x")).toThrow();
    expect(() => buildProviderUrl(base, "/v1/../../admin")).toThrow();
    expect(() => buildProviderUrl(base, "v1/x")).toThrow();
  });

  it("validates provider-supplied ids", () => {
    expect(assertSafeId("resp_abc-123", "id")).toBe("resp_abc-123");
    for (const bad of ["../x", "a/b", "", "x?y", 42]) expect(() => assertSafeId(bad, "id")).toThrow();
  });
});

describe("local-only request guard", () => {
  it("accepts only loopback hosts (DNS rebinding protection)", () => {
    expect(isAllowedHost("127.0.0.1:3100")).toBe(true);
    expect(isAllowedHost("localhost:3100")).toBe(true);
    expect(isAllowedHost("[::1]:3100")).toBe(true);
    expect(isAllowedHost("evil.com")).toBe(false);
    expect(isAllowedHost("localhost.evil.com")).toBe(false);
    expect(isAllowedHost(null)).toBe(false);
  });

  it("blocks cross-origin mutations (CSRF)", () => {
    expect(isSameOriginMutation("GET", null, "127.0.0.1:3100")).toBe(true);
    expect(isSameOriginMutation("POST", "http://127.0.0.1:3100", "127.0.0.1:3100")).toBe(true);
    expect(isSameOriginMutation("POST", "https://evil.com", "127.0.0.1:3100")).toBe(false);
    expect(isSameOriginMutation("POST", null, "127.0.0.1:3100")).toBe(false);
  });
});

describe("secret exposure", () => {
  const root = join(__dirname, "..", "..", "src");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) files.push(p);
    }
  };
  walk(root);

  it("client components never read server secrets", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!src.startsWith('"use client"')) continue;
      expect(src, f).not.toMatch(/process\.env|["']@\/lib\/(env|db|runtime|api)["']/);
    }
  });

  it("the browser DTO omits provider identifiers and idempotency keys", () => {
    const dto = readFileSync(join(root, "lib", "services", "dto.ts"), "utf8");
    expect(dto).not.toMatch(/idempotencyKey|externalResponseId|externalSessionId|harnessId:/);
  });

  it("no NEXT_PUBLIC_ variables carry secrets", () => {
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(KEY|SECRET|TOKEN)/);
  });
});

