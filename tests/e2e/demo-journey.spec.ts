import { expect, test } from "@playwright/test";

test.describe("demo mode journey", () => {
  test("dashboard is clearly labelled as simulated", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("status").filter({ hasText: "DEMO MODE" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Agent benchmarking dashboard" })).toBeVisible();
  });

  test("create a benchmark, watch the arena and read evidence-based results", async ({ page }) => {
    await page.goto("/benchmarks/new");
    await page.getByRole("radio", { name: /Implement a URL slug generator/ }).click();
    await expect(page.getByLabel("Solution file")).toHaveValue("slugify.ts");
    await page.getByRole("button", { name: /Launch benchmark \(3 agents\)/ }).click();

    await page.waitForURL(/\/benchmarks\/c[a-z0-9]+$/);
    await expect(page.getByRole("heading", { name: "Implement a URL slug generator" })).toBeVisible();
    await expect(page.getByRole("article", { name: /Sim · Careful Tester run/ })).toBeVisible();

    // Genuine terminal states from the simulated agents.
    await expect(page.getByText("Recommended for this task")).toBeVisible({ timeout: 60_000 });
    const erratic = page.getByRole("article", { name: /Sim · Erratic Explorer run/ });
    await expect(erratic.getByLabel("Status: Failed")).toBeVisible();
    await expect(erratic.getByText("upstream_error", { exact: true })).toBeVisible();

    // Careful Tester strips diacritics; Swift Drafter does not.
    await expect(page.getByText(/Passed 7 of 7 tests/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Scoring formula" })).toBeVisible();
    await expect(page.getByText(/Fairness audit/)).toBeVisible();
  });

  test("cancel a running benchmark", async ({ page }) => {
    // Warm the cancel route so a cold dev-server compile cannot delay the click past the runs.
    await page.request.post("/api/benchmarks/cwarmupwarmupwarmupwarmup0/cancel", { headers: { Origin: "http://127.0.0.1:3100" } });
    await page.goto("/benchmarks/new");
    await page.getByRole("radio", { name: /Merge overlapping intervals/ }).click();
    await page.getByRole("button", { name: /Launch benchmark/ }).click();
    await page.waitForURL(/\/benchmarks\/c[a-z0-9]+$/);
    // Polled events only render after hydration, so the button's handler is attached.
    await expect(page.getByText("Task accepted by provider").first()).toBeVisible();
    await page.getByRole("button", { name: "Cancel all runs" }).click();
    await expect(page.getByLabel("Status: Cancelled").first()).toBeVisible();
    await expect(page.getByText("Recommended for this task")).toHaveCount(0);
  });

  test("invalid task input is rejected with a clear message", async ({ page }) => {
    await page.goto("/benchmarks/new");
    await page.getByRole("radio", { name: /Custom task/ }).click();
    await page.getByLabel("Title").fill("Broken");
    await page.getByRole("button", { name: /Launch benchmark/ }).click();
    await expect(page.getByRole("alert").filter({ hasText: /description/i })).toBeVisible();
  });

  test("smart router explains its recommendation or declines", async ({ page }) => {
    await page.goto("/router");
    await page.getByRole("button", { name: "Recommend an agent" }).click();
    await expect(page.getByText("Task classification")).toBeVisible();
    await expect(page.getByText(/Recommended agent|Insufficient benchmark evidence/).first()).toBeVisible();
  });

  test("history and leaderboard render persisted data", async ({ page }) => {
    await page.goto("/benchmarks");
    await expect(page.getByRole("heading", { name: "Benchmark history" })).toBeVisible();
    await expect(page.getByRole("row").nth(1)).toBeVisible();
    await page.goto("/leaderboard");
    await expect(page.getByRole("heading", { name: "Ranking" })).toBeVisible();
  });

  test("API rejects cross-origin writes and non-loopback hosts", async ({ request }) => {
    const cross = await request.post("/api/benchmarks", { headers: { Origin: "https://evil.example" }, data: {} });
    expect(cross.status()).toBe(403);
    const rebinding = await request.get("/api/status", { headers: { Host: "evil.example" } });
    expect(rebinding.status()).toBe(421);
  });

  test("settings never render the API key value", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText(/Workspace API key/)).toBeVisible();
    const html = await page.content();
    expect(html).not.toMatch(/hr_[A-Za-z0-9]{12,}|Bearer /);
  });
});
