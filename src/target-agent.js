"use strict";

/**
 * target-agent.js — a minimal, well-behaved CAP agent used as the probe target in
 * the local demo. It accepts every negotiation and returns a JSON echo of the
 * request as its deliverable, giving CAPProbe a real agent to exercise the full
 * negotiate -> pay -> deliver lifecycle against.
 *
 * In production you would point CAPProbe at YOUR agent's serviceId instead.
 */

const { loadConfig, createAgent } = require("./core");
const { Logger } = require("./logger");

async function createTarget(overrides = {}) {
  const cfg = loadConfig({ ...overrides });
  const log = new Logger("target-echo", cfg.logLevel);
  const agent = createAgent(cfg, { name: "target-echo" });
  await agent.connect();

  const serviceId = overrides.serviceId || cfg.targetServiceId;
  await agent.registerService(serviceId, {
    title: "Echo Agent",
    description: "Echoes the request payload back. Demo target for CAPProbe.",
    price: "0.01",
    deliverableType: "application/json",
  });
  log.info("echo target online", { serviceId, mode: cfg.mode });

  agent.on("negotiation_created", async (p) => {
    await agent.acceptNegotiation(p.negotiationId);
  });

  agent.on("order_paid", async (p) => {
    const payload = {
      agent: "echo",
      orderId: p.orderId,
      ok: true,
      ts: new Date().toISOString(),
    };
    await agent.deliver(p.orderId, {
      type: "application/json",
      text: JSON.stringify(payload),
    });
    log.info("echo delivered", { orderId: p.orderId });
  });

  return { agent, cfg, serviceId, log };
}

async function main() {
  const { agent, log } = await createTarget({});
  log.info("echo target listening… (Ctrl+C to stop)");
  const shutdown = async () => {
    await agent.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (require.main === module) {
  main().catch((e) => {
    console.error("fatal:", e.message);
    process.exit(1);
  });
}

module.exports = { createTarget };
