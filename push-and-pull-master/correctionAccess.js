// correctionAccess.js - client-side OSAS check. One read of adminUser/{uid}, cached per uid.
// The real enforcement is in Firestore rules; this only gives clean UI behavior and early errors.
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export class NotAuthorizedError extends Error {
  constructor(message = "Only the OSAS office can do this.") {
    super(message);
    this.name = "NotAuthorizedError";
    this.code = "not-authorized";
  }
}

// Same fields the Firestore rules check in isOsasAccount().
const OSAS_FIELDS = ["roleSuffix", "role", "userRole", "approverRole", "approvalStage", "stage", "position", "designation", "title"];
const BLOCKED_STATUS = ["disabled", "inactive", "suspended"];

const key = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const cache = new Map(); // uid -> Promise<boolean>

export function isOsasProfile(profile) {
  if (!profile) return false;
  if (BLOCKED_STATUS.includes(key(profile.status ?? "active"))) return false;
  return OSAS_FIELDS.some((f) => key(profile[f]) === "osas");
}

/** true only for an active OSAS account. Costs one read per signed-in user, then cached. */
export function isOsasReviewer(db, auth) {
  const user = auth && auth.currentUser;
  if (!user) return Promise.resolve(false);
  if (!cache.has(user.uid)) {
    cache.set(
      user.uid,
      getDoc(doc(db, "adminUser", user.uid))
        .then((snap) => snap.exists() && isOsasProfile(snap.data()))
        .catch(() => { cache.delete(user.uid); return false; })
    );
  }
  return cache.get(user.uid);
}

/** Throws NotAuthorizedError unless the current user is OSAS. Call first in every OSAS-only action. */
export async function assertOsas(db, auth) {
  if (!(await isOsasReviewer(db, auth))) throw new NotAuthorizedError();
}

/** Call on sign-out so a different user on the same tab is not judged by the old cache. */
export function clearOsasCache() { cache.clear(); }
