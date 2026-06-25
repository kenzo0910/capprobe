"use strict";

/**
 * test-local.js — offline end-to-end demo + smoke test.
 *
 * Spins up three agents in ONE process over the in-memory broker:
 *   echo target  <—  CAPProbe provider  <—  paying customer
 *
 * It proves the full agent-to-agent-to-agent chain (negotiate -> pay -> deliver,
 * twice) with zero network, zero USDC and zero `npm install`, then asserts the
 * resulting conformance report is healthy. Exits non-zero if anything is broken,
 * so it doubles as CI.
 */

process.env.CROO_MODE = "mock";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "info";

const assert = require("assert");
const { createTarget } = require("../src/target-agent");
const { createProvider } = require("../src/provider");
const { runRequesterDemo } = require("../src/requester-demo");
const { resetBroker } = require("../src/mock-sdk");

async function main() {
  resetBroker();

  const TARGET = "demo.echo.v1";
  const CAPPROBE = "capprobe.conformance.v1";

  console.log("\n=== CAPProbe local A2A demo (mock mode) ===\n");

  // 1) bring up the echo target and the CAPProbe provider
  const target = await createTarget({ serviceId: TARGET });
  const provider = await createProvider({
    capprobeServiceId: CAPPROBE,
    targetServiceId: TARGET,
  });

  // 2) a customer hires CAPProbe to audit the target (the A2A chain runs here)
  const { report } = await runRequesterDemo({
    capprobeServiceId: CAPPROBE,
    targetServiceId: TARGET,
  });

  console.log("\n--- Conformance report delivered to the customer ---");
  console.log(JSON.stringify(report, null, 2));

  // 3) assertions — fail the script (non-zero exit) if the chain is broken
  assert.ok(report, "no report returned");
  assert.strictEqual(
    typeof report.score,
    "number",
    "report.score must be a number",
  );
  assert.ok(
    Array.isArray(report.checks) && report.checks.length >= 6,
    "expected >= 6 checks",
  );
  assert.strictEqual(
    report.error,
    null,
    `probe reported an error: ${report.error}`,
  );
  assert.ok(
    report.score >= 90,
    `expected a healthy target to score >= 90, got ${report.score}`,
  );
  assert.strictEqual(
    report.grade,
    "A",
    `expected grade A, got ${report.grade}`,
  );

  console.log(
    `\n✅ PASS — full negotiate->pay->deliver A2A chain worked. ` +
      `Target scored ${report.score}/100 (${report.grade}).\n`,
  );

  await target.agent.close();
  await provider.agent.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("\n❌ FAIL —", e.message);
  console.error(e);
  process.exit(1);
});
