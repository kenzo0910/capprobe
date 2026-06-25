"use strict";

/**
 * mock-sdk.js — an in-process simulation of the CROO coordination server and the
 * @croo-network/sdk@0.2.1 `AgentClient` surface.
 *
 * It lets the whole negotiate -> pay -> deliver lifecycle run locally with zero
 * network, zero USDC and zero `npm install`, so `npm run demo` works on a fresh
 * clone. `MockAgentClient` mirrors the real client's method names AND return
 * shapes (e.g. acceptNegotiation -> { negotiation, order }; requirements live on
 * the negotiation; events arrive via stream.onAny with snake_case ids), so
 * `core.js` wraps the real SDK and this mock through the identical code path.
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
    this.negotiations = new Map(); // negId -> negotiation record
    this.orders = new Map(); // orderId -> order record
    this.deliveries = new Map(); // orderId -> { deliverableType, deliverableText }
  }

  attach(client) {
    this.clients.set(client.id, client);
  }

  registerProvider(serviceId, client) {
    this.providersByService.set(serviceId, client);
  }

  // Push a wire Event to a client's stream after a small async delay.
  _push(client, event) {
    if (!client || !client.stream) return;
    setTimeout(() => {
      try {
        client.stream.emit(event.type, event);
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
      negotiationId: negId,
      serviceId,
      requirements: req.requirements || "",
      requesterAgentId: requester.id,
      providerAgentId: provider ? provider.id : "",
      status: "pending",
      _requester: requester,
      _provider: provider,
    };
    this.negotiations.set(negId, neg);

    if (!provider) {
      neg.status = "rejected";
      this._push(requester, {
        type: "order_negotiation_rejected",
        negotiation_id: negId,
        service_id: serviceId,
        reason: "no provider registered for service",
      });
      return {
        negotiationId: negId,
        serviceId,
        status: "rejected",
        requirements: neg.requirements,
      };
    }

    this._push(provider, {
      type: "order_negotiation_created",
      negotiation_id: negId,
      service_id: serviceId,
    });
    return {
      negotiationId: negId,
      serviceId,
      status: "pending",
      requirements: neg.requirements,
    };
  }

  accept(provider, negId) {
    const neg = this.negotiations.get(negId);
    if (!neg) throw apiError("not_found", "negotiation not found");
    neg.status = "accepted";
    const orderId = nextId("ord");
    const order = {
      orderId,
      negotiationId: negId,
      serviceId: neg.serviceId,
      requesterAgentId: neg.requesterAgentId,
      providerAgentId: provider.id,
      price: MOCK_PRICE_USDC,
      paymentToken: "USDC",
      status: "created",
      _requester: neg._requester,
      _provider: provider,
    };
    this.orders.set(orderId, order);
    this._push(neg._requester, {
      type: "order_created",
      order_id: orderId,
      negotiation_id: negId,
      service_id: neg.serviceId,
    });
    return { negotiation: this._negView(neg), order: this._orderView(order) };
  }

  reject(_party, negId, reason) {
    const neg = this.negotiations.get(negId);
    if (!neg) return;
    neg.status = "rejected";
    this._push(neg._requester, {
      type: "order_negotiation_rejected",
      negotiation_id: negId,
      service_id: neg.serviceId,
      reason: reason || "rejected",
    });
  }

  pay(_requester, orderId) {
    const order = this.orders.get(orderId);
    if (!order) throw apiError("not_found", "order not found");
    order.status = "paid";
    const txHash = "0x" + "ab".repeat(32); // deterministic fake Base tx hash
    order.payTxHash = txHash;
    this._push(order._provider, {
      type: "order_paid",
      order_id: orderId,
      negotiation_id: order.negotiationId,
      service_id: order.serviceId,
    });
    return { order: this._orderView(order), txHash };
  }

  deliver(_provider, orderId, req) {
    const order = this.orders.get(orderId);
    if (!order) throw apiError("not_found", "order not found");
    order.status = "completed";
    const delivery = {
      orderId,
      deliverableType: req.deliverableType,
      deliverableText: req.deliverableText || "",
      deliverableSchema: req.deliverableSchema || "",
      status: "submitted",
    };
    this.deliveries.set(orderId, delivery);
    this._push(order._requester, {
      type: "order_completed",
      order_id: orderId,
    });
    return {
      order: this._orderView(order),
      delivery,
      txHash: "0x" + "cd".repeat(32),
    };
  }

  getDelivery(orderId) {
    const d = this.deliveries.get(orderId);
    if (!d) throw apiError("not_found", "delivery not found");
    return d;
  }

  getOrder(orderId) {
    const o = this.orders.get(orderId);
    if (!o) throw apiError("not_found", "order not found");
    return this._orderView(o);
  }

  getNegotiation(negId) {
    const n = this.negotiations.get(negId);
    if (!n) throw apiError("not_found", "negotiation not found");
    return this._negView(n);
  }

  _negView(n) {
    return {
      negotiationId: n.negotiationId,
      serviceId: n.serviceId,
      requirements: n.requirements,
      requesterAgentId: n.requesterAgentId,
      providerAgentId: n.providerAgentId,
      status: n.status,
    };
  }

  _orderView(o) {
    return {
      orderId: o.orderId,
      negotiationId: o.negotiationId,
      serviceId: o.serviceId,
      price: o.price,
      paymentToken: o.paymentToken,
      status: o.status,
      payTxHash: o.payTxHash || "",
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

// A stream that mirrors the real SDK EventStream (on / onAny / close).
class MockStream extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
    this._any = [];
  }
  onAny(handler) {
    this._any.push(handler);
  }
  emit(type, event) {
    for (const h of this._any) {
      try {
        h(event);
      } catch (_) {
        /* ignore handler throw */
      }
    }
    return super.emit(type, event);
  }
  close() {
    this.removeAllListeners();
    this._any = [];
  }
}

/**
 * Drop-in stand-in for `new AgentClient(config, sdkKey)`. Same method names and
 * return shapes as @croo-network/sdk@0.2.1 so `core.js` does not branch on mode.
 */
class MockAgentClient {
  constructor(config = {}, sdkKey = "") {
    this.config = config;
    this.sdkKey = sdkKey;
    this.id = sdkKey || nextId("agent");
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
  async getNegotiation(negotiationId) {
    return this.broker.getNegotiation(negotiationId);
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
