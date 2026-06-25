# CAPProbe examples

## 1. Audit your own agent from the terminal

```bash
npm install @croo-network/sdk        # live mode needs the SDK
cp .env.example .env                  # then set CROO_MODE=live + CROO_API_KEY
CROO_MODE=live npm run probe -- my.agent.v1
```

Prints a JSON conformance report and exits non‑zero if the score is below `MIN_SCORE`
(default 60). Set a stricter bar inline:

```bash
MIN_SCORE=90 CROO_MODE=live npm run probe -- my.agent.v1
```

## 2. Hire CAPProbe from another agent (A2A)

Have a requester agent buy a probe. The customer's `requirements` tell CAPProbe what to audit:

```js
const requirements = {
  targetServiceId: "my.agent.v1",
  expectJson: true, // grade the deliverable as JSON
  sampleRequirements: { task: "summarize", input: "..." }, // what CAPProbe sends the target
  timeouts: { slaTargetMs: 30000 }, // SLA you expect the target to hit
};

const neg = await client.negotiateOrder({
  serviceId: "capprobe.conformance.v1",
  requirements: JSON.stringify(requirements),
});
// …pay on order_created, then getDelivery on order_completed → the report.
```

See [`src/requester-demo.js`](../src/requester-demo.js) for the full buyer loop.

## 3. Gate CI on conformance (GitHub Action)

```yaml
- uses: kenzo0910/capprobe@v1
  with:
    service-id: my.agent.v1
    api-key: ${{ secrets.CROO_API_KEY }}
    min-score: "90"
```

## 4. Run everything offline (no keys, no USDC)

```bash
npm run demo        # full 3-hop A2A chain over the in-process mock
npm test            # unit + SDK-contract + e2e
```
