const reads = new Map();
const DEFAULT_TTL_MS = 1500;
const MAX_CACHE_ENTRIES = 256;

function pruneExpiredReads(now) {
  for (const [key, entry] of reads) {
    if (entry.expiresAt !== null && entry.expiresAt <= now) reads.delete(key);
  }
  while (reads.size > MAX_CACHE_ENTRIES) {
    const completedKey = [...reads].find(([, entry]) => entry.expiresAt !== null)?.[0];
    if (!completedKey) return;
    reads.delete(completedKey);
  }
}

export function cacheFirestoreRead(key, operation, ttlMs = DEFAULT_TTL_MS) {
  const cacheKey = String(key);
  const now = Date.now();
  pruneExpiredReads(now);
  const cached = reads.get(cacheKey);
  if (cached && (cached.expiresAt === null || cached.expiresAt > now)) {
    return cached.promise;
  }
  if (cached) reads.delete(cacheKey);

  const entry = { promise: null, expiresAt: null };
  const request = Promise.resolve()
    .then(operation)
    .then((value) => {
      entry.expiresAt = Date.now() + Math.max(0, ttlMs);
      return value;
    })
    .catch((error) => {
      if (reads.get(cacheKey) === entry) reads.delete(cacheKey);
      throw error;
    });
  entry.promise = request;
  reads.set(cacheKey, entry);
  pruneExpiredReads(Date.now());
  return request;
}

export function getDocCached(getDocImplementation, documentRef, uid, ttlMs) {
  const scope = String(uid || "anonymous");
  return cacheFirestoreRead(
    `${scope}:doc:${documentRef.path}`,
    () => getDocImplementation(documentRef),
    ttlMs,
  );
}

export function getDocsCached(getDocsImplementation, queryRef, key, scope, ttlMs) {
  return cacheFirestoreRead(
    `${String(scope || "anonymous")}:query:${String(key)}`,
    () => getDocsImplementation(queryRef),
    ttlMs,
  );
}

export function invalidateDocCache(documentRef, uid) {
  reads.delete(`${String(uid || "anonymous")}:doc:${documentRef.path}`);
}
