import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from "./UserStudent/firebaseConfig.js";
import { getDocCached } from "./firestoreReadCache.js";

function normalizeOrganizationCode(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function isOrganizerRole(value) {
  return ["eventorganizer", "organizer", "eo"].includes(
    String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, ""),
  );
}

async function getOrganizerOrganizationFromProfile() {
  const uid = auth?.currentUser?.uid;
  if (!db || !uid) {
    throw new Error("Sign in before loading organization events.");
  }

  const reads = await Promise.allSettled([
    getDocCached(getDoc, doc(db, "adminUser", uid), uid),
    getDocCached(getDoc, doc(db, "users", uid), uid),
    getDocCached(getDoc, doc(db, "eventOrganizations", uid), uid),
  ]);
  const profiles = reads.slice(0, 2)
    .filter((result) => result.status === "fulfilled" && result.value.exists())
    .map((result) => result.value.data());
  const organizerProfile = profiles.find((profile) =>
    isOrganizerRole(profile.role || profile.userRole),
  );
  const organizationSnapshot = reads[2];
  const organizationRecord = organizationSnapshot.status === "fulfilled" &&
    organizationSnapshot.value.exists()
    ? organizationSnapshot.value.data()
    : {};
  const hasConflictingRole = profiles.some((profile) =>
    String(profile.role || profile.userRole || "").trim(),
  );

  if (!organizerProfile && (hasConflictingRole || !organizationRecord.organizationCode)) {
    const readError = reads.find((result) => result.status === "rejected")?.reason;
    if (readError) throw readError;
    throw new Error("Your organizer account does not have a verified organization.");
  }

  const profile = organizerProfile || organizationRecord;
  const organizationCode = normalizeOrganizationCode(
    organizationRecord.organizationCode ||
    profile.organizationCode ||
    profile.orgCode ||
    profile.organization ||
    profile.organizationName ||
    profile.orgName,
  );
  if (!organizationCode) {
    throw new Error("Your organizer profile must have an organization assigned.");
  }
  return organizationCode;
}

export async function syncOrganizerOrganization() {
  return getOrganizerOrganizationFromProfile();
}

export async function syncApproverOrganization() {
  const uid = auth?.currentUser?.uid;
  if (!db || !uid) throw new Error("Sign in before verifying the approval organization.");
  const reads = await Promise.allSettled([
    getDocCached(getDoc, doc(db, "adminUser", uid), uid),
    getDocCached(getDoc, doc(db, "users", uid), uid),
  ]);
  const profiles = reads
    .filter((result) => result.status === "fulfilled" && result.value.exists())
    .map((result) => result.value.data());
  const profile = profiles.find((candidate) =>
    String(candidate.role || candidate.userRole || "").trim().toLowerCase() === "admin",
  ) || profiles[0] || {};
  const readError = reads.find((result) => result.status === "rejected")?.reason;
  const organizationCode = normalizeOrganizationCode(
    profile.organizationCode ||
    profile.orgCode ||
    profile.organization ||
    profile.organizationName,
  );
  if (!organizationCode) {
    if (readError) throw readError;
    throw new Error("Your approval role does not have an organization assigned.");
  }
  return organizationCode;
}
