import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  getDocCached,
  getDocsCached,
  invalidateDocCache,
} from "./firestoreReadCache.js";

const PROFILE_COLLECTIONS = {
  student: ["users", "students"],
  eventorganizer: ["adminUser", "users", "eventOrganizations"],
  teacher: ["adminUser"],
  admin: ["adminUser", "users"],
  superadmin: ["adminUser", "users"],
  all: ["adminUser", "users", "eventOrganizations"],
};

const ROLE_ALIASES = {
  student: ["student"],
  eventorganizer: ["eventorganizer", "organizer", "eo"],
  teacher: ["teacher", "teacheradviser", "faculty", "adviser"],
  admin: ["admin", "osas"],
  superadmin: ["superadmin"],
};

const emailSyncs = new Map();

export function normalizePortalRole(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function profileCollectionsForRole(role) {
  return PROFILE_COLLECTIONS[normalizePortalRole(role)] || [];
}

export function mobileDigits(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 11);
}

export function formatPhilippineMobile(value) {
  const digits = mobileDigits(value);
  if (digits.length <= 4) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
}

export function isValidPhilippineMobile(value) {
  return /^09\d{9}$/.test(mobileDigits(value));
}

function roleMatches(data, role, collectionName) {
  const normalizedRole = normalizePortalRole(data.role || data.userRole);
  if (role === "all") {
    return Object.values(ROLE_ALIASES).flat().includes(normalizedRole);
  }
  if (role === "student" && collectionName === "students" && !normalizedRole) return true;
  if (role === "student" && collectionName === "users" && !normalizedRole) {
    return [
      data.studentNumber,
      data.student_number,
      data.studentNo,
      data.student_no,
      data.studentId,
    ].some((value) => String(value || "").trim());
  }
  if (ROLE_ALIASES[role]?.includes(normalizedRole)) return true;
  return role === "eventorganizer" &&
    collectionName === "eventOrganizations" &&
    Boolean(String(data.organizationCode || "").trim());
}

async function findProfileRecords(db, uid, role, collections = profileCollectionsForRole(role)) {
  role = normalizePortalRole(role);
  const reads = await Promise.allSettled(
    collections.map(async (collectionName) => {
      const profileRef = doc(db, collectionName, uid);
      const snapshot = await getDocCached(getDoc, profileRef, uid);
      return snapshot.exists()
        ? { collectionName, profileRef, data: snapshot.data() }
        : null;
    }),
  );
  const failures = reads
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);
  const records = reads
    .filter((result) => result.status === "fulfilled" && result.value)
    .map((result) => result.value);
  const matchingRecords = records.filter((record) =>
    roleMatches(record.data, role, record.collectionName),
  );
  const directRoleMatches = matchingRecords.filter((record) =>
    record.collectionName !== "eventOrganizations",
  );
  const selectedRecords = directRoleMatches.length
    ? directRoleMatches
    : matchingRecords;

  if (!selectedRecords.length && failures.length) throw failures[0];
  if (!selectedRecords.length) {
    throw new Error(`No ${role} profile record was found for this account.`);
  }

  const untypedUserRecords = records.filter((record) =>
    record.collectionName === "users" &&
    !String(record.data.role || record.data.userRole || "").trim(),
  );
  return [...selectedRecords, ...untypedUserRecords];
}

export async function savePendingProfileEmail(db, uid, role, email, collections) {
  const records = await findProfileRecords(db, uid, role, collections);
  await Promise.all(records.map(async ({ profileRef }) => {
    await updateDoc(profileRef, { pendingEmail: email });
    invalidateDocCache(profileRef, uid);
  }));
}

export async function saveProfileFields(db, uid, role, fields, collections) {
  const records = await findProfileRecords(db, uid, role, collections);
  await Promise.all(records.map(async ({ profileRef }) => {
    await updateDoc(profileRef, fields);
    invalidateDocCache(profileRef, uid);
  }));
}

async function syncVerifiedProfileEmailOnce(auth, db, user, role, collections, rtdb) {
  role = normalizePortalRole(role);
  await user.reload();
  const currentUser = auth?.currentUser;
  const email = String(currentUser?.email || "").trim();
  if (
    !currentUser ||
    currentUser.uid !== user.uid ||
    !currentUser.emailVerified ||
    !email
  ) return null;

  const records = await findProfileRecords(db, user.uid, role, collections);
  const normalizedEmail = email.toLowerCase();
  const profileUpdates = records.map(async ({ collectionName, profileRef, data }) => {
    const updates = {};
    if (String(data.email || "").trim().toLowerCase() !== normalizedEmail) {
      updates.email = email;
    }
    if (String(data.pendingEmail || "").trim().toLowerCase() === normalizedEmail) {
      updates.pendingEmail = deleteField();
    }
    if (Object.keys(updates).length) {
      await updateDoc(profileRef, updates);
      invalidateDocCache(profileRef, user.uid);
    }
    return { collectionName, changed: Object.keys(updates).length > 0 };
  });
  const results = await Promise.all(profileUpdates);
  if (rtdb && role === "student") {
    try {
      await update(ref(rtdb, `users/${user.uid}`), { email });
    } catch (error) {
      console.warn("[Profile account] Could not sync the Realtime Database email:", error);
    }
  }

  const localPendingKey = `recovibe_pending_email_${user.uid}`;
  let localPendingEmail = "";
  try {
    localPendingEmail = String(
      JSON.parse(localStorage.getItem(localPendingKey) || "null")?.pendingEmail || "",
    ).trim().toLowerCase();
  } catch (error) {
    console.warn("[Profile account] Could not read pending email change:", error);
  }
  const localPendingConfirmed = localPendingEmail === normalizedEmail;
  if (localPendingConfirmed) {
    localStorage.removeItem(localPendingKey);
    sessionStorage.removeItem(localPendingKey);
  }

  const pendingEmail = records
    .map(({ data }) => String(data.pendingEmail || "").trim())
    .find((pending) => pending && pending.toLowerCase() !== normalizedEmail) || "";
  const changed = results.some((result) => result.changed) || localPendingConfirmed;
  return changed
    ? { email, changed: true, pendingEmail }
    : null;
}

export function syncVerifiedProfileEmail(auth, db, user, role, collections, rtdb) {
  if (!auth || !db || !user?.uid) return Promise.resolve(null);
  const key = `${normalizePortalRole(role)}:${user.uid}`;
  const existingSync = emailSyncs.get(key);
  if (existingSync) return existingSync;
  const syncPromise = syncVerifiedProfileEmailOnce(auth, db, user, role, collections, rtdb)
    .finally(() => emailSyncs.delete(key));
  emailSyncs.set(key, syncPromise);
  return syncPromise;
}

export async function findPendingEmailFallbacks(db, email, role, collections = profileCollectionsForRole(role)) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const reads = await Promise.allSettled(
    collections.flatMap((collectionName) => [
      getDocsCached(
        getDocs,
        query(
          collection(db, collectionName),
          where("email", "==", normalizedEmail),
        ),
        `${normalizePortalRole(role)}:${collectionName}:email:${normalizedEmail}`,
        normalizedEmail,
      ),
      getDocsCached(
        getDocs,
        query(
          collection(db, collectionName),
          where("pendingEmail", "==", normalizedEmail),
        ),
        `${normalizePortalRole(role)}:${collectionName}:pendingEmail:${normalizedEmail}`,
        normalizedEmail,
      ),
    ]),
  );
  const candidates = new Set();
  reads.forEach((result) => {
    if (result.status !== "fulfilled") {
      console.warn("[Profile account] Could not check pending email fallback:", result.reason);
      return;
    }
    result.value.forEach((profileSnapshot) => {
      const data = profileSnapshot.data();
      if (!roleMatches(data, normalizePortalRole(role), profileSnapshot.ref.parent.id)) return;
      [data.email, data.pendingEmail].forEach((candidate) => {
        const value = String(candidate || "").trim().toLowerCase();
        if (value && value !== normalizedEmail) candidates.add(value);
      });
    });
  });
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("recovibe_pending_email_")) continue;
      const pending = JSON.parse(localStorage.getItem(key) || "null");
      const pendingEmail = String(pending?.pendingEmail || "").trim().toLowerCase();
      const previousEmail = String(pending?.oldEmail || "").trim().toLowerCase();
      if (pendingEmail === normalizedEmail && previousEmail) candidates.add(previousEmail);
      if (previousEmail === normalizedEmail && pendingEmail) candidates.add(pendingEmail);
    }
  } catch (error) {
    console.warn("[Profile account] Could not inspect local pending email changes:", error);
  }
  return [...candidates];
}

export async function signInWithPendingEmailFallback(auth, db, email, password, role, collections) {
  role = normalizePortalRole(role);
  try {
    return await signInWithEmailAndPassword(auth, email, password);
  } catch (primaryError) {
    if (!["auth/user-not-found", "auth/invalid-credential"].includes(primaryError?.code)) {
      throw primaryError;
    }
    const candidates = await findPendingEmailFallbacks(db, email, role, collections);
    let fallbackError = null;
    for (const candidate of candidates) {
      try {
        const credential = await signInWithEmailAndPassword(auth, candidate, password);
        return credential;
      } catch (error) {
        if (error?.code === "portal/email-change-pending") throw error;
        fallbackError = error;
        if (error?.code === "auth/too-many-requests") throw error;
      }
    }
    if (fallbackError?.code === "auth/user-not-found") {
      throw Object.assign(new Error("The new email address has not been verified yet."), {
        code: "portal/email-change-pending",
      });
    }
    throw primaryError;
  }
}
