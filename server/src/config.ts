import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v !== '' ? v : undefined;
}

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === 'true' || v === '1';
}

export const config = {
  port: intEnv('PORT', 4000),
  webOrigins: (process.env.WEB_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // If any allowed origin is NOT localhost, we're serving cross-site
  // (e.g. GH Pages → Render) and need SameSite=None + Secure. Local-only
  // dev (localhost only) keeps Lax because Secure requires HTTPS.
  hasExternalOrigin: (process.env.WEB_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .some((s) => !s.includes('localhost')),

  ithub: {
    baseUrl: required('ITHUB_BASE_URL', 'https://demo.logicalisservice.com'),
    customerTag: required('ITHUB_CUSTOMER_TAG', 'ciscoinnovation1'),
    demoIdentity: process.env.ITHUB_DEMO_IDENTITY ?? '',
    demoPassword: process.env.ITHUB_DEMO_PASSWORD ?? '',
    // Tenant-level ApiKey. Required for ticket create
    // (POST /api/ServiceDesk/Customers/{tag}/TicketTemplates/{id}/TicketIncidents)
    // — the user AccessToken alone returns 404 for create. Get it from the
    // ITHub admin (tenant → API / Integration).
    apiKey: process.env.ITHUB_API_KEY ?? '',
  },

  ai: {
    profileId: optional('AI_PROFILE_ID'),
    profileTag: optional('AI_PROFILE_TAG'),
    kbId: optional('KB_ID'),
  },

  minimax: {
    enabled: boolEnv('ENABLE_MINIMAX', true),
    apiKey: optional('MINIMAX_API_KEY'),
    baseUrl: process.env.MINIMAX_BASE_URL ?? 'https://api.minimaxi.com',
    model: process.env.MINIMAX_MODEL ?? 'MiniMax-Text-01',
  },

  session: {
    cookieName: process.env.SESSION_COOKIE_NAME ?? 'sid',
    ttlHours: intEnv('SESSION_TTL_HOURS', 8),
    // Set in index.ts from the hasLocalhostOrigin check above.
    cookieSameSite: 'none' as 'none' | 'lax',
    cookieSecure: true,
  },

  admin: {
    // Comma-separated list of ITHub identities allowed to view /api/ai/admin/*.
    identities: (process.env.ADMIN_IDENTITY ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  tickets: {
    // Admin-configurable default TicketTemplateId for AI-chat → ticket
    // escalation. Falls through to chatStore's heuristic if unset. The
    // admin can override at runtime via /api/admin-users/default-incident-template.
    defaultIncidentTemplateId: optional('ITHUB_DEFAULT_INCIDENT_TEMPLATE_ID'),
  },
};

export type AppConfig = typeof config;