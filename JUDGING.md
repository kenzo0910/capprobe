# CAPProbe — self‑review & simulated judging

This document does two things: (1) a hard‑nosed engineering self‑review, and (2) a simulation of
how the CROO judges' rubric would likely score this submission, with the reasoning behind each
number. It is written to be _useful to the team_, not flattering.

---

## 1. Simulated judge scorecard

Rubric weights from the hackathon: Technical 30 · A2A Composability 25 · Innovation 20 ·
Usability 15 · Presentation 10.

| Criterion                | Weight | Self‑estimate |     Weighted     | Why                                                                                                                                                                                                                                                                                           |
| ------------------------ | :----: | :-----------: | :--------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Technical Execution**  |  30%   |   8.5 / 10    |       25.5       | Clean adapter over the real SDK with one normalized surface; full error handling (timeouts, fast‑fail on rejection, crash‑proof handlers); zero‑dep offline harness; secret redaction; passing e2e + failure‑path tests. Loses points until live mainnet settlement is demonstrated on video. |
| **A2A Composability**    |  25%   |   9.5 / 10    |      23.75       | The product's _core function is calling other agents_. One purchase = a 3‑hop A2A chain with two USDC settlements, exercising every CAP primitive from both requester and provider sides. Hard to beat on this axis.                                                                          |
| **Innovation**           |  20%   |   8.5 / 10    |       17.0       | "An agent that tests agents" / Stripe‑test‑mode for the agent economy is a genuinely new meta‑service and a flywheel (more agents → more need for conformance). Not a wrapper around an LLM.                                                                                                  |
| **Usability & Adoption** |  15%   |   8.0 / 10    |       12.0       | `git clone && node scripts/test-local.js` works with no install/keys; one‑line CLI to audit any agent; actionable recommendations on every failure; clear README. Adoption ceiling depends on Agent Store discovery.                                                                          |
| **Presentation**         |  10%   |   7.5 / 10    |       7.5        | README + diagram + scored report are strong; score pending the recorded Demo Day pitch.                                                                                                                                                                                                       |
| **Total**                |  100%  |       —       | **≈ 85.8 / 100** | Competitive for a top‑10 placement; top‑3 hinges on a crisp live demo.                                                                                                                                                                                                                        |

> This is the author's self‑estimate. An **independent 3‑judge panel (simulated) scored 79.3/100**
> _before_ the §7 hardening pass — its deductions were almost entirely the not‑yet‑recorded live
> demo + mainnet run, not code. Treat ~79–86 as the realistic band; the live video is the lever that
> moves it. Estimate is deliberately conservative on Technical/Presentation because those are gated
> on the live video + mainnet run, which are the remaining to‑dos (see §4).

## 2. Strengths (what to lean on in the pitch)

- **Composability is demonstrable, not asserted.** The demo _prints_ both settlements happening.
- **It is real developer tooling.** Every CAP builder is a customer; it gets more valuable as the
  ecosystem grows (anti‑commodity).
- **Quality signals judges notice:** failure‑path test, fast‑fail (32 ms vs a 90 s hang), secret
  redaction, no runtime dependencies, deterministic CI.
- **Honest reporting.** The tool grades _F_ when an agent is broken — it is a real instrument, not
  a happy‑path script.

## 3. Risks & weaknesses (and mitigations)

| Risk                                                            | Severity | Mitigation                                                                                                                                                           |
| --------------------------------------------------------------- | :------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact `@croo-network/sdk` field/event names drift from the docs |   Med    | Adapter subscribes to every alias (`order_paid`/`OrderPaid`/enum) and normalizes payload keys; a drift is a one‑line change in `SDK_EVENT_ALIASES` / `pick()` lists. |
| Live mainnet settlement not yet recorded                        |   Med    | Pre‑live checklist in §4; mock is a faithful state‑machine stand‑in for the demo.                                                                                    |
| Probing costs real USDC in live mode                            |   Low    | By design (it's a real order); documented; use a tiny `PROBE_PRICE_USDC` and probe agents you own.                                                                   |
| Single‑sample latency could be noisy                            |   Low    | Roadmap: N‑sample p50/p95. Current SLA check uses a generous target + hard ceiling.                                                                                  |
| "Tests agents" could be seen as niche                           |   Low    | Frame as infra/CI for the whole ecosystem; pair with the reputation‑feed roadmap.                                                                                    |

## 4. Pre‑live verification checklist (before mainnet + video)

Run these once with real credentials (`CROO_MODE=live`) and capture output for the video:

1. `npm install @croo-network/sdk` and confirm `AgentClient` constructs with `{ baseURL, wsURL, rpcURL }` + the `croo_sk_…` SDK‑Key (no `privateKey` in the Config — the AA wallet is server‑side). The `test/sdk-contract.test.js` assertion already verifies this against the installed types.
2. Register `capprobe.conformance.v1` on the Agent Store; fund the AA wallet with USDC on Base.
3. Confirm `connectWebSocket()` routes events to `stream.onAny`; if the wire `event.type` names differ, adjust `EV` in `core.js` (the contract test will flag the mismatch).
4. `CROO_MODE=live npm run start:provider`, then from another wallet hire it; verify two on‑chain USDC settlements on BaseScan.
5. `CROO_MODE=live npm run probe -- <a real agent>` and confirm the report grades correctly.
6. Re‑run `npm test` (mock) to prove the regression suite still passes.

## 5. Anticipated judge Q&A

- **"Isn't the mock just faking the demo?"** No — the mock is the _offline test harness_ (so anyone
  can reproduce with zero setup/CI). Live mode uses the real SDK through the identical `CapAgent`
  surface; only the transport swaps. The video shows the live path.
- **"Where's the real A2A?"** CAPProbe pays the agent it probes. The demo logs both settlements;
  on mainnet they're two USDC transfers on Base.
- **"Why would anyone pay for this?"** Same reason teams pay for CI and uptime checks: shipping a
  paid agent that silently fails to deliver burns money and reputation. CAPProbe is the pre‑flight.

## 6. Demo video script (≤ 5 min)

> A 60-second auto-generated cut covering the offline run + architecture ships in the repo at
> [`docs/demo.mp4`](docs/demo.mp4). Append the live-on-Base segment (step 3) — a screen capture of
> `npm run demo:full` against your registered agents + the two USDC settlements on BaseScan — to
> reach the full ≤5-min cut.

1. **0:00 – 0:40 — Problem.** "CAP makes every agent a paid endpoint. How do you know yours
   actually negotiates, settles, and delivers — before customers and USDC hit it?"
2. **0:40 – 1:40 — Offline demo.** `node scripts/test-local.js`; narrate the 3‑hop chain and the
   100/A report. Then point it at a broken agent → 15/F with fixes. "It's a real instrument."
3. **1:40 – 3:30 — Live on Base.** Provider running; hire CAPProbe from a second wallet; show two
   USDC settlements on BaseScan; open the delivered JSON report.
4. **3:30 – 4:30 — Why it composes.** The architecture diagram; every CAP primitive used from both
   sides; the reputation‑feed roadmap (agents reading each other's conformance before transacting).
5. **4:30 – 5:00 — Close.** Agent Store listing + GitHub + MIT. "Stripe test‑mode for the agent
   economy."

## 7. Post‑review hardening (what changed after an adversarial pass)

The repo was put through a multi‑agent adversarial review (independent reviewers across
correctness, A2A‑integrity, security, SDK‑fidelity, docs, and test‑coverage, each finding
adversarially verified, plus a 3‑judge panel). Consensus weighted score: **79.3/100** before the
fixes below — the panel's top risks were all live‑path / not‑yet‑recorded items, not code defects.
Confirmed findings that were fixed:

- **Reconciled the adapter against the real `@croo-network/sdk@0.2.1`** (installed + type‑checked):
  negotiation events are `order_negotiation_*`; `acceptNegotiation` returns `{ negotiation, order }`
  (orderId nested); requirements live on the Negotiation; `Config` has no private key;
  `deliverableType` is `text`/`schema`. A `test/sdk-contract.test.js` tripwire now asserts this in CI.
- **Security:** SDK‑internal logs now route through the redacting `Logger` (no raw tx hashes via
  `console`); `.gitignore` covers `.env.*` (keeps `.env.example`); `action.yml` passes the
  service‑id via env (no shell injection); the mock no longer receives secrets in its config;
  redaction key‑list widened (`sdkKey`/`token`/`bearer`/`authorization`).
- **Rigor:** `payment.settled` now requires a settlement tx hash instead of passing unconditionally
  (a conformance tool must not credit a settlement it can't evidence). Every Phase‑1 event waiter is
  scoped to its own negotiation id, closing a cross‑order race on the shared provider agent.
- **Tests:** 22 passing (added SLA‑miss, invalid‑JSON deliverable, and stable‑denominator back‑fill
  cases). **Docs:** stale `privateKey` constructor claims removed; `MIN_SCORE` documented;
  `registerService` now WARNs in live mode.

Remaining (live‑only, require credentials + a recorded run): mainnet settlement evidence on
BaseScan, the demo video, the Agent Store listing, and fund‑transfer‑service support.
