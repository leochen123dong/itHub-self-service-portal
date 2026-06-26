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

const app = express();

const allowedOrigins = config.webOrigins;
const corsOptions: cors.CorsOptions = {
  credentials: true,
  origin: (origin, cb) => {
    // Allow same-origin / no-origin (curl, server-to-server)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    return cb(new Error(`Origin ${origin} not allowed by CORS`));
  },
};
app.use(cors(corsOptions));
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