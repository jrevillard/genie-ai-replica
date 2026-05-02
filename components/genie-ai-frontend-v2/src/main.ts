import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { useAuthStore } from './stores/auth';
import './assets/styles.css';

async function bootstrap() {
  const app = createApp(App);
  app.use(createPinia());
  app.use(router);

  // Validate any cached session before navigation kicks in.
  const auth = useAuthStore();
  await auth.hydrate();

  app.mount('#app');
}

bootstrap().catch((err) => {
  console.error('Failed to bootstrap app:', err);
});
