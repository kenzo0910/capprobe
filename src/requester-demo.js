"use strict";

/**
 * requester-demo.js — a paying customer that hires CAPProbe.
 *
 * It proves end-to-end A2A composability from the buyer's side:
 *   negotiateOrder -> (order_created) -> payOrder -> (order_completed) -> getDelivery
 *
 * The delivery it receives is CAPProbe's conformance report on the target agent.
 */

const {
  loadConfig,
  createAgent,
  waitForEvent,
  waitForFirst,
  withTimeout,
  EV,
} = require("./core");
const { Logger } = require("./logger");

async function runRequesterDemo(overrides = {}) {
  const cfg = loadConfig({ ...overrides });
  const log = new Logger("requester-demo", cfg.logLevel);
  const agent = createAgent(cfg, { name: "requester-demo" });
  await agent.connect();

  const capprobeServiceId =
    overrides.capprobeServiceId || cfg.capprobeServiceId;
  const targetServiceId = overrides.targetServiceId || cfg.targetServiceId;

  // What we ask CAPProbe to do: audit `targetServiceId` for us.
  const requirements = {
    targetServiceId,
    expectJson: false,
    sampleRequirements: { task: "echo", payload: { hello: "world" } },
  };

  log.info("hiring CAPProbe to audit a target agent", {
    capprobeServiceId,
    targetServiceId,
  });

  // Attach the final-delivery waiter BEFORE negotiating to avoid a race where the
  // report is delivered before we start listening.
  const completedP = waitForEvent(
    agent,
    EV.ORDER_COMPLETED,
    () => true,
    180_000,
    "order_completed (final report)",
  );

  const neg = await withTimeout(
    agent.negotiate({
      serviceId: capprobeServiceId,
      requirements: JSON.stringify(requirements),
    }),
    90_000,
    "negotiateOrder",
  );
  log.info("negotiation opened", { negotiationId: neg.negotiationId });

  const created = await waitForFirst(
    agent,
    [
      {
        event: EV.ORDER_CREATED,
        predicate: (p) =>
          !p.negotiationId || p.negotiationId === neg.negotiationId,
      },
      { event: EV.NEGOTIATION_REJECTED, predicate: () => true },
    ],
    90_000,
    "order_created",
  );
  if (created.event !== EV.ORDER_CREATED) {
    throw new Error(
      `CAPProbe rejected the negotiation: ${created.payload.reason || "unknown"}`,
    );
  }
  const orderId = created.payload.orderId;
  log.info("order created — paying escrow in USDC", {
    orderId,
    amount: created.payload.amount,
  });

  await withTimeout(agent.pay(orderId), 90_000, "payOrder");
  log.info("payment sent — waiting for CAPProbe to deliver the report");

  const done = await completedP;
  const delivery = await withTimeout(
    agent.getDelivery(done.orderId || orderId),
    90_000,
    "getDelivery",
  );

  let report;
  try {
    report = JSON.parse(delivery.text);
  } catch (_) {
    report = { raw: delivery.text };
  }
  log.info("report received", { score: report.score, grade: report.grade });

  return { report, agent, cfg, log };
}

async function main() {
  const { report, agent, log } = await runRequesterDemo({});
  log.info("=== CAPProbe conformance report ===");
  console.log(JSON.stringify(report, null, 2));
  await agent.close();
  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error("fatal:", e.message);
    process.exit(1);
  });
}

module.exports = { runRequesterDemo };
