#!/usr/bin/env node
"use strict";

/**
 * probe-full.js — run the FULL 3-hop A2A chain in one command:
 *
 *     Customer  ──negotiate→pay→deliver──▶  CAPProbe  ──negotiate→pay→deliver──▶  Target
 *
 * This is the headline demonstration (two settlements, three agents). The plain
 * `probe` CLI / GitHub Action is the 2-hop direct path; this is the 3-hop one.
 *
 * MOCK (default): spins up echo target + CAPProbe + customer over the in-process
 * broker — a one-shot you can screen-record. Asserts a healthy 100/A.
 *
 * LIVE: drives THREE real agents you registered on the Agent Store, each with its
 * own SDK-Key, against real CROO infra (real USDC on Base). Required env:
 *     CROO_MODE=live
 *     CAPPROBE_API_KEY   CAPPROBE_SERVICE_ID     (agent A — the prober/provider)
 *     TARGET_API_KEY     TARGET_SERVICE_ID       (agent C — the agent being tested)
 *     REQUESTER_API_KEY                          (agent B — the paying customer)
 * Then watch the two USDC settlements on BaseScan (agent A's and agent C's wallets).
 */

const assert = require("node:assert");
const { createTarget } = require("../src/target-agent");
const { createProvider } = require("../src/provider");
const { runRequesterDemo } = require("../src/requester-demo");
const { resetBroker } = require("../src/mock-sdk");
const { sleep } = require("../src/core");

const LIVE = String(process.env.CROO_MODE || "mock").toLowerCase() === "live";

function requireEnv(keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(
      `Live mode needs: ${missing.join(", ")}.\n` +
        "Register agents A (CAPProbe), B (Requester), C (Target) on the Agent Store, " +
        "then set their SDK-Keys + service ids. See README → 'Going live'.",
    );
    process.exit(2);
  }
}

async function main() {
  console.log(
    `\n=== CAPProbe full 3-hop A2A demo (${LIVE ? "LIVE" : "mock"}) ===\n`,
  );

  let target, provider, capprobeServiceId, targetServiceId, requesterOpts;

  if (LIVE) {
    requireEnv([
      "CAPPROBE_API_KEY",
      "CAPPROBE_SERVICE_ID",
      "TARGET_API_KEY",
      "TARGET_SERVICE_ID",
      "REQUESTER_API_KEY",
    ]);
    capprobeServiceId = process.env.CAPPROBE_SERVICE_ID;
    targetServiceId = process.env.TARGET_SERVICE_ID;

    // Agent C — the target being tested (its own key).
    target = await createTarget({
      mode: "live",
      apiKey: process.env.TARGET_API_KEY,
      serviceId: targetServiceId,
    });
    // Agent A — CAPProbe (its own key); it will pay the target while probing.
    provider = await createProvider({
      mode: "live",
      apiKey: process.env.CAPPROBE_API_KEY,
      capprobeServiceId,
      targetServiceId,
    });
    // Give the WebSocket streams a moment to connect before the customer hires.
    await sleep(2500);

    // Agent B — the paying customer (its own key).
    requesterOpts = {
      mode: "live",
      apiKey: process.env.REQUESTER_API_KEY,
      capprobeServiceId,
      targetServiceId,
    };
  } else {
    resetBroker();
    capprobeServiceId = "capprobe.conformance.v1";
    targetServiceId = "demo.echo.v1";
    target = await createTarget({ serviceId: targetServiceId });
    provider = await createProvider({ capprobeServiceId, targetServiceId });
    requesterOpts = { capprobeServiceId, targetServiceId };
  }

  const { report } = await runRequesterDemo(requesterOpts);

  console.log("\n--- Conformance report delivered to the customer ---");
  console.log(JSON.stringify(report, null, 2));

  await target.agent.close();
  await provider.agent.close();

  if (!LIVE) {
    assert.ok(
      report && report.score >= 90,
      `expected healthy >= 90, got ${report && report.score}`,
    );
    assert.strictEqual(report.grade, "A");
    console.log(
      `\n✅ PASS — 3-hop chain worked end to end. Target scored ${report.score}/100 (${report.grade}).\n`,
    );
  } else {
    console.log(
      `\n✅ LIVE run complete — target scored ${report.score}/100 (${report.grade}). ` +
        "Verify the two USDC settlements on BaseScan (CAPProbe's and the target's AA wallets).\n",
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("\n❌ probe-full failed —", e.message);
  console.error(e);
  process.exit(1);
});
