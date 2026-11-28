let lastIssuedAt = 0;
let qrLibraryLoadPromise = null;
const sharedQrPayloads = new Map();
const sharedQrPayloadMaxAge = 4 * 60 * 1000; // Reissue before the scanner's five-minute limit.

function createNonce() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();

  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createAttendanceQrPayload({
  user,
  eventId = "",
  eventName = "",
  registrationStatus,
}) {
  const uid = String(user?.uid || "").trim();
  const cleanEventId = String(eventId || "").trim();
  if (!uid) throw new Error("Sign in to load your attendance QR code.");
  lastIssuedAt = Math.max(Date.now(), lastIssuedAt + 1);

  return JSON.stringify({
    type: "recovibe-attendance",
    version: 1,
    uid,
    email: String(user?.email || "").trim(),
    eventId: cleanEventId,
    eventName: String(eventName || "").trim(),
    registrationStatus: registrationStatus || (cleanEventId ? "registered" : "profile"),
    issuedAt: lastIssuedAt,
    nonce: createNonce(),
  });
}

function isReusableSharedQrPayload(rawPayload, uid, now) {
  try {
    const payload = JSON.parse(rawPayload);
    const age = now - payload.issuedAt;
    return payload.type === "recovibe-attendance" &&
      payload.version === 1 &&
      payload.uid === uid &&
      !String(payload.eventId || "").trim() &&
      payload.registrationStatus === "profile" &&
      typeof payload.issuedAt === "number" &&
      Number.isFinite(payload.issuedAt) &&
      Boolean(String(payload.nonce || "").trim()) &&
      age >= -60 * 1000 &&
      age < sharedQrPayloadMaxAge;
  } catch {
    return false;
  }
}

export function getSharedAttendanceQrPayload(user, { forceRefresh = false } = {}) {
  const uid = String(user?.uid || "").trim();
  if (!uid) throw new Error("Sign in to load your attendance QR code.");

  const storageKey = `recovibeAttendanceQr:${uid}`;
  if (!forceRefresh) {
    const now = Date.now();
    const cachedPayloads = [sharedQrPayloads.get(uid)];
    try {
      cachedPayloads.push(globalThis.localStorage?.getItem(storageKey) || "");
    } catch (error) {
      console.warn("[Attendance QR] Could not read the shared QR cache:", error);
    }

    const reusablePayload = cachedPayloads.find((payload) =>
      payload && isReusableSharedQrPayload(payload, uid, now),
    );
    if (reusablePayload) {
      sharedQrPayloads.set(uid, reusablePayload);
      return reusablePayload;
    }
  }

  const payload = createAttendanceQrPayload({
    user,
    registrationStatus: "profile",
  });
  sharedQrPayloads.set(uid, payload);
  try {
    globalThis.localStorage?.setItem(storageKey, payload);
  } catch (error) {
    console.warn("[Attendance QR] Could not persist the shared QR cache:", error);
  }
  return payload;
}

export function parseAttendanceQrPayload(rawToken, eventId) {
  const text = String(rawToken || "").trim();
  if (!text.startsWith("{")) return null;

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  if (payload?.type !== "recovibe-attendance") return null;
  if (payload.version !== 1 || !String(payload.uid || "").trim()) {
    throw new Error("This attendance QR code has an invalid payload.");
  }
  const payloadEventId = String(payload.eventId || "").trim();
  if (!payloadEventId && payload.registrationStatus !== "profile") {
    throw new Error("This attendance QR code has no event context.");
  }
  if (payloadEventId && payloadEventId !== String(eventId || "")) {
    throw new Error("This QR code was generated for a different event.");
  }
  return payload;
}

async function getQrCodeLibrary() {
  if (typeof globalThis.QRCode?.toCanvas === "function") return globalThis.QRCode;
  if (!qrLibraryLoadPromise) {
    qrLibraryLoadPromise = import("https://esm.sh/qrcode@1.5.4")
      .then((module) => {
        const library = module.default || module;
        if (typeof library.toCanvas !== "function") {
          throw new Error("QR code library is unavailable.");
        }
        return library;
      })
      .catch((error) => {
        qrLibraryLoadPromise = null;
        throw error;
      });
  }
  return qrLibraryLoadPromise;
}

export async function createAttendanceQrCanvas(
  payload,
  width,
  { margin = 2, errorCorrectionLevel = "M" } = {},
) {
  const cleanPayload = String(payload || "").trim();
  if (!cleanPayload) throw new Error("Your QR code data is empty. Please try again.");
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error("The QR code size is invalid.");
  }

  const library = await getQrCodeLibrary();
  const stagedCanvas = document.createElement("canvas");
  await library.toCanvas(stagedCanvas, cleanPayload, {
    width,
    margin,
    color: { dark: "#000000", light: "#ffffff" },
    errorCorrectionLevel,
  });
  if (!stagedCanvas.width || !stagedCanvas.height) {
    throw new Error("Your QR code could not be generated. Please try again.");
  }
  return stagedCanvas;
}

export function commitAttendanceQrCanvas(canvas, stagedCanvas, displayWidth) {
  const context = canvas?.getContext("2d");
  if (!context) throw new Error("Your QR code could not be displayed. Please try again.");
  canvas.width = stagedCanvas.width;
  canvas.height = stagedCanvas.height;
  context.drawImage(stagedCanvas, 0, 0);
  if (Number.isFinite(displayWidth) && displayWidth > 0) {
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayWidth}px`;
  }
}

export async function renderAttendanceQr(
  canvas,
  payload,
  { width = 260, displayWidth = width, margin = 2, errorCorrectionLevel = "M" } = {},
) {
  if (!canvas || typeof canvas.getContext !== "function" || !canvas.getContext("2d")) {
    throw new Error("The attendance QR code canvas is unavailable.");
  }
  const stagedCanvas = await createAttendanceQrCanvas(payload, width, {
    margin,
    errorCorrectionLevel,
  });
  commitAttendanceQrCanvas(canvas, stagedCanvas, displayWidth);
  return canvas;
}
