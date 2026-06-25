"use strict";

/**
 * core.js — CAPProbe core.
 *
 * Responsibilities:
 *   1. Config loading (zero-dependency .env reader) + live-mode validation.
 *   2. `CapAgent` — a thin normalization layer over the real @croo-network/sdk
 *      `AgentClient` OR the in-process mock, exposing one stable surface.
 *   3. `runProbe()` — the conformance-test engine that drives a target agent
 *      through the full negotiate -> pay -> deliver lifecycle and scores it.
 *
 * Everything else in the repo talks only to `createAgent()` + `runProbe()`, so
 * switching between the real network and the offline mock is a single env flag.
 */

const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { Logger } = require("./logger");

// ---------------------------------------------------------------------------
// Canonical lifecycle events (snake_case) used internally. The real SDK may emit
// these under an `EventType` enum and/or PascalCase aliases, so the bridge below
// subscribes to every plausible name and re-emits the canonical one.
// ---------------------------------------------------------------------------
const EV = {
  NEGOTIATION_CREATED: "negotiation_created",
  NEGOTIATION_REJECTED: "negotiation_rejected",
  ORDER_CREATED: "order_created",
  ORDER_PAID: "order_paid",
  ORDER_COMPLETED: "order_completed",
  ORDER_REJECTED: "order_rejected",
  ORDER_EXPIRED: "order_expired",
};

const SDK_EVENT_ALIASES = {
  [EV.NEGOTIATION_CREATED]: ["negotiation_created", "NegotiationCreated"],
  [EV.NEGOTIATION_REJECTED]: ["negotiation_rejected", "NegotiationRejected"],
  [EV.ORDER_CREATED]: ["order_created", "OrderCreated"],
  [EV.ORDER_PAID]: ["order_paid", "OrderPaid"],
  [EV.ORDER_COMPLETED]: ["order_completed", "OrderCompleted"],
  [EV.ORDER_REJECTED]: ["order_rejected", "OrderRejected"],
  [EV.ORDER_EXPIRED]: ["order_expired", "OrderExpired"],
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Minimal .env loader so the demo runs with no runtime dependencies.
function loadEnv(file) {
  try {
    const p = file || path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(p)) return;
    for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch (_) {
    /* non-fatal: missing/garbled .env just means rely on real env vars */
  }
}

function loadConfig(overrides = {}) {
  loadEnv();
  const mode = String(
    overrides.mode || process.env.CROO_MODE || "mock",
  ).toLowerCase();
  return {
    mode, // 'mock' | 'live'
    apiKey: process.env.CROO_API_KEY || "", // croo_sk_...
    baseURL: process.env.CROO_API_URL || "https://api.croo.network",
    wsURL: process.env.CROO_WS_URL || "wss://api.croo.network/ws",
    rpcURL: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    privateKey: process.env.WALLET_PRIVATE_KEY || "",
    capprobeServiceId:
      process.env.CAPPROBE_SERVICE_ID || "capprobe.conformance.v1",
    targetServiceId: process.env.TARGET_SERVICE_ID || "demo.echo.v1",
    priceUSDC: process.env.PROBE_PRICE_USDC || "0.50",
    logLevel: process.env.LOG_LEVEL || "info",
    ...overrides,
  };
}

function assertLiveConfig(cfg) {
  const missing = [];
  if (!cfg.apiKey) missing.push("CROO_API_KEY (croo_sk_...)");
  if (!cfg.privateKey) missing.push("WALLET_PRIVATE_KEY");
  if (missing.length) {
    throw new Error(
      `Live mode requires: ${missing.join(", ")}. ` +
        `Set them in .env (see .env.example), or run with CROO_MODE=mock for the offline demo.`,
    );
  }
}

function loadSdk() {
  try {
    return require("@croo-network/sdk");
  } catch (e) {
    throw new Error(
      "Live mode needs the CROO SDK. Install it with `npm install @croo-network/sdk` " +
        "(Node 18+), then re-run with CROO_MODE=live. Original error: " +
        (e && e.message),
    );
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pick(obj, keys) {
  if (!obj) return undefined;
  for (const k of keys) if (obj[k] != null) return obj[k];
  return undefined;
}

function redact(value) {
  if (value == null) return value;
  return String(value)
    .replace(/croo_sk_[A-Za-z0-9_]+/g, "croo_sk_***")
    .replace(/0x[0-9a-fA-F]{40,}/g, "0x***");
}

// Normalize an event payload so downstream code reads stable field names
// regardless of whether the source was the real SDK (snake_case) or the mock.
function normalizePayload(raw) {
  const p = raw || {};
  return {
    orderId: pick(p, ["order_id", "orderId", "id"]),
    negotiationId: pick(p, ["negotiation_id", "negotiationId"]),
    serviceId: pick(p, ["service_id", "serviceId"]),
    requirements: pick(p, ["requirements", "requirement", "req"]),
    amount: pick(p, ["amount", "amount_usdc", "price"]),
    reason: pick(p, ["reason", "message"]),
    raw: p,
  };
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timeout after ${ms}ms: ${label || "operation"}`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Resolve with the payload of the first event whose predicate matches.
function waitForEvent(agent, canonical, predicate, ms, label) {
  return waitForFirst(
    agent,
    [{ event: canonical, predicate }],
    ms,
    label || canonical,
  ).then((r) => r.payload);
}

// Resolve with { event, payload } for whichever spec matches first.
function waitForFirst(agent, specs, ms, label) {
  return new Promise((resolve, reject) => {
    const handlers = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(`timeout after ${ms}ms waiting for ${label || "event"}`),
      );
    }, ms);

    function cleanup() {
      clearTimeout(timer);
      for (const [event, fn] of handlers)
        agent.events.removeListener(event, fn);
    }

    for (const spec of specs) {
      const fn = (payload) => {
        let ok = true;
        try {
          ok = spec.predicate ? spec.predicate(payload) : true;
        } catch (_) {
          ok = false;
        }
        if (!ok) return;
        cleanup();
        resolve({ event: spec.event, payload });
      };
      handlers.push([spec.event, fn]);
      agent.events.on(spec.event, fn);
    }
  });
}

// ---------------------------------------------------------------------------
// CapAgent — normalized wrapper over the real or mock client
// ---------------------------------------------------------------------------

class CapAgent {
  constructor({ client, mode, logger, name }) {
    this.client = client;
    this.mode = mode;
    this.name = name || "agent";
    this.log = logger || new Logger(this.name);
    this.events = new EventEmitter(); // canonical, normalized events
    this.events.setMaxListeners(0);
    this._stream = null;
    this._connected = false;
  }

  async connect() {
    if (this._connected) return this;
    const stream = await this.client.connectWebSocket();
    this._stream = stream;

    // Bridge every aliased SDK event name to our canonical emitter.
    for (const [canonical, aliases] of Object.entries(SDK_EVENT_ALIASES)) {
      const seen = new Set();
      for (const alias of aliases) {
        if (!alias || seen.has(alias)) continue;
        seen.add(alias);
        try {
          stream.on(alias, (raw) => this._emit(canonical, raw));
        } catch (_) {
          /* stream may not accept this alias — fine */
        }
      }
    }
    try {
      stream.on("error", (e) =>
        this.log.warn("stream error", { err: e && e.message }),
      );
    } catch (_) {
      /* some streams have no error channel */
    }

    this._connected = true;
    this.log.info("connected", { mode: this.mode });
    return this;
  }

  _emit(canonical, raw) {
    const p = normalizePayload(raw);
    this.log.debug("event", {
      event: canonical,
      orderId: p.orderId,
      negotiationId: p.negotiationId,
    });
    this.events.emit(canonical, p);
  }

  // Subscribe with a crash-proof wrapper: a throw/rejection in handler code is
  // logged, never left to take down the process.
  on(canonical, handler) {
    this.events.on(canonical, (p) => {
      Promise.resolve()
        .then(() => handler(p))
        .catch((e) =>
          this.log.error("handler error", {
            event: canonical,
            err: e && e.message,
          }),
        );
    });
    return this;
  }

  async registerService(serviceId, meta = {}) {
    if (typeof this.client.registerService === "function") {
      return this.client.registerService(serviceId, meta);
    }
    // The live SDK registers services via the CROO Agent Store dashboard, not at runtime.
    this.log.info("service registration is managed via the CROO Agent Store", {
      serviceId,
    });
    return { serviceId, registered: false, note: "register via Agent Store" };
  }

  async negotiate(req) {
    const r = await this.client.negotiateOrder(req);
    return {
      negotiationId: pick(r, ["id", "negotiation_id", "negotiationId"]),
      raw: r,
    };
  }

  async acceptNegotiation(negotiationId) {
    const r = await this.client.acceptNegotiation(negotiationId);
    return { orderId: pick(r, ["order_id", "orderId", "id"]), raw: r };
  }

  async rejectNegotiation(negotiationId, reason) {
    if (typeof this.client.rejectNegotiation === "function") {
      return this.client.rejectNegotiation(negotiationId, reason);
    }
    return undefined;
  }

  async pay(orderId) {
    const r = await this.client.payOrder(orderId);
    return { txHash: pick(r, ["tx_hash", "txHash"]), raw: r };
  }

  async deliver(orderId, { type, text }) {
    const r = await this.client.deliverOrder(orderId, {
      deliverableType: type,
      deliverableText: text,
    });
    return { raw: r };
  }

  async getOrder(orderId) {
    if (typeof this.client.getOrder !== "function") return null;
    return this.client.getOrder(orderId);
  }

  async getDelivery(orderId) {
    const d = await this.client.getDelivery(orderId);
    return {
      type: pick(d, ["deliverable_type", "deliverableType", "type"]),
      text: pick(d, ["deliverable_text", "deliverableText", "text", "content"]),
      raw: d,
    };
  }

  async close() {
    try {
      if (this._stream && this._stream.close) this._stream.close();
    } catch (_) {
      /* ignore */
    }
    try {
      if (this.client.close) this.client.close();
    } catch (_) {
      /* ignore */
    }
    this._connected = false;
  }
}

function createAgent(cfg, { name } = {}) {
  const logger = new Logger(name || "agent", cfg.logLevel);
  let client;
  if (cfg.mode === "live") {
    assertLiveConfig(cfg);
    const sdk = loadSdk();
    const sdkConfig = {
      baseURL: cfg.baseURL,
      wsURL: cfg.wsURL,
      rpcURL: cfg.rpcURL,
      privateKey: cfg.privateKey,
      logger: console,
    };
    client = new sdk.AgentClient(sdkConfig, cfg.apiKey);
  } else {
    const { MockAgentClient } = require("./mock-sdk");
    client = new MockAgentClient(
      { ...cfg },
      cfg.apiKey || `croo_sk_mock_${name || "agent"}`,
    );
  }
  return new CapAgent({ client, mode: cfg.mode, logger, name });
}

// ---------------------------------------------------------------------------
// Conformance probe engine
// ---------------------------------------------------------------------------

// Weighted checks — sum to 100.
const CHECK_WEIGHTS = {
  "discovery.reachable": 15, // negotiateOrder returns a negotiation id
  "negotiation.accepted": 15, // provider accepts -> order_created
  "order.payable": 10, // payOrder accepted
  "payment.settled": 15, // escrow locked / tx returned
  "delivery.received": 20, // order_completed within SLA window
  "sla.met": 10, // delivery within the advertised SLA target
  "deliverable.present": 5, // non-empty deliverable
  "deliverable.valid": 10, // deliverable parses against advertised type
};

const RECOMMENDATIONS = {
  "discovery.reachable":
    "Service did not respond to negotiateOrder. Confirm it is listed/active on the Agent Store and the serviceId is correct.",
  "negotiation.accepted":
    "No order_created emitted. Ensure your agent listens for negotiation_created and calls acceptNegotiation().",
  "order.payable":
    "payOrder failed. Check the order amount/escrow config and that the requester AA wallet holds enough USDC.",
  "payment.settled":
    "Payment did not settle on Base. Verify CAPVault escrow and rpcURL connectivity.",
  "delivery.received":
    "No order_completed within the SLA window. Ensure your provider calls deliverOrder() and that the SLA is realistic.",
  "sla.met":
    "Delivery arrived but exceeded the SLA target. Optimize provider latency or raise the advertised SLA.",
  "deliverable.present":
    "Delivery contained no deliverableText/objectKey. Return a non-empty deliverable.",
  "deliverable.valid":
    "Deliverable failed validation. If you advertise application/json, return parseable JSON.",
};

class ProbeError extends Error {
  constructor(checkId, message) {
    super(message);
    this.name = "ProbeError";
    this.checkId = checkId;
  }
}

function scoreChecks(checks) {
  let got = 0;
  let total = 0;
  for (const c of checks) {
    total += c.weight;
    if (c.ok) got += c.weight;
  }
  const score = total ? Math.round((got / total) * 100) : 0;
  const grade =
    score >= 90
      ? "A"
      : score >= 80
        ? "B"
        : score >= 70
          ? "C"
          : score >= 60
            ? "D"
            : "F";
  return { score, grade };
}

function validateDeliverable(delivery, expectJson) {
  const text = delivery && delivery.text;
  if (!text) return { ok: false, detail: "no deliverable text" };
  const type = String(delivery.type || "").toLowerCase();
  const looksJson = expectJson || type.includes("json");
  if (looksJson) {
    try {
      JSON.parse(text);
      return { ok: true, detail: "valid JSON deliverable" };
    } catch (e) {
      return {
        ok: false,
        detail: "expected JSON but parse failed: " + e.message,
      };
    }
  }
  return { ok: true, detail: `non-empty ${type || "text"} deliverable` };
}

function buildSummary(report) {
  const passed = report.checks.filter((c) => c.ok).length;
  const head = `${report.target}: ${report.score}/100 (${report.grade}) — ${passed}/${report.checks.length} checks passed`;
  return report.error ? `${head}; aborted: ${report.error}` : head;
}

/**
 * Run a full CAP conformance probe against `targetServiceId`. The probe acts as a
 * requester: it negotiates, pays, waits for delivery, and validates the result,
 * timing each phase. Always resolves with a structured report (never throws).
 */
async function runProbe(agent, opts) {
  const {
    targetServiceId,
    requirements = {},
    expectJson = false,
    timeouts = {},
    logger,
  } = opts;
  const log = logger || agent.log;

  const T = {
    negotiate: timeouts.negotiate ?? 90_000,
    accept: timeouts.accept ?? 90_000,
    pay: timeouts.pay ?? 90_000,
    sla: timeouts.sla ?? 120_000, // hard ceiling waiting for delivery
    fetch: timeouts.fetch ?? 90_000,
    slaTargetMs: timeouts.slaTargetMs ?? 60_000, // "good" delivery threshold
  };

  const report = {
    tool: "CAPProbe",
    version: "1.0.0",
    target: targetServiceId,
    startedAt: new Date().toISOString(),
    requirements,
    phases: {},
    checks: [],
    score: 0,
    grade: "F",
    summary: "",
    recommendations: [],
    error: null,
  };

  const checkMap = {};
  const addCheck = (id, ok, detail, ms) => {
    const c = {
      id,
      weight: CHECK_WEIGHTS[id] ?? 0,
      ok: !!ok,
      detail: detail || "",
      ms: ms ?? null,
    };
    checkMap[id] = c;
    report.checks.push(c);
    log[ok ? "info" : "warn"](
      `check ${ok ? "PASS" : "FAIL"}: ${id}`,
      detail ? { detail } : undefined,
    );
    return c;
  };

  const t0 = Date.now();
  try {
    // Phase 1 — discovery + negotiation handshake
    const negStart = Date.now();
    const neg = await withTimeout(
      agent.negotiate({
        serviceId: targetServiceId,
        requirements: JSON.stringify(requirements),
      }),
      T.negotiate,
      "negotiateOrder",
    );
    if (!neg.negotiationId)
      throw new ProbeError(
        "discovery.reachable",
        "negotiateOrder returned no negotiation id",
      );
    addCheck(
      "discovery.reachable",
      true,
      `negotiation ${neg.negotiationId}`,
      Date.now() - negStart,
    );

    const res = await waitForFirst(
      agent,
      [
        {
          event: EV.ORDER_CREATED,
          predicate: (p) =>
            !neg.negotiationId ||
            !p.negotiationId ||
            p.negotiationId === neg.negotiationId,
        },
        { event: EV.NEGOTIATION_REJECTED, predicate: () => true },
        { event: EV.ORDER_REJECTED, predicate: () => true },
      ],
      T.accept,
      "order_created / negotiation_rejected",
    );
    if (res.event !== EV.ORDER_CREATED) {
      throw new ProbeError(
        "negotiation.accepted",
        `provider ${res.event}: ${res.payload.reason || "rejected"}`,
      );
    }
    report.phases.negotiationMs = Date.now() - negStart;
    const orderId = res.payload.orderId;
    if (!orderId)
      throw new ProbeError(
        "negotiation.accepted",
        "order_created carried no order id",
      );
    addCheck(
      "negotiation.accepted",
      true,
      `order ${orderId}`,
      report.phases.negotiationMs,
    );

    // Phase 2 — payment / escrow lock
    const payStart = Date.now();
    let payRes;
    try {
      payRes = await withTimeout(agent.pay(orderId), T.pay, "payOrder");
      addCheck(
        "order.payable",
        true,
        "payOrder accepted",
        Date.now() - payStart,
      );
    } catch (e) {
      addCheck("order.payable", false, e.message, Date.now() - payStart);
      throw e;
    }
    addCheck(
      "payment.settled",
      true,
      payRes.txHash ? `tx ${redact(payRes.txHash)}` : "escrow locked",
    );

    // Phase 3 — delivery within SLA
    const dres = await waitForFirst(
      agent,
      [
        { event: EV.ORDER_COMPLETED, predicate: (p) => p.orderId === orderId },
        { event: EV.ORDER_REJECTED, predicate: (p) => p.orderId === orderId },
        { event: EV.ORDER_EXPIRED, predicate: (p) => p.orderId === orderId },
      ],
      T.sla,
      "order_completed",
    );
    if (dres.event !== EV.ORDER_COMPLETED) {
      throw new ProbeError(
        "delivery.received",
        `order ${dres.event} before delivery`,
      );
    }
    const slaMs = Date.now() - payStart;
    report.phases.deliveryMs = slaMs;
    addCheck("delivery.received", true, "order_completed received", slaMs);
    addCheck(
      "sla.met",
      slaMs <= T.slaTargetMs,
      `${slaMs}ms vs target ${T.slaTargetMs}ms`,
      slaMs,
    );

    // Phase 4 — fetch + validate the deliverable
    const delivery = await withTimeout(
      agent.getDelivery(orderId),
      T.fetch,
      "getDelivery",
    );
    const hasText = !!(delivery.text && String(delivery.text).length);
    addCheck(
      "deliverable.present",
      hasText,
      hasText
        ? `type=${delivery.type || "n/a"}, ${String(delivery.text).length} bytes`
        : "empty deliverable",
    );
    const valid = validateDeliverable(delivery, expectJson);
    addCheck("deliverable.valid", valid.ok, valid.detail);
    report.delivery = {
      type: delivery.type || null,
      preview: hasText ? String(delivery.text).slice(0, 280) : null,
    };
  } catch (e) {
    report.error = e.message;
    // Record any not-yet-evaluated checks as failures so the score reflects reality.
    for (const id of Object.keys(CHECK_WEIGHTS)) {
      if (!checkMap[id]) {
        addCheck(
          id,
          false,
          e instanceof ProbeError && e.checkId === id
            ? e.message
            : "not reached",
        );
      }
    }
    log.error("probe aborted", { err: e.message });
  } finally {
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - t0;
    const { score, grade } = scoreChecks(report.checks);
    report.score = score;
    report.grade = grade;
    report.recommendations = report.checks
      .filter((c) => !c.ok)
      .map((c) => ({
        check: c.id,
        advice: RECOMMENDATIONS[c.id] || "Review this step.",
      }));
    report.summary = buildSummary(report);
  }

  return report;
}

module.exports = {
  // config
  loadEnv,
  loadConfig,
  assertLiveConfig,
  redact,
  // agent
  createAgent,
  CapAgent,
  // events + utils
  EV,
  sleep,
  withTimeout,
  waitForEvent,
  waitForFirst,
  // probe
  runProbe,
  scoreChecks,
  validateDeliverable,
  CHECK_WEIGHTS,
};
