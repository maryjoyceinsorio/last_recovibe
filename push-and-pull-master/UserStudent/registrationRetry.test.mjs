import test from "node:test";
import assert from "node:assert/strict";
import { retryResourceExhausted } from "./firestoreRetry.js";

test("Firestore operations retry resource exhaustion with bounded backoff", async () => {
  let attempts = 0;
  const delays = [];
  const result = await retryResourceExhausted(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error("Too many requests");
        error.code = "resource-exhausted";
        throw error;
      }
      return "written";
    },
    async (milliseconds) => delays.push(milliseconds),
  );

  assert.equal(result, "written");
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [250, 500]);
});

test("Firestore operations do not retry permanent errors", async () => {
  let attempts = 0;
  const error = Object.assign(new Error("Permission denied"), {
    code: "permission-denied",
  });

  await assert.rejects(
    retryResourceExhausted(async () => {
      attempts += 1;
      throw error;
    }, async () => {}),
    error,
  );
  assert.equal(attempts, 1);
});

test("Firestore retries stop after three transient failures", async () => {
  let attempts = 0;
  const error = Object.assign(new Error("Resource exhausted"), {
    code: "resource-exhausted",
  });

  await assert.rejects(
    retryResourceExhausted(async () => {
      attempts += 1;
      throw error;
    }, async () => {}),
    error,
  );
  assert.equal(attempts, 3);
});
