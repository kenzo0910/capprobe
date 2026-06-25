#!/usr/bin/env node
"use strict";

/**
 * probe.js — CLI: run a one-shot conformance probe against a live CAP agent.
 *
 *   npx capprobe <targetServiceId>
 *   npm run probe -- <targetServiceId>
 *
 * Acts as a requester directly (no payment to the CAPProbe provider), so a
 * developer can audit their own agent from the terminal. Requires live config
 * (CROO_API_KEY only — the agent AA wallet is managed server-side; no private
 * key needed at runtime) because it transacts against a real target.
 * Exit code 0 if the target scores >= MIN_SCORE (default 60), else 1 — handy in CI.
 */

const { loadConfig, createAgent, runProbe } = require("../src/core");
const { Logger } = require("../src/logger");

async function main() {
  const target = process.argv[2] || process.env.TARGET_SERVICE_ID;
  if (!target) {
    console.error(
      "usage: npm run probe -- <targetServiceId>   (or set TARGET_SERVICE_ID)",
    );
    console.error(
      "Runs a direct CAP conformance probe against the target agent.",
    );
    process.exit(2);
  }

  const cfg = loadConfig({});
  const log = new Logger("capprobe-cli", cfg.logLevel);
  const agent = createAgent(cfg, { name: "capprobe-cli" });
  await agent.connect();

  log.info("probing target", { target, mode: cfg.mode });
  const report = await runProbe(agent, {
    targetServiceId: target,
    requirements: { task: "conformance-probe", ping: true },
    logger: log,
  });

  console.log(JSON.stringify(report, null, 2));
  await agent.close();

  // CI gate: pass when the target meets the minimum score (default 60).
  const minScore = Number(process.env.MIN_SCORE || 60);
  const passed = report.score >= minScore;
  log[passed ? "info" : "error"](
    `${passed ? "PASS" : "FAIL"}: ${report.target} scored ${report.score}/100 (min ${minScore})`,
  );
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.error("fatal:", e.message);
  process.exit(1);
});
