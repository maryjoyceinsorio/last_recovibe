export const pendingEmailNoticeMarkup = `
  <div class="pending-verification-box" id="pendingVerificationBox" role="status" hidden>
    <div class="pending-notice-icon" aria-hidden="true">
      <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
        <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
      </svg>
    </div>
    <div class="pending-notice-body">
      <p class="pending-notice-text">
        Verification sent to <strong id="pendingVerificationEmail"></strong>. You still sign in with
        <span id="currentSignInEmail"></span> until you confirm.
      </p>
      <button type="button" class="btn-link-action" id="btnCancelEmailChange">Cancel change</button>
    </div>
  </div>
`;

export function updatePendingEmailNotice(profile, authUser) {
  const notice = document.getElementById("pendingVerificationBox");
  if (!notice) return;

  const uid = authUser?.uid || profile?.uid || "";
  let storedPendingEmail = "";
  if (uid) {
    const key = `recovibe_pending_email_${uid}`;
    for (const storage of [localStorage, sessionStorage]) {
      try {
        const value = JSON.parse(storage.getItem(key) || "null")?.pendingEmail;
        if (typeof value === "string" && value.trim()) {
          storedPendingEmail = value.trim();
          break;
        }
      } catch (error) {
        console.warn("Could not read the pending email change:", error);
      }
    }
  }

  const pendingEmail = storedPendingEmail || String(profile?.pendingEmail || "").trim();
  notice.hidden = !pendingEmail;
  const target = document.getElementById("pendingVerificationEmail");
  const current = document.getElementById("currentSignInEmail");
  if (target) target.textContent = pendingEmail;
  if (current) current.textContent = authUser?.email || profile?.email || "your current email";
}
