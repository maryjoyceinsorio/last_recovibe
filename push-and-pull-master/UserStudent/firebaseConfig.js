import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { startActiveSessionAccessGuard } from "../systemAccess.js";

const RTDB_URL = "https://recovibe-v1-default-rtdb.asia-southeast1.firebasedatabase.app";

const firebaseConfig = {
  apiKey: "AIzaSyDKozGFtnSiE6EzmSzpxe8-dZv7aH1HfnE",
  authDomain: "recovibe-v1.firebaseapp.com",
  projectId: "recovibe-v1",
  storageBucket: "recovibe-v1.firebasestorage.app",
  messagingSenderId: "79140044760",
  appId: "1:79140044760:web:8523fc92592e3555fefcad",
  databaseURL: RTDB_URL,
};

export const isFirebaseConfigured = Object.values(firebaseConfig).every(
  (value) => value && !value.startsWith("YOUR_")
);

const matchingApp = getApps().find(
  (candidate) =>
    candidate.name === "[DEFAULT]" &&
    candidate.options.appId === firebaseConfig.appId,
);
export const app = isFirebaseConfigured
  ? matchingApp || initializeApp(firebaseConfig)
  : null;

export const auth = app ? getAuth(app) : null;
export const authReady = auth
  ? auth.authStateReady().then(() => undefined)
  : Promise.resolve();
export const db = app ? getFirestore(app) : null;

let rtdbInstance = null;
if (app && firebaseConfig.databaseURL) {
  try {
    rtdbInstance = getDatabase(app, RTDB_URL);
  } catch (error) {
    console.error("[Firebase] Realtime Database initialization failed:", {
      code: error?.code || "unknown",
      message: error?.message || String(error),
    });
  }
}
export const rtdb = rtdbInstance;
export const isRtdbConfigured = Boolean(rtdbInstance);

let functionsInstance = null;
if (app) {
  try {
    functionsInstance = getFunctions(app, "asia-southeast1");
  } catch (err) {
    console.warn("Functions initialization error:", err);
  }
}
export const functions = functionsInstance;

startActiveSessionAccessGuard(auth, db);