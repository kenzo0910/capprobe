"use strict";
process.env.CROO_MODE = "mock";
process.env.LOG_LEVEL = "silent";

const test = require("node:test");
const assert = require("node:assert");
const { createTarget } = require("../src/target-agent");
const { createProvider } = require("../src/provider");
const { runRequesterDemo } = require("../src/requester-demo");
const { resetBroker } = require("../src/mock-sdk");
const {
  createAgent,
  loadConfig,
  runProbe,
  EV,
  CHECK_WEIGHTS,
} = require("../src/core");

test("healthy target scores 100/A through the full 3-hop A2A chain", async () => {
  resetBroker();
  const t = await createTarget({ serviceId: "t.echo" });
  const p = await createProvider({
    capprobeServiceId: "t.probe",
    targetServiceId: "t.echo",
  });
  const { report } = await runRequesterDemo({
    capprobeServiceId: "t.probe",
    targetServiceId: "t.echo",
  });
  assert.strictEqual(report.error, null);
  assert.ok(report.score >= 90, `score ${report.score}`);
  assert.strictEqual(report.grade, "A");
  assert.ok(report.checks.length >= 8);
  await t.agent.close();
  await p.agent.close();
});

test("unreachable target fails fast (<2s) with a low grade and a recommendation", async () => {
  resetBroker();
  const cfg = loadConfig({ mode: "mock" });
  const agent = createAgent(cfg, { name: "cli" });
  await agent.connect();
  const t0 = Date.now();
  const r = await runProbe(agent, {
    targetServiceId: "nope.v1",
    timeouts: { accept: 3000 },
  });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 2000, `expected fast-fail, took ${elapsed}ms`);
  assert.strictEqual(r.grade, "F");
  assert.ok(r.score < 60);
  assert.ok(r.recommendations.length > 0);
  await agent.close();
});

test("rejected negotiation (missing targetServiceId) is graded, not hung", async () => {
  resetBroker();
  // Provider rejects when requirements lack targetServiceId; a direct probe of
  // the CAPProbe service with empty requirements must therefore be rejected fast.
  const p = await createProvider({
    capprobeServiceId: "p.only",
    targetServiceId: "t.echo",
  });
  const cfg = loadConfig({ mode: "mock" });
  const buyer = createAgent(cfg, { name: "buyer" });
  await buyer.connect();
  const r = await runProbe(buyer, {
    targetServiceId: "p.only",
    requirements: {},
    timeouts: { accept: 3000 },
  });
  assert.strictEqual(r.grade, "F");
  assert.ok(r.error && /reject/i.test(r.error), `error was: ${r.error}`);
  await buyer.close();
  await p.agent.close();
});

test("slow target: sla.met=false deducts 10 pts -> 90 (grade A boundary) with an SLA recommendation", async () => {
  resetBroker();
  const t = await createTarget({ serviceId: "t.slow" });
  const cfg = loadConfig({ mode: "mock" });
  const agent = createAgent(cfg, { name: "prober-slow" });
  await agent.connect();
  // slaTargetMs:1 guarantees real delivery time exceeds the target (sla.met=false)
  // while every other check still passes. 100 - 10 = 90, which is the A boundary.
  const r = await runProbe(agent, {
    targetServiceId: "t.slow",
    timeouts: { slaTargetMs: 1 },
  });
  assert.strictEqual(r.score, 90);
  assert.strictEqual(r.grade, "A");
  const sla = r.checks.find((c) => c.id === "sla.met");
  assert.ok(sla && sla.ok === false, "sla.met must be FAIL");
  assert.ok(r.recommendations.some((rec) => rec.check === "sla.met"));
  await t.agent.close();
  await agent.close();
});

test("bad-JSON deliverable with expectJson=true -> deliverable.valid=false, 90/B", async () => {
  resetBroker();
  const cfg = loadConfig({ mode: "mock" });
  // A target that accepts/pays but delivers non-JSON text.
  const bad = createAgent(cfg, { name: "bad-target" });
  await bad.connect();
  await bad.registerService("t.badjson");
  bad.on(EV.NEGOTIATION_CREATED, (p) => bad.acceptNegotiation(p.negotiationId));
  bad.on(EV.ORDER_PAID, (p) =>
    bad.deliver(p.orderId, { type: "text", text: "not-json" }),
  );

  const probe = createAgent(cfg, { name: "prober-badjson" });
  await probe.connect();
  const r = await runProbe(probe, {
    targetServiceId: "t.badjson",
    expectJson: true,
    timeouts: { accept: 3000, sla: 3000, fetch: 3000 },
  });
  const dv = r.checks.find((c) => c.id === "deliverable.valid");
  assert.ok(dv && dv.ok === false, "deliverable.valid must be FAIL");
  assert.strictEqual(r.score, 90);
  assert.ok(r.recommendations.some((rec) => rec.check === "deliverable.valid"));
  await bad.close();
  await probe.close();
});

test("unreachable target back-fills all weighted checks (stable scoring denominator)", async () => {
  resetBroker();
  const cfg = loadConfig({ mode: "mock" });
  const agent = createAgent(cfg, { name: "prober-backfill" });
  await agent.connect();
  const r = await runProbe(agent, {
    targetServiceId: "nope.v1",
    timeouts: { accept: 2000 },
  });
  // All 8 weighted checks must be present so the scoring denominator is stable.
  const gotIds = r.checks.map((c) => c.id).sort();
  assert.deepStrictEqual(gotIds, Object.keys(CHECK_WEIGHTS).sort());
  assert.strictEqual(r.grade, "F");
  // The phase that actually failed carries a real message; later phases are
  // back-filled with "not reached".
  const accepted = r.checks.find((c) => c.id === "negotiation.accepted");
  assert.ok(
    accepted && accepted.ok === false,
    "negotiation.accepted must FAIL",
  );
  assert.ok(
    r.checks.some((c) => c.detail === "not reached"),
    "expected back-filled checks",
  );
  await agent.close();
});
