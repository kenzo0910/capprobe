"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { scoreChecks, validateDeliverable } = require("../src/core");

test("scoreChecks: all pass -> 100 / A", () => {
  const { score, grade } = scoreChecks([
    { weight: 50, ok: true },
    { weight: 50, ok: true },
  ]);
  assert.strictEqual(score, 100);
  assert.strictEqual(grade, "A");
});

test("scoreChecks: proportional weighting", () => {
  const { score, grade } = scoreChecks([
    { weight: 75, ok: true },
    { weight: 25, ok: false },
  ]);
  assert.strictEqual(score, 75);
  assert.strictEqual(grade, "C");
});

test("scoreChecks: all fail -> 0 / F", () => {
  const { score, grade } = scoreChecks([{ weight: 100, ok: false }]);
  assert.strictEqual(score, 0);
  assert.strictEqual(grade, "F");
});

test("scoreChecks: empty -> 0 / F (no divide-by-zero)", () => {
  const { score, grade } = scoreChecks([]);
  assert.strictEqual(score, 0);
  assert.strictEqual(grade, "F");
});

test('validateDeliverable: JSON text in a "text" deliverable passes', () => {
  assert.strictEqual(
    validateDeliverable({ type: "text", text: '{"a":1}' }).ok,
    true,
  );
});

test("validateDeliverable: invalid JSON fails when JSON is expected", () => {
  assert.strictEqual(
    validateDeliverable({ type: "text", text: "not json" }, true).ok,
    false,
  );
});

test("validateDeliverable: empty deliverable fails", () => {
  assert.strictEqual(validateDeliverable({ type: "text", text: "" }).ok, false);
});

test("validateDeliverable: non-JSON plain text passes when JSON not required", () => {
  assert.strictEqual(
    validateDeliverable({ type: "text", text: "hello world" }).ok,
    true,
  );
});

test("validateDeliverable: schema-only deliverable is accepted", () => {
  assert.strictEqual(
    validateDeliverable({ type: "schema", schema: '{"type":"object"}' }).ok,
    true,
  );
});
