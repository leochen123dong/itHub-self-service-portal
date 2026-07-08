import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { sessionMiddleware } from './session/middleware.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { aiRouter } from './routes/ai.js';
import { kbRouter } from './routes/kb.js';
import { catalogRouter } from './routes/catalog.js';
import { ticketsRouter } from './routes/tickets.js';
import { adminRouter } from './routes/admin.js';
import { adminUsersRouter } from './routes/adminUsers.js';

const app = express();

// Cookie attributes: cross-site (GH Pages → Render) needs SameSite=None; Secure.
// Local-only dev over HTTP can't satisfy Secure, so fall back to Lax.
if (config.hasExternalOrigin) {
  config.session.cookieSameSite = 'none';
  config.session.cookieSecure = true;
} else {
  config.session.cookieSameSite = 'lax';
  config.session.cookieSecure = false;
}

const allowedOrigins = config.webOrigins;
const isOriginAllowed = (origin: string | undefined): boolean => {
  if (!origin) return true; // same-origin / curl / server-to-server
  return allowedOrigins.includes('*') || allowedOrigins.includes(origin);
};
const corsOptions: cors.CorsOptions = {
  credentials: true,
  origin: (origin, cb) => {
    if (isOriginAllowed(origin)) return cb(null, true);
    // Don't throw — pass false so cors omits headers. The 403 check below
    // surfaces a clean error to the client instead of a 500.
    return cb(null, false);
  },
};
app.use(cors(corsOptions));
// Reject blocked origins with a clean 403 (instead of letting cors silently
// omit headers and the browser emit a vague "network error").
app.use((req, res, next) => {
  if (isOriginAllowed(req.headers.origin as string | undefined)) return next();
  res.status(403).json({
    error: { code: 'CORS', message_zh: '跨域来源未在白名单中' },
  });
});
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(morgan('dev'));
app.use(sessionMiddleware);

app.use('/api', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/ai', aiRouter);
app.use('/api/kb', kbRouter);
app.use('/api/catalog', catalogRouter);
app.use('/api/tickets', ticketsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/admin-users', adminUsersRouter);

// Final error handler
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('[error]', err);
  if (res.headersSent) return;
  res.status(500).json({
    error: { code: 'INTERNAL', message_zh: '服务器内部错误' },
  });
});

app.listen(config.port, () => {
  console.log(`\n🟢 ITHub Portal Server`);
  console.log(`   Listening: http://localhost:${config.port}`);
  console.log(`   Upstream:  ${config.ithub.baseUrl}`);
  console.log(`   Customer:  ${config.ithub.customerTag}`);
  console.log(`   AI Profile: ${config.ai.profileId ?? '(auto-discover at runtime via /api/ai/profiles)'}`);
  console.log(`   KB ID:      ${config.ai.kbId ?? '(set KB_ID in .env)'}`);
  console.log(`   Web origin: ${config.webOrigins.join(', ')}\n`);
});