"use strict";

/**
 * mock-sdk.js — an in-process simulation of the CROO coordination server and the
 * @croo-network/sdk `AgentClient` surface.
 *
 * It lets the whole negotiate -> pay -> deliver lifecycle run locally with zero
 * network, zero USDC and zero `npm install`, so `npm run demo` works on a fresh
 * clone. `MockAgentClient` mirrors the real client's method names exactly, so
 * `core.js` wraps the real SDK and this mock through the identical code path.
 *
 * Routing model: a single per-process `MockBroker` connects a requester client to
 * whichever provider client registered the target `serviceId`, and pushes the
 * matching lifecycle events to each party's stream — exactly like the real WS hub.
 */

const { EventEmitter } = require("events");

// Simulated one-way network latency per event hop (ms). Kept small + deterministic.
const MOCK_LATENCY_MS = Number(process.env.MOCK_LATENCY_MS || 10);
const MOCK_PRICE_USDC = process.env.PROBE_PRICE_USDC || "0.50";

let _idSeq = 1;
function nextId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${(_idSeq++).toString(36)}`;
}

function apiError(code, reason) {
  const e = new Error(`${code}: ${reason}`);
  e.code = code;
  e.reason = reason;
  e.isAPIError = true;
  return e;
}

class MockBroker {
  constructor() {
    this.clients = new Map(); // agentId -> MockAgentClient
    this.providersByService = new Map(); // serviceId -> MockAgentClient
    this.negotiations = new Map(); // negId -> negotiation
    this.orders = new Map(); // orderId -> order
    this.deliveries = new Map(); // orderId -> { deliverable_type, deliverable_text }
  }

  attach(client) {
    this.clients.set(client.id, client);
  }

  registerProvider(serviceId, client) {
    this.providersByService.set(serviceId, client);
  }

  // Push an event to a client's stream after a small async delay (mimics the WS hub).
  _push(client, event, payload) {
    if (!client || !client.stream) return;
    setTimeout(() => {
      try {
        client.stream.emit(event, payload);
      } catch (_) {
        /* a downstream handler threw — never crash the broker */
      }
    }, MOCK_LATENCY_MS);
  }

  createNegotiation(requester, req) {
    const serviceId = req.serviceId || req.service_id;
    const negId = nextId("neg");
    const provider = this.providersByService.get(serviceId);
    const neg = {
      id: negId,
      serviceId,
      requirements: req.requirements,
      requester,
      provider,
      status: "pending",
    };
    this.negotiations.set(negId, neg);

    if (!provider) {
      // No agent listed for this serviceId — reject so the requester fails fast.
      this._push(requester, "negotiation_rejected", {
        negotiation_id: negId,
        reason: "no provider registered for service",
      });
      return {
        id: negId,
        service_id: serviceId,
        status: "rejected",
        reason: "unknown service",
      };
    }

    this._push(provider, "negotiation_created", {
      negotiation_id: negId,
      service_id: serviceId,
      requirements: req.requirements,
    });
    return { id: negId, service_id: serviceId, status: "pending" };
  }

  accept(provider, negId) {
    const neg = this.negotiations.get(negId);
    if (!neg) throw apiError("not_found", "negotiation not found");
    neg.status = "accepted";
    const orderId = nextId("ord");
    const order = {
      id: orderId,
      negotiationId: negId,
      serviceId: neg.serviceId,
      requirements: neg.requirements,
      requester: neg.requester,
      provider,
      amount: MOCK_PRICE_USDC,
      status: "created",
    };
    this.orders.set(orderId, order);
    this._push(neg.requester, "order_created", {
      order_id: orderId,
      negotiation_id: negId,
      service_id: neg.serviceId,
      amount: order.amount,
    });
    return { order_id: orderId, negotiation_id: negId, status: "created" };
  }

  reject(_party, negId, reason) {
    const neg = this.negotiations.get(negId);
    if (neg) neg.status = "rejected";
    if (neg) {
      this._push(neg.requester, "negotiation_rejected", {
        negotiation_id: negId,
        reason: reason || "rejected",
      });
    }
  }

  pay(_requester, orderId) {
    const order = this.orders.get(orderId);
    if (!order) throw apiError("not_found", "order not found");
    order.status = "paid";
    // Deterministic fake settlement tx hash on Base.
    const txHash = "0x" + "ab".repeat(32);
    this._push(order.provider, "order_paid", {
      order_id: orderId,
      tx_hash: txHash,
      amount: order.amount,
    });
    return { order_id: orderId, tx_hash: txHash, status: "paid" };
  }

  deliver(_provider, orderId, req) {
    const order = this.orders.get(orderId);
    if (!order) throw apiError("not_found", "order not found");
    order.status = "completed";
    this.deliveries.set(orderId, {
      deliverable_type: req.deliverableType,
      deliverable_text: req.deliverableText,
    });
    this._push(order.requester, "order_completed", {
      order_id: orderId,
      status: "completed",
    });
    return { order_id: orderId, status: "completed" };
  }

  getDelivery(orderId) {
    const d = this.deliveries.get(orderId);
    if (!d) throw apiError("not_found", "delivery not found");
    return d;
  }

  getOrder(orderId) {
    const o = this.orders.get(orderId);
    if (!o) throw apiError("not_found", "order not found");
    return {
      id: o.id,
      status: o.status,
      requirements: o.requirements,
      service_id: o.serviceId,
      amount: o.amount,
      negotiation_id: o.negotiationId,
    };
  }
}

let _broker = null;
function getBroker() {
  if (!_broker) _broker = new MockBroker();
  return _broker;
}
function resetBroker() {
  _broker = new MockBroker();
  return _broker;
}

// A minimal stream that mirrors the real SDK's WebSocket stream (EventEmitter + close()).
class MockStream extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
  }
  close() {
    this.removeAllListeners();
  }
}

/**
 * Drop-in stand-in for `new AgentClient(config, apiKey)`. Same method names and
 * return shapes as the real SDK so `core.js` does not branch on mode at call sites.
 */
class MockAgentClient {
  constructor(config = {}, apiKey = "") {
    this.config = config;
    this.apiKey = apiKey;
    this.id = apiKey || nextId("agent");
    this.stream = new MockStream();
    this.broker = getBroker();
    this.broker.attach(this);
  }

  async connectWebSocket() {
    return this.stream;
  }

  registerService(serviceId /*, meta */) {
    this.broker.registerProvider(serviceId, this);
    return { serviceId, registered: true };
  }

  async negotiateOrder(req) {
    return this.broker.createNegotiation(this, req);
  }
  async acceptNegotiation(negotiationId) {
    return this.broker.accept(this, negotiationId);
  }
  async rejectNegotiation(negotiationId, reason) {
    return this.broker.reject(this, negotiationId, reason);
  }
  async payOrder(orderId) {
    return this.broker.pay(this, orderId);
  }
  async deliverOrder(orderId, req) {
    return this.broker.deliver(this, orderId, req);
  }
  async getDelivery(orderId) {
    return this.broker.getDelivery(orderId);
  }
  async getOrder(orderId) {
    return this.broker.getOrder(orderId);
  }

  close() {
    try {
      this.stream.close();
    } catch (_) {
      /* ignore */
    }
  }
}

module.exports = {
  MockAgentClient,
  MockBroker,
  MockStream,
  getBroker,
  resetBroker,
};
