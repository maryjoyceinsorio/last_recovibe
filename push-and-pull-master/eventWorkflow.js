export const EVENT_APPROVAL_STAGES = Object.freeze([
  Object.freeze({ key: "org_adv", label: "Organization Adviser" }),
  Object.freeze({
    key: "sir_abelida",
    label: "Laboratory Head, Property Custodian, Administrative Officer",
  }),
  Object.freeze({
    key: "hap",
    label: "Head of Academic Programs, QAC Coordinator (HAP)",
  }),
  Object.freeze({ key: "osas", label: "OSAS" }),
]);

const normalizeStageKey = (value) =>
  String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");

const normalizeDecision = (value) =>
  String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, " ");

const STAGE_KEY_ALIASES = new Map([
  ["adviser", "org_adv"],
  ["orgadviser", "org_adv"],
  ["organizationadviser", "org_adv"],
  ["organizationadvisor", "org_adv"],
  ["labhead", "sir_abelida"],
  ["laboratoryhead", "sir_abelida"],
  ["propertycustodian", "sir_abelida"],
  ["administrativeofficer", "sir_abelida"],
  ["qaccoordinator", "hap"],
  ["headofacademicprograms", "hap"],
]);

function canonicalStageKey(value) {
  const normalized = normalizeStageKey(value);
  return EVENT_APPROVAL_STAGES.find((stage) =>
    normalizeStageKey(stage.key) === normalized ||
    normalizeStageKey(stage.label) === normalized,
  )?.key || STAGE_KEY_ALIASES.get(normalized) || null;
}

function normalizeConfiguredStages(stages) {
  return stages.map((stage, index) => ({
    ...stage,
    id: String(stage.id || stage.key || `stage-${index + 1}`),
    name: String(stage.name || stage.label || `Stage ${index + 1}`),
    required: stage.required !== false,
    reviewerName: String(stage.reviewerName || stage.reviewer || stage.label || stage.name || ""),
    reviewerEmail: String(stage.reviewerEmail || stage.email || "").trim().toLowerCase(),
    order: index,
  }));
}

function isCscOrganizationCode(value) {
  return ["csc", "centralstudentcouncil"].includes(normalizeStageKey(value));
}

function isOrganizationAdviserStage(stage) {
  const aliases = Array.isArray(stage.aliases) ? stage.aliases : [];
  return [stage.id, stage.key, stage.name, stage.label, ...aliases]
    .some((value) => canonicalStageKey(value) === "org_adv");
}

function isValidOrganizationStages(stages) {
  if (!Array.isArray(stages) || stages.length < 1 || stages.length > 8) return false;
  const ids = new Set();
  const names = new Set();
  let hasRequiredStage = false;
  return stages.every((stage, index) => {
    if (!stage || typeof stage !== "object" || Array.isArray(stage)) return false;
    const id = typeof stage.id === "string" ? stage.id.trim() : "";
    const name = typeof stage.name === "string" ? stage.name.trim() : "";
    const reviewerName = typeof stage.reviewerName === "string" ? stage.reviewerName : "";
    const reviewerEmail = typeof stage.reviewerEmail === "string" ? stage.reviewerEmail.trim() : "";
    const nameKey = name.toLocaleLowerCase();
    const validEmail = !reviewerEmail ||
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reviewerEmail);
    if (
      !id ||
      ids.has(id) ||
      name.length < 2 ||
      name.length > 60 ||
      names.has(nameKey) ||
      reviewerName.length > 80 ||
      typeof stage.required !== "boolean" ||
      stage.order !== index ||
      !validEmail
    ) return false;
    ids.add(id);
    names.add(nameKey);
    hasRequiredStage ||= stage.required;
    return true;
  }) && hasRequiredStage;
}

export function resolveApprovalStages(settings, organizationCode) {
  const rawCode = String(organizationCode || "").trim().toUpperCase();
  const isCsc = isCscOrganizationCode(rawCode);
  const code = isCsc ? "CSC" : rawCode;
  const fallbackStages = Array.isArray(settings?.approvalStages) && settings.approvalStages.length
    ? settings.approvalStages
    : EVENT_APPROVAL_STAGES.map((stage, index) => ({
        id: stage.key,
        name: stage.label,
        reviewerName: stage.label,
        required: true,
        order: index,
      }));
  const customEntry = code && ![".", "/", "[", "]", "*", "~"].some((character) => code.includes(character))
    ? settings?.approvalStagesByOrg?.[code]
    : null;
  const hasCustomStages = isValidOrganizationStages(customEntry?.stages);
  const sourceStages = hasCustomStages ? customEntry.stages : fallbackStages;
  return {
    source: hasCustomStages ? "organization" : "default",
    stages: normalizeConfiguredStages(sourceStages).map((stage) =>
      isCsc && isOrganizationAdviserStage(stage)
        ? { ...stage, required: false, notApplicable: true }
        : stage,
    ),
  };
}

function hasStageSnapshot(proposal) {
  return Boolean(
    proposal &&
    ["organization", "default"].includes(proposal.stagesSource) &&
    Array.isArray(proposal.approvalStages),
  );
}

function getSnapshotStages(proposal) {
  const stages = normalizeConfiguredStages(
    proposal.approvalStages.filter((stage) => stage && typeof stage === "object"),
  ).sort((left, right) => left.order - right.order);
  const selectedIds = Array.isArray(proposal.approvalSteps)
    ? new Set(proposal.approvalSteps.map(String))
    : null;
  return stages.filter((stage) =>
    !stage.notApplicable && (!selectedIds || selectedIds.has(stage.id)),
  );
}

export function getStages(proposal) {
  if (hasStageSnapshot(proposal)) {
    return getSnapshotStages(proposal).map((stage) => stage.id);
  }
  if (!proposal || !Object.prototype.hasOwnProperty.call(proposal, "approvalSteps")) {
    return EVENT_APPROVAL_STAGES.map((stage) => stage.key);
  }
  if (!Array.isArray(proposal.approvalSteps)) return [];

  const seen = new Set();
  return proposal.approvalSteps
    .map(canonicalStageKey)
    .filter((stageKey) => {
      if (!stageKey || seen.has(stageKey)) return false;
      seen.add(stageKey);
      return true;
    });
}

export function getCurrentStageKey(proposal) {
  const stageKeys = getStages(proposal);
  if (!stageKeys.length) return null;

  const rawCurrentStage = String(proposal?.approvalCurrentStage || "").trim();
  const explicitStageKey = stageKeys.includes(rawCurrentStage)
    ? rawCurrentStage
    : canonicalStageKey(rawCurrentStage);
  const workflow = getEventStage(proposal);
  const explicitStageIsApproved = workflow.stages.some(
    (stage) => stage.key === explicitStageKey && stage.approved,
  );
  if (explicitStageIsApproved) return workflow.currentStageKey;
  if (explicitStageKey && stageKeys.includes(explicitStageKey)) {
    return explicitStageKey;
  }

  const history = Array.isArray(proposal?.approvalHistory) ? proposal.approvalHistory : [];
  if (history.some((entry) => {
    const entryStage = [entry?.stage, entry?.stageKey, entry?.key]
      .find((value) => String(value || "").trim());
    return Boolean(
      hasStageSnapshot(proposal)
        ? stageKeys.some((key) => normalizeStageKey(key) === normalizeStageKey(entryStage))
        : canonicalStageKey(entryStage),
    );
  })) {
    return getEventStage(proposal).currentStageKey;
  }

  const rawStep = proposal?.approvalCurrentStep ??
    proposal?.currentApprovalStep ??
    proposal?.currentStep ??
    proposal?.approval?.approvalCurrentStep ??
    proposal?.approval?.currentStep;
  const step = rawStep === "" || rawStep === null || rawStep === undefined
    ? NaN
    : Number(rawStep);
  if (Number.isInteger(step) && step >= 0) {
    if (step === 0) return stageKeys[0];
    const oneBasedIndex = step - 1;
    if (oneBasedIndex >= 0 && oneBasedIndex < stageKeys.length) return stageKeys[oneBasedIndex];
  }
  return getEventStage(proposal).currentStageKey;
}

function getStageHistoryEntries(event, stageKey) {
  const normalizedKey = normalizeStageKey(stageKey);
  return (Array.isArray(event?.approvalHistory) ? event.approvalHistory : [])
    .filter((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const entryStage = [entry.stage, entry.stageKey, entry.key, entry.stageId]
        .find((value) => String(value || "").trim());
      return normalizeStageKey(entryStage) === normalizedKey;
    });
}

export function getEventStage(event) {
  const dynamicStages = hasStageSnapshot(event) ? getSnapshotStages(event) : null;
  const stages = getStages(event).map((stageKey, index) => {
    const stage = dynamicStages
      ? dynamicStages.find((candidate) => candidate.id === stageKey)
      : EVENT_APPROVAL_STAGES.find((candidate) => candidate.key === stageKey);
    if (!stage) return null;
    const approvedEntries = getStageHistoryEntries(event, stage.key || stage.id)
      .filter((entry) => normalizeDecision(entry.decision) === "approved");
    const approvedEntry = approvedEntries[approvedEntries.length - 1] || null;
    return {
      ...stage,
      key: stage.key || stage.id,
      label: stage.label || stage.name,
      index,
      step: index + 1,
      approved: Boolean(approvedEntry),
      approvedEntry,
    };
  }).filter(Boolean);
  const currentStageIndex = stages.findIndex((stage) => !stage.approved);
  const firstIncompleteIndex = currentStageIndex < 0
    ? stages.length - 1
    : currentStageIndex;

  return {
    stages: stages.map((stage) => ({
      ...stage,
      state: stage.approved
        ? "approved"
        : stage.index === currentStageIndex
          ? "current"
          : "pending",
    })),
    currentStageIndex: firstIncompleteIndex,
    currentStageKey: currentStageIndex < 0 ? null : stages[currentStageIndex].key,
    isFullyApproved: stages.length > 0 && currentStageIndex < 0,
  };
}

export function isFullyApproved(event) {
  return getEventStage(event).isFullyApproved;
}

export function buildApprovalUpdate(event, {
  stageKey,
  decidedBy,
  decidedByName = "",
  now = Date.now(),
}) {
  const workflow = getEventStage(event);
  const activeStageKeys = getStages(event);
  const dynamicStage = hasStageSnapshot(event)
    ? workflow.stages.find((candidate) => candidate.key === stageKey)
    : null;
  const stage = dynamicStage || EVENT_APPROVAL_STAGES.find(
    (candidate) => normalizeStageKey(candidate.key) === normalizeStageKey(stageKey),
  );
  if (!stage) throw new Error(`Unknown approval stage: ${stageKey}`);
  if (!activeStageKeys.length || !activeStageKeys.includes(stage.key)) {
    throw new Error(`Approval stage is not active for this proposal: ${stage.key}.`);
  }
  if (workflow.isFullyApproved) throw new Error("This proposal is already fully approved.");
  const currentStageKey = getCurrentStageKey(event) || workflow.currentStageKey;
  if (workflow.currentStageKey !== stage.key || currentStageKey !== stage.key) {
    throw new Error(`Approval must be completed in order. Current stage: ${currentStageKey || workflow.currentStageKey}.`);
  }

  const currentIndex = activeStageKeys.indexOf(stage.key);
  const history = Array.isArray(event?.approvalHistory)
    ? event.approvalHistory
    : [];
  const nextHistory = [
    ...history,
    {
      stage: stage.key,
      stageLabel: stage.label || stage.name,
      decision: "approved",
      note: "",
      decidedBy,
      decidedByName,
      timestamp: now,
    },
  ];
  const nextWorkflow = getEventStage({ ...event, approvalHistory: nextHistory });
  const nextStage = nextWorkflow.currentStageKey;
  const nextIndex = nextStage ? activeStageKeys.indexOf(nextStage) : currentIndex;
  const complete = nextWorkflow.isFullyApproved;

  return {
    approvalHistory: nextHistory,
    approvalCurrentStage: nextStage,
    approvalCurrentStep: nextIndex,
    approvalStatus: complete ? "approved" : "pending",
    status: complete ? "approved" : "pending",
    updatedAt: now,
  };
}
