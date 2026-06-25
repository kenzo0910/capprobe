"use strict";

/**
 * provider.js — the CAPProbe service (a paid CROO provider agent).
 *
 * Lifecycle it implements as a *seller*:
 *   negotiation_created -> acceptNegotiation()   (admission control)
 *   order_paid          -> run the conformance probe, then deliverOrder()
 *
 * The clever part: to fulfil an order it acts as a *requester* against the
 * customer's target agent (runProbe). So a single purchase of CAPProbe is an
 * agent-to-agent-to-agent chain — the core A2A composability story.
 */

const { loadConfig, createAgent, runProbe } = require("./core");
const { Logger } = require("./logger");

function parseRequirements(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

async function createProvider(overrides = {}) {
  const cfg = loadConfig({ ...overrides });
  const log = new Logger("capprobe-provider", cfg.logLevel);
  const agent = createAgent(cfg, { name: "capprobe-provider" });
  await agent.connect();

  await agent.registerService(cfg.capprobeServiceId, {
    title: "CAPProbe — Agent Conformance Test",
    description:
      "Pay CAPProbe to run a full negotiate->pay->deliver conformance probe against any " +
      "CAP agent and receive a scored JSON health report with actionable fixes.",
    price: cfg.priceUSDC,
    deliverableType: "application/json",
  });
  log.info("CAPProbe provider online", {
    serviceId: cfg.capprobeServiceId,
    mode: cfg.mode,
  });

  // Seller side — admission control then accept.
  agent.on("negotiation_created", async (p) => {
    const req = parseRequirements(p.requirements);
    if (!req.targetServiceId) {
      log.warn("rejecting negotiation: requirements missing targetServiceId", {
        negotiationId: p.negotiationId,
      });
      await agent.rejectNegotiation(
        p.negotiationId,
        "requirements must include a targetServiceId to probe",
      );
      return;
    }
    await agent.acceptNegotiation(p.negotiationId);
    log.info("negotiation accepted", {
      negotiationId: p.negotiationId,
      target: req.targetServiceId,
    });
  });

  // Seller side — escrow is locked, do the work and deliver.
  agent.on("order_paid", async (p) => {
    const orderId = p.orderId;
    log.info("order paid — starting conformance probe", { orderId });

    // Recover the customer's requirements (which target to probe, how, SLA).
    let requirements = {};
    try {
      const order = await agent.getOrder(orderId);
      requirements = parseRequirements(order && order.requirements);
    } catch (e) {
      log.warn("getOrder failed; falling back to event payload", {
        err: e.message,
      });
    }
    if (!requirements.targetServiceId)
      requirements = parseRequirements(p.requirements);

    const targetServiceId = requirements.targetServiceId || cfg.targetServiceId;

    try {
      // ---- the A2A hop: CAPProbe now becomes a requester against the target ----
      const report = await runProbe(agent, {
        targetServiceId,
        requirements: requirements.sampleRequirements || {
          task: "conformance-probe",
          ping: true,
        },
        expectJson: !!requirements.expectJson,
        timeouts: requirements.timeouts || {},
        logger: log.child("probe"),
      });
      await agent.deliver(orderId, {
        type: "application/json",
        text: JSON.stringify(report, null, 2),
      });
      log.info("report delivered", {
        orderId,
        score: report.score,
        grade: report.grade,
      });
    } catch (e) {
      // A failed probe is still useful signal — always deliver an error report.
      const errReport = {
        tool: "CAPProbe",
        target: targetServiceId,
        score: 0,
        grade: "F",
        error: e.message,
        finishedAt: new Date().toISOString(),
      };
      try {
        await agent.deliver(orderId, {
          type: "application/json",
          text: JSON.stringify(errReport, null, 2),
        });
      } catch (_) {
        /* delivery itself failed — already logged below */
      }
      log.error("probe failed", { orderId, err: e.message });
    }
  });

  return { agent, cfg, log };
}

async function main() {
  const { agent, log } = await createProvider({});
  log.info("listening for orders… (Ctrl+C to stop)");
  const shutdown = async () => {
    log.info("shutting down");
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

module.exports = { createProvider, parseRequirements };
