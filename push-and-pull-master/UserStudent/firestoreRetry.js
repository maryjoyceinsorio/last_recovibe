export function isResourceExhausted(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return code.includes("resource-exhausted") ||
    code === "429" ||
    /\b429\b/.test(message) ||
    message.includes("too many requests");
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function retryResourceExhausted(operation, delay = wait) {
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isResourceExhausted(error) || attempt === maxAttempts - 1) {
        throw error;
      }
      await delay(250 * (2 ** attempt));
    }
  }
}
