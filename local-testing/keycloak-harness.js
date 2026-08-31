/**
 * SAME-BRANCH Keycloak test backend: your branch's keycloak-auth-middleware,
 * user provisioning, user routes and notification routes — no AI, no full boot.
 */
process.env.ARANGO_URL='http://localhost:8529';
process.env.ARANGO_DB='node-services';
process.env.ARANGO_USER='root';
process.env.ARANGO_PASSWORD='test';
process.env.KEYCLOAK_URL='http://localhost:8081';
process.env.KEYCLOAK_REALM='genie';
process.env.KC_CLIENT_ID='genie-app';
process.env.NOTIFICATION_REDIS_HOST='localhost';
process.env.NOTIFICATION_REDIS_PORT='6379';
process.env.NOTIFICATION_REDIS_PASSWORD='testredis';
process.env.NOTIFICATION_REDIS_DB='1';
process.env.NOTIFICATION_BROADCAST_SECRET='local-test-secret';
process.env.FCM_TRANSPORT=process.env.FCM_TRANSPORT||'mock';

const B='/home/adas/Documents/genie-ai-replica/components/gov-chat-backend';
const express=require(`${B}/node_modules/express`);
const cors=require(`${B}/node_modules/cors`);

(async () => {
  const sessionService=require(`${B}/services/session-service`);
  const userProfileService=require(`${B}/services/user-profile-service`);
  const notificationService=require(`${B}/services/notification-service`);
  await sessionService.init();
  await userProfileService.init();
  if (typeof userProfileService.setSessionService==='function') userProfileService.setSessionService(sessionService);
  await notificationService.init();
  const { startWorkers }=require(`${B}/workers/notification-worker`);
  await startWorkers({ tokenRepository:notificationService.tokenRepository, broadcastRepository:notificationService.broadcastRepository, fcmSender:notificationService.fcmSender });

  const app=express();
  app.use(cors());
  app.use(express.json({limit:'5mb'}));
  app.use((req,res,next)=>{ console.log(`[REQ] ${req.method} ${req.path}`); next(); });
  const userRoutes=require(`${B}/routes/user-routes`)(userProfileService);
  app.use('/api/users',userRoutes);
  app.use('/api/user',userRoutes);
  app.use('/api/me',userRoutes);
  app.use('/api/notifications',require(`${B}/routes/notification-routes`)(notificationService));
  app.get('/api/health',(req,res)=>res.json({ok:true,mode:'keycloak-same-branch'}));
  app.listen(3000,()=>console.log('[KC-HARNESS] same-branch Keycloak backend on :3000'));
})().catch(e=>{ console.error('[KC-HARNESS] failed:',e); process.exit(1); });
