"use strict";
const test = require("node:test");
const assert = require("node:assert");

// Loads the REAL @croo-network/sdk if installed and asserts the exact contract
// the CapAgent adapter depends on. This is the drift tripwire: if a future SDK
// version renames an event or method, CI fails here with a precise message
// instead of CAPProbe silently mis-probing in live mode. Skips cleanly when the
// optional SDK is not installed (e.g. the offline demo path).
let sdk = null;
try {
  sdk = require("@croo-network/sdk");
} catch (_) {
  /* optional dependency not installed — test skips */
}

test(
  "SDK contract: AgentClient + EventType + method names",
  { skip: sdk ? false : "optional @croo-network/sdk not installed" },
  () => {
    assert.strictEqual(
      typeof sdk.AgentClient,
      "function",
      "AgentClient export missing",
    );
    assert.ok(sdk.EventType, "EventType export missing");

    // Wire event names the adapter subscribes to (via stream.onAny + event.type).
    const expectEvents = {
      NegotiationCreated: "order_negotiation_created",
      NegotiationRejected: "order_negotiation_rejected",
      NegotiationExpired: "order_negotiation_expired",
      OrderCreated: "order_created",
      OrderPaid: "order_paid",
      OrderCompleted: "order_completed",
      OrderRejected: "order_rejected",
      OrderExpired: "order_expired",
    };
    for (const [name, wire] of Object.entries(expectEvents)) {
      assert.strictEqual(
        sdk.EventType[name],
        wire,
        `EventType.${name} should be "${wire}"`,
      );
    }

    // Methods the adapter calls on AgentClient.
    const proto = sdk.AgentClient.prototype;
    const methods = [
      "negotiateOrder",
      "acceptNegotiation",
      "rejectNegotiation",
      "payOrder",
      "deliverOrder",
      "getDelivery",
      "getOrder",
      "getNegotiation",
      "connectWebSocket",
    ];
    for (const m of methods) {
      assert.strictEqual(
        typeof proto[m],
        "function",
        `AgentClient.${m} missing`,
      );
    }
  },
);
