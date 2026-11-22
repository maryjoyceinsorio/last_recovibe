import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db, rtdb } from "./firebaseConfig.js";
import { syncVerifiedProfileEmail } from "../portalProfileAccount.js";

const currentUserStorageKey = "recovibeCurrentUser";
const studentProfileCollections = ["users", "students"];

function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeStudentNumber(value) {
  return String(value || "")
    .replace(/\s/g, "")
    .toUpperCase()
    .replace(/[^0-9BN-]/g, "")
    .slice(0, 16);
}

export function studentNumberValidationMessage(value) {
  const normalized = normalizeStudentNumber(value);
  if (!normalized) return "Student number is required.";
  const parts = /^(\d{4})-(\d{5})-([A-Z]{2})-(\d+)$/.exec(normalized);
  if (!parts) return "Student number must follow the format 2025-12345-BN-0.";
  const year = Number(parts[1]);
  const currentYear = new Date().getFullYear();
  if (year < 2000 || year > currentYear) {
    return `Enter a valid year in the first 4 digits (2000 to ${currentYear}).`;
  }
  if (parts[2] === "00000") return "Enter a valid 5-digit student number.";
  if (parts[3] !== "BN") return "Campus code must be BN (PUP Biñan).";
  if (!/^[01]$/.test(parts[4])) return "The last digit must be 0 or 1.";
  return /^\d{4}-\d{5}-BN-[01]$/.test(normalized)
    ? ""
    : "Student number must follow the format 2025-12345-BN-0.";
}

export function syncVerifiedStudentEmail(user) {
  return syncVerifiedProfileEmail(auth, db, user, "student", studentProfileCollections, rtdb);
}

function readStoredProfile(email) {
  for (const storage of [localStorage, sessionStorage]) {
    try {
      const value = JSON.parse(storage.getItem(currentUserStorageKey) || "null");
      if (
        value &&
        typeof value === "object" &&
        normalizedEmail(value.email) === normalizedEmail(email)
      ) return value;
    } catch (error) {
      console.warn("[Student Identity] Could not read cached profile:", error);
    }
  }
  return null;
}

export function clearCachedStudentProfile() {
  localStorage.removeItem(currentUserStorageKey);
  sessionStorage.removeItem(currentUserStorageKey);
}

function cacheStudentProfile(uid, profile, preferredStorage) {
  const cached = {
    ...profile,
    uid,
  };
  const storage = preferredStorage === "session"
    ? sessionStorage
    : preferredStorage === "local"
      ? localStorage
      : localStorage.getItem(currentUserStorageKey)
        ? localStorage
        : sessionStorage.getItem(currentUserStorageKey)
          ? sessionStorage
          : localStorage;
  clearCachedStudentProfile();
  storage.setItem(currentUserStorageKey, JSON.stringify(cached));
}

export async function loadStudentProfile(user, { storage, createIfMissing = false } = {}) {
  if (!user?.uid || !db) throw new Error("A signed-in student and Firestore are required.");
  if (auth?.currentUser?.uid !== user.uid) {
    throw new Error("The authenticated student changed before their profile could be loaded.");
  }

  await syncVerifiedStudentEmail(user);
  const profileReads = await Promise.allSettled(
    studentProfileCollections.map(async (collectionName) => ({
      collectionName,
      snapshot: await getDoc(doc(db, collectionName, user.uid)),
    })),
  );
  const profileRecords = [];
  const profileReadErrors = [];
  profileReads.forEach((result, index) => {
    if (result.status === "rejected") {
      profileReadErrors.push(result.reason);
      console.warn("[Student Identity] Could not read a student profile collection:", {
        collection: studentProfileCollections[index],
        code: result.reason?.code || "unknown",
      });
    } else if (result.value.snapshot.exists()) {
      profileRecords.push({
        collectionName: result.value.collectionName,
        snapshot: result.value.snapshot,
        data: result.value.snapshot.data(),
      });
    }
  });
  if (!profileRecords.length && profileReadErrors.length === studentProfileCollections.length) {
    throw profileReadErrors[0];
  }
  let profileRecord = profileRecords[0] || null;
  let profile = profileRecord?.data || null;

  if (profile && profile.uid && profile.uid !== user.uid) {
    throw new Error("The profile document UID does not match the authenticated user.");
  }
  if (
    profile &&
    normalizedEmail(profile.email) &&
    normalizedEmail(user.email) &&
    normalizedEmail(profile.email) !== normalizedEmail(user.email)
  ) {
    throw Object.assign(new Error("The profile email does not match the authenticated user."), {
      code: "profile/email-mismatch",
    });
  }

  if (!profile && normalizedEmail(user.email)) {
    const emailReads = await Promise.allSettled(
      studentProfileCollections.map((collectionName) => getDocs(query(
        collection(db, collectionName),
        where("email", "==", normalizedEmail(user.email)),
        limit(2),
      ))),
    );
    const emailMatches = new Map();
    emailReads.forEach((result, index) => {
      if (result.status === "rejected") {
        console.warn("[Student Identity] Could not query student profiles by email:", {
          collection: studentProfileCollections[index],
          code: result.reason?.code || "unknown",
        });
        return;
      }
      result.value.docs.forEach((snapshot) => {
        const data = snapshot.data();
        const role = String(data.role || data.userRole || "")
          .trim()
          .toLowerCase()
          .replace(/[\s_-]+/g, "");
        if (role !== "student" && !(studentProfileCollections[index] === "students" && !role)) return;
        const recordId = data.uid || snapshot.id;
        emailMatches.set(recordId, {
          collectionName: studentProfileCollections[index],
          data,
        });
      });
    });
    if (!emailMatches.size && emailReads.every((result) => result.status === "rejected")) {
      throw emailReads.find((result) => result.status === "rejected").reason;
    }
    if (emailMatches.size > 1) {
      throw new Error("More than one student profile matches this authenticated email.");
    }
    if (emailMatches.size === 1) {
      profileRecord = [...emailMatches.values()][0];
      profile = profileRecord.data;
    }
  }

  if (!profile) {
    const cached = readStoredProfile(user.email);
    if (cached) {
      profile = cached;
      profileRecord = null;
    }
  }

  if (!profile) {
    if (!createIfMissing) {
      console.warn("[Student Identity] No student profile matched the authenticated account.", {
        collections: studentProfileCollections,
        code: "profile/not-found",
      });
      throw Object.assign(new Error("No student profile matches this authenticated account."), {
        code: "profile/not-found",
      });
    }
    profile = {
      email: user.email || "",
      fullName: user.displayName || "",
      name: user.displayName || "",
      role: "student",
      status: "Active",
    };
  }

  const role = String(profile.role || profile.userRole || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (role !== "student" && !(profileRecord?.collectionName === "students" && !role)) {
    throw Object.assign(
      new Error(`The authenticated account is not a student profile (role: ${role}).`),
      { code: "profile/role-mismatch" },
    );
  }

  const canonicalProfile = {
    ...profile,
    uid: user.uid,
    email: profile.email || user.email || "",
  };
  if (auth?.currentUser?.uid !== user.uid) {
    throw new Error("The authenticated student changed while their profile was being saved.");
  }
  cacheStudentProfile(user.uid, canonicalProfile, storage);
  return canonicalProfile;
}

export function renderStudentSidebar(profile = {}) {
  const fullName = String(
    profile.fullName ||
      profile.name ||
      [profile.firstName, profile.middleName, profile.lastName]
        .filter(Boolean)
        .join(" ") ||
      "",
  ).trim();
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const firstName = String(profile.firstName || nameParts[0] || "");
  const initials = [
    firstName,
    profile.lastName || (nameParts.length > 1 ? nameParts[nameParts.length - 1] : ""),
  ]
    .filter(Boolean)
    .map((part) => Array.from(String(part))[0]?.toLocaleUpperCase() || "")
    .join("");
  const program = String(
    profile.program ||
      profile.course ||
      profile.department ||
      profile.departmentCode ||
      "",
  ).trim();
  const studentNumber = String(
    profile.studentNumber || profile.studentNo || profile.studentId || "",
  ).trim();
  const subtitle = [program, studentNumber].filter(Boolean).join(" · ");
  document.querySelectorAll(".user-name, #userName").forEach((element) => {
    element.textContent = fullName;
  });
  document.querySelectorAll(".user-role, #userRole").forEach((element) => {
    element.textContent = subtitle;
  });
  document.querySelectorAll(".avatar, #userAvatar").forEach((element) => {
    element.textContent = initials;
  });
  document.querySelectorAll("#userFirstName").forEach((element) => {
    element.textContent = firstName;
  });
  const greeting = document.getElementById("dashboardGreeting");
  if (greeting) {
    const hour = new Date().getHours();
    const salutation = hour < 12 ? "Good Morning" : hour < 18 ? "Good Afternoon" : "Good Evening";
    greeting.textContent = `${salutation}${firstName ? `, ${firstName}` : ""}`;
  }
}
