"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { CapAgent, normalizePayload } = require("../src/core");

const noopStream = { onAny() {}, on() {}, close() {} };

test("normalizePayload maps snake_case CAP event ids", () => {
  const p = normalizePayload({
    type: "order_paid",
    order_id: "o1",
    negotiation_id: "n1",
    service_id: "s1",
    status: "paid",
  });
  assert.strictEqual(p.orderId, "o1");
  assert.strictEqual(p.negotiationId, "n1");
  assert.strictEqual(p.serviceId, "s1");
  assert.strictEqual(p.status, "paid");
});

test("acceptNegotiation reads the NESTED order.orderId (SDK shape)", async () => {
  const fake = {
    connectWebSocket: async () => noopStream,
    acceptNegotiation: async () => ({
      negotiation: { negotiationId: "n1" },
      order: { orderId: "o1" },
    }),
  };
  const a = new CapAgent({ client: fake, mode: "mock", name: "t" });
  const r = await a.acceptNegotiation("n1");
  assert.strictEqual(r.orderId, "o1");
});

test("negotiate reads camelCase negotiationId", async () => {
  const fake = { negotiateOrder: async () => ({ negotiationId: "n9" }) };
  const a = new CapAgent({ client: fake, mode: "mock", name: "t" });
  const r = await a.negotiate({ serviceId: "s" });
  assert.strictEqual(r.negotiationId, "n9");
});

test("deliver maps to deliverableType / deliverableText", async () => {
  let captured;
  const fake = {
    deliverOrder: async (id, req) => {
      captured = { id, req };
      return {};
    },
  };
  const a = new CapAgent({ client: fake, mode: "mock", name: "t" });
  await a.deliver("o1", { type: "text", text: "hi" });
  assert.strictEqual(captured.id, "o1");
  assert.strictEqual(captured.req.deliverableType, "text");
  assert.strictEqual(captured.req.deliverableText, "hi");
});

test("pay reads top-level txHash from PayOrderResult", async () => {
  const fake = { payOrder: async () => ({ order: {}, txHash: "0xabc" }) };
  const a = new CapAgent({ client: fake, mode: "mock", name: "t" });
  const r = await a.pay("o1");
  assert.strictEqual(r.txHash, "0xabc");
});

test("getDelivery normalizes camelCase deliverable fields", async () => {
  const fake = {
    getDelivery: async () => ({
      deliverableType: "text",
      deliverableText: '{"x":1}',
    }),
  };
  const a = new CapAgent({ client: fake, mode: "mock", name: "t" });
  const d = await a.getDelivery("o1");
  assert.strictEqual(d.type, "text");
  assert.strictEqual(d.text, '{"x":1}');
});
