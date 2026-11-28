import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { app, firebaseConfig, isFirebaseConfigured } from "./firebaseApp.js";
import {
  startActiveSessionAccessGuard,
  startPortalRoleGuard,
} from "../systemAccess.js";

export { app, isFirebaseConfigured };

export const auth = app ? getAuth(app) : null;
export const authReady = auth
  ? auth.authStateReady().then(() => undefined)
  : Promise.resolve();
export const db = app ? getFirestore(app) : null;

let rtdbInstance = null;
if (app && firebaseConfig.databaseURL) {
  try {
    rtdbInstance = getDatabase(app, firebaseConfig.databaseURL);
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
startPortalRoleGuard(auth, db);