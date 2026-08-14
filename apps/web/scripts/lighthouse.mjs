import lighthouse from "lighthouse";
import { launch } from "chrome-launcher";
import { chromium } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import proof from "../content/recruiter-proof.json" with { type: "json" };

const url =
  process.env.LIGHTHOUSE_URL ??
  (process.env.DEMO_BASE_URL
    ? `${process.env.DEMO_BASE_URL.replace(/\/$/, "")}/recruiter`
    : "http://localhost:3010/recruiter");
const profileRoot = process.platform === "win32" ? tmpdir() : "/tmp";
const userDataDir = await mkdtemp(join(profileRoot, "pulse-lighthouse-"));
const chrome = await launch({
  chromePath: chromium.executablePath(),
  chromeFlags: ["--headless", "--no-sandbox"],
  userDataDir,
});
try {
  const result = await lighthouse(url, {
    port: chrome.port,
    onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
    output: "json",
    logLevel: "error",
  });
  if (!result?.lhr) throw new Error("Lighthouse returned no report");
  const scores = {
    performance: Math.round((result.lhr.categories.performance?.score ?? 0) * 100),
    accessibility: Math.round((result.lhr.categories.accessibility?.score ?? 0) * 100),
    bestPractices: Math.round((result.lhr.categories["best-practices"]?.score ?? 0) * 100),
    seo: Math.round((result.lhr.categories.seo?.score ?? 0) * 100),
  };
  const report = { url, capturedAt: new Date().toISOString(), scores };
  const outputDirectory = resolve(import.meta.dirname, "../artifacts");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    resolve(outputDirectory, "lighthouse.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));

  const budgets = proof.quality.lighthouseBudgets;
  const misses = Object.entries(budgets).filter(
    ([category, minimum]) => scores[category] < minimum,
  );
  if (misses.length > 0) {
    for (const [category, minimum] of misses) {
      console.error(`${category}: ${scores[category]} is below the ${minimum} budget`);
    }
    process.exitCode = 1;
  }
} finally {
  await chrome.kill();
  await rm(userDataDir, { recursive: true, force: true });
}
