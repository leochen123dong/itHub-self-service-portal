// Admin-configurable default TicketTemplateId for AI-chat → ticket escalation.
//
// Why this exists: the heuristic in web/src/store/chatStore.ts#resolveTemplateId
// probes up to 8 templates and scores them. If the calling user (e.g. a
// regular Leo) can't GET detail on any of them, or if all candidates score
// < 0, the escalate flow throws "未找到可用的工单模板" and the user gets
// stuck. This store gives the admin a single, explicit override that
// resolves templates.
//
// Resolution order at runtime:
//   1. Admin has POSTed a templateId → use it
//   2. Otherwise fall back to env var ITHUB_DEFAULT_INCIDENT_TEMPLATE_ID
//   3. Otherwise null → chatStore falls through to its heuristic

let defaultIncidentTemplateId: number | null = null;

export function getDefaultIncidentTemplateId(): number | null {
  return defaultIncidentTemplateId;
}

export function setDefaultIncidentTemplateId(id: number | null): void {
  if (id === null) {
    defaultIncidentTemplateId = null;
    return;
  }
  const n = Number(id);
  defaultIncidentTemplateId = Number.isFinite(n) && n > 0 ? n : null;
}

// Called once at server boot to hydrate from ITHUB_DEFAULT_INCIDENT_TEMPLATE_ID
// env var. Idempotent — safe to call repeatedly.
export function hydrateFromEnv(envValue: string | undefined): void {
  if (!envValue) return;
  const n = Number(envValue);
  if (Number.isFinite(n) && n > 0) {
    defaultIncidentTemplateId = n;
  }
}