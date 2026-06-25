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
 * (CROO_API_KEY + WALLET_PRIVATE_KEY) because it transacts against a real target.
 * Exit code 0 if the target scores >= 60, else 1 — handy in CI.
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
  process.exit(report.score >= 60 ? 0 : 1);
}

main().catch((e) => {
  console.error("fatal:", e.message);
  process.exit(1);
});
