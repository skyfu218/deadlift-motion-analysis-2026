import test from "node:test";
import assert from "node:assert/strict";
import { angle, detectReps } from "../src/analysis.js";

test("angle returns a right angle", () => {
  assert.equal(Math.round(angle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })), 90);
});

test("detectReps finds one complete down-up-down hip cycle", () => {
  const ys = [0.72, 0.71, 0.68, 0.58, 0.46, 0.36, 0.31, 0.3, 0.34, 0.45, 0.58, 0.69, 0.72];
  const frames = ys.map((hipY, i) => ({ time: i * 0.2, hipY, confidence: 0.9, hipAngle: 80 + i, kneeAngle: 90 + i, trunkAngle: 35 + i * 0.2 }));
  const reps = detectReps(frames);
  assert.equal(reps.length, 1);
  assert.ok(reps[0].liftSeconds > 0);
  assert.ok(reps[0].lowerSeconds > 0);
});
