/**
 * DEMO backend: pre-merge commit 1170938a1 (JWT auth + notifications).
 * Serves auth+users+notifications from the genie-demo worktree — no AI.
 */
process.env.ARANGO_URL = 'http://localhost:8529';
process.env.ARANGO_DB = 'node-services';
process.env.ARANGO_USER = 'root';
process.env.ARANGO_PASSWORD = 'test';
process.env.NOTIFICATION_REDIS_HOST = 'localhost';
process.env.NOTIFICATION_REDIS_PORT = '6379';
process.env.NOTIFICATION_REDIS_PASSWORD = 'testredis';
process.env.NOTIFICATION_BROADCAST_SECRET = 'local-test-secret';
process.env.FCM_TRANSPORT = process.env.FCM_TRANSPORT || 'mock';
process.env.JWT_SECRET = 'local-test-jwt-secret-0123456789';
process.env.JWT_EXPIRES_IN = '24h';
delete process.env.EMAIL_HOST; delete process.env.EMAIL_USER; delete process.env.EMAIL_PASSWORD;

const B = '/home/adas/Documents/genie-demo/components/gov-chat-backend';
const express = require(`${B}/node_modules/express`);
const cors = require(`${B}/node_modules/cors`);

(async () => {
  const authService = require(`${B}/services/auth-service`);
  const sessionService = require(`${B}/services/session-service`);
  const userProfileService = require(`${B}/services/user-profile-service`);
  const notificationService = require(`${B}/services/notification-service`);

  await sessionService.init();
  await authService.init();
  await userProfileService.init();
  await notificationService.init();
  authService.setSessionService(sessionService);
  userProfileService.setSessionService(sessionService);

  const { startWorkers } = require(`${B}/workers/notification-worker`);
  await startWorkers({
    tokenRepository: notificationService.tokenRepository,
    broadcastRepository: notificationService.broadcastRepository,
    fcmSender: notificationService.fcmSender,
  });

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/auth', require(`${B}/routes/auth-routes`)(authService));
  app.use('/api/users', require(`${B}/routes/user-routes`)(userProfileService));
  app.use('/api/user', require(`${B}/routes/user-routes`)(userProfileService));
  app.use('/api/notifications', require(`${B}/routes/notification-routes`)(notificationService));
  app.get('/api/health', (req, res) => res.json({ ok: true, mode: 'demo-1170938a1' }));

  const server = app.listen(3000, () => console.log('[DEMO-HARNESS] listening on :3000'));
  const shutdown = () => { server.close(); process.exit(0); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
})().catch((e) => { console.error('[DEMO-HARNESS] failed:', e); process.exit(1); });
