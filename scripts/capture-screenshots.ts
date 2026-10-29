/**
 * Captures README screenshots from a running local instance (npm run dev).
 * Usage: npx tsx scripts/capture-screenshots.ts [benchmarkId]
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:3100";

async function main() {
  mkdirSync("docs/screenshots", { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const shots: Array<[string, string]> = [
    ["/", "dashboard"],
    ["/benchmarks/new", "new-benchmark"],
    ["/leaderboard", "leaderboard"],
    ["/settings", "settings"],
  ];
  const benchmarkId = process.argv[2];
  if (benchmarkId) shots.push([`/benchmarks/${benchmarkId}`, "arena-results"]);
  for (const [path, name] of shots) {
    await page.goto(`${BASE}${path}`, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: name === "arena-results" });
    console.log(`saved docs/screenshots/${name}.png`);
  }
  await page.goto(`${BASE}/router`, { waitUntil: "load" });
  await page.getByRole("button", { name: "Recommend an agent" }).click();
  await page.getByText("Task classification").waitFor();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "docs/screenshots/smart-router.png" });
  console.log("saved docs/screenshots/smart-router.png");
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
