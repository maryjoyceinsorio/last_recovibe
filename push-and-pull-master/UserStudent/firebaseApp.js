import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

const RTDB_URL = "https://recovibe-v1-default-rtdb.asia-southeast1.firebasedatabase.app";

export const firebaseConfig = {
  apiKey: "AIzaSyDKozGFtnSiE6EzmSzpxe8-dZv7aH1HfnE",
  authDomain: "recovibe-v1.firebaseapp.com",
  projectId: "recovibe-v1",
  storageBucket: "recovibe-v1.firebasestorage.app",
  messagingSenderId: "79140044760",
  appId: "1:79140044760:web:8523fc92592e3555fefcad",
  databaseURL: RTDB_URL,
};

export const isFirebaseConfigured = Object.values(firebaseConfig).every(
  (value) => value && !value.startsWith("YOUR_"),
);

const matchingApp = getApps().find(
  (candidate) =>
    candidate.name === "[DEFAULT]" &&
    candidate.options.appId === firebaseConfig.appId,
);

export const app = isFirebaseConfigured
  ? matchingApp || initializeApp(firebaseConfig)
  : null;
