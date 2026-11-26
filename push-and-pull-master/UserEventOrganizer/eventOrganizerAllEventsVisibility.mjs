function normalizeStatus(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[ _-]+/g, " ");
}

function normalizeOrganizationIdentity(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function getEventPhase(event, now, getEventBoundaryMillis) {
  const statuses = [
    event.status,
    event.publicationStatus,
    event.eventStatus,
  ].map(normalizeStatus);

  if (
    event.cancelled === true ||
    event.canceled === true ||
    statuses.some((status) => ["cancelled", "canceled"].includes(status))
  ) {
    return "cancelled";
  }
  if (
    event.completed === true ||
    statuses.some((status) =>
      ["completed", "complete", "ended", "finished"].includes(status),
    )
  ) {
    return "completed";
  }

  const end = getEventBoundaryMillis(event, true);
  if (end !== null && end < now) return "completed";
  if (statuses.some((status) => ["ongoing", "active"].includes(status))) {
    return "ongoing";
  }
  if (statuses.includes("upcoming")) return "upcoming";

  const start = getEventBoundaryMillis(event);
  if (start !== null && start <= now && (end === null || end >= now)) {
    return "ongoing";
  }
  if (start !== null && start > now) return "upcoming";
  if (
    event.rescheduled === true ||
    statuses.includes("rescheduled")
  ) {
    return "rescheduled";
  }
  return "unknown";
}

export function shouldHideOtherOrganizationCancelledEvent(
  event,
  phase,
  currentOrganizerId,
  currentOrganizationCode,
) {
  if (phase !== "cancelled") return false;

  const currentId = String(currentOrganizerId || "");
  const ownerIds = [event.organizerId, event.organizerUid, event.createdBy];
  if (
    currentId &&
    ownerIds.some((ownerId) => String(ownerId || "") === currentId)
  ) {
    return false;
  }

  const organizationIdentity = normalizeOrganizationIdentity(
    currentOrganizationCode,
  );
  if (!organizationIdentity) return true;

  const eventOrganizationCode = normalizeOrganizationIdentity(
    event.organizationCode || event.orgCode,
  );
  if (eventOrganizationCode) {
    return eventOrganizationCode !== organizationIdentity;
  }

  const eventOrganizationIdentities = [
    event.organizerOrganization,
    event.organization,
    event.organizationName,
    event.orgName,
  ];
  // organizerName may be a person's display label, not an organization identity.
  return !eventOrganizationIdentities.some(
    (identity) => normalizeOrganizationIdentity(identity) === organizationIdentity,
  );
}
