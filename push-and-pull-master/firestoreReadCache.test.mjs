import test from "node:test";
import assert from "node:assert/strict";

import {
  cacheFirestoreRead,
  getDocsCached,
} from "./firestoreReadCache.js";

test("short-lived reads deduplicate concurrent and recent requests", async () => {
  let calls = 0;
  const read = () => cacheFirestoreRead("student:users/1", async () => {
    calls += 1;
    return { value: calls };
  }, 30);

  const [first, concurrent] = await Promise.all([read(), read()]);
  assert.equal(first, concurrent);
  assert.equal(calls, 1);
  assert.equal(await read(), first);
  assert.equal(calls, 1);

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.notEqual(await read(), first);
  assert.equal(calls, 2);
});

test("failed quota reads are not cached or automatically retried", async () => {
  let calls = 0;
  await assert.rejects(
    cacheFirestoreRead("student:users/2", async () => {
      calls += 1;
      throw Object.assign(new Error("quota exhausted"), { code: "resource-exhausted" });
    }),
    { code: "resource-exhausted" },
  );

  const result = await cacheFirestoreRead("student:users/2", async () => {
    calls += 1;
    return "available";
  });

  assert.equal(result, "available");
  assert.equal(calls, 2);
});

test("query reads deduplicate only when both query key and user scope match", async () => {
  let calls = 0;
  const getDocs = async (query) => {
    calls += 1;
    return query.value;
  };
  const read = (scope, key) => getDocsCached(
    getDocs,
    { value: `${scope}:${key}` },
    key,
    scope,
    30,
  );

  const [first, concurrent] = await Promise.all([
    read("uid-1", "registrations:event-1"),
    read("uid-1", "registrations:event-1"),
  ]);
  assert.equal(first, "uid-1:registrations:event-1");
  assert.equal(concurrent, first);
  assert.equal(await read("uid-1", "registrations:event-2"), "uid-1:registrations:event-2");
  assert.equal(await read("uid-2", "registrations:event-1"), "uid-2:registrations:event-1");
  assert.equal(calls, 3);
});
