# CAPProbe — DoraHacks BUIDL submission

Paste the fields below into the DoraHacks BUIDL form for the CROO Agent Hackathon.

- **Name:** CAPProbe
- **Tagline:** The conformance & smoke-test agent for CAP — Stripe test-mode for the agent economy.
- **Track:** Developer Tooling
- **Repo (MIT):** https://github.com/kenzo0910/capprobe
- **Demo video:** `docs/demo.mp4` in the repo (upload to YouTube/Loom and paste the link)
- **Agent Store listing:** `<paste your CAPProbe service URL/ID after registering>`

## Description

CAPProbe is a paid CROO agent that conformance-tests **other** CAP agents. A customer hires it, and
to fulfil the order CAPProbe itself becomes a requester and runs the full **negotiate → pay →
deliver** lifecycle against a target agent, returning a scored JSON health report with actionable
fixes. One purchase produces a three-hop, agent-to-agent-to-agent chain with **two USDC settlements
on Base** — composability you can watch, not just claim.

**Why it matters.** CAP turns every agent into a paid endpoint, but there's no easy way to answer
_"is my agent actually correct?"_ before customers and real USDC hit it. Does it accept
negotiations? Settle escrow? Deliver within SLA? Return a valid deliverable? CAPProbe is the
pre-flight: it grades the target **A–F across 8 weighted checks** and ships a concrete fix for every
failure. It fails fast and honestly — a broken agent scores 15/F with the exact reason — so it's a
real instrument, not a happy-path script.

**Adoption.** CAPProbe also ships as a reusable **GitHub Action**, so any team can gate CI on
conformance and block a deploy whenever their agent stops conforming.

## How it uses CAP

- Built on `@croo-network/sdk` (verified against v0.2.1 by an automated SDK-contract test).
- Exercises every CAP primitive from **both** sides in one run: `negotiateOrder`,
  `acceptNegotiation`, `payOrder`, `deliverOrder`, `getDelivery`, with events over the WebSocket
  stream and **USDC settlement on Base** via CAPVault escrow.
- The probe (CAPProbe acting as requester) + the customer (acting as requester to CAPProbe) =
  the two on-chain settlements that prove A2A composability.

## Try it (zero install, no keys)

```bash
git clone https://github.com/kenzo0910/capprobe && cd capprobe
node scripts/test-local.js     # full 3-hop A2A chain over an in-process mock → 100/100 (A)
npm test                       # 22/22 unit + SDK-contract + e2e
```

## Status & evidence

- 22/22 tests passing; CI green on Node 18/20/22.
- Adapter verified against the real `@croo-network/sdk@0.2.1` (drift tripwire in CI).
- Hardened via an adversarial multi-agent review (security, rigor, docs) — see `JUDGING.md`.
- Live mainnet run (two USDC settlements) is run from your registered agents — see `HUONG_DAN.md`.
