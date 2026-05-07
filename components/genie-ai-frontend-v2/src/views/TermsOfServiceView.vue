<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons';
import Icon from '../components/ui/Icon.vue';
import { useT } from '../i18n/composables';

const { t } = useT();

const router = useRouter();
// Hide back when opened in a fresh tab (target="_blank" leaves history at 1).
const canGoBack = ref(window.history.length > 1);

function goBack() {
  router.back();
}
</script>

<template>
  <main class="legal-page">
    <header class="legal-header">
      <button
        v-if="canGoBack"
        type="button"
        class="back-btn"
        :aria-label="t('common.goBack', 'Go back')"
        @click="goBack"
      >
        <Icon :icon="ArrowLeft01Icon" :size="18" />
      </button>
      <span v-else aria-hidden="true" class="w-9" />
      <img src="/images/logo.svg" alt="IEEE" class="h-7" />
      <span aria-hidden="true" class="w-9" />
    </header>

    <article class="legal-content">
      <h1>Terms of Service</h1>
      <p class="lead">
        Welcome to Huduma AI. By creating an account or using the service you accept the
        terms below. Please read them before you sign up.
      </p>

      <h2>1. About this service</h2>
      <p>
        Huduma AI is an AI assistant. It can answer questions, help you draft text, look
        things up inside documents you upload, and hold chat or voice conversations with
        AI personas we call Twins. The service runs on infrastructure operated by ITU and
        its partners.
      </p>

      <h2>2. Your account</h2>
      <p>
        You need an account to use most features. When you register, you agree to give
        accurate information and to keep your password private. You are responsible for
        everything that happens under your account, so tell us straight away if you think
        someone else has access.
      </p>
      <p>
        You must be at least 16 years old to register on your own. If you are younger, a
        parent or guardian needs to do that for you.
      </p>

      <h2>3. Acceptable use</h2>
      <p>We want Huduma AI to stay useful and safe. You agree not to:</p>
      <ul>
        <li>Use it to break the law or to hurt other people.</li>
        <li>Try to extract private data, model weights, or hidden system prompts.</li>
        <li>Send malware, spam, or scrape the service in bulk.</li>
        <li>Pretend to be someone you are not.</li>
        <li>Upload content you do not have the right to share.</li>
      </ul>
      <p>We may suspend or close accounts that break these rules.</p>

      <h2>4. Content you share with us</h2>
      <p>
        When you upload documents or send messages, you keep ownership of that content.
        You give us permission to process it so the AI can answer your questions, so we
        can store your conversation history, and so we can improve the service over time.
        We do not sell your content to advertisers.
      </p>
      <p>
        If you delete content from the app, we remove it from active systems within 30
        days. Backup copies may take a little longer to roll over.
      </p>

      <h2>5. Content the AI generates</h2>
      <p>
        The model produces responses based on its training data and on the documents you
        give it. Sometimes those responses are wrong, incomplete, or out of date. Treat
        them as a starting point, not as professional medical, legal, or financial
        advice. You decide what to do with the output and you are responsible for how you
        use it.
      </p>

      <h2>6. Service availability</h2>
      <p>
        We do our best to keep the service running well, but we cannot promise it will
        always be available. We may update, pause, or discontinue features when we need
        to. If we make a major change that affects you, we will give notice in the app or
        by email.
      </p>

      <h2>7. Privacy</h2>
      <p>
        How we handle your personal data is set out in our
        <RouterLink :to="{ name: 'privacy' }" class="link">Privacy Policy</RouterLink>.
        By using the service you agree to those practices.
      </p>

      <h2>8. Limits of liability</h2>
      <p>
        To the extent allowed by law, Huduma AI and ITU are not liable for indirect or
        consequential losses connected to your use of the service. Nothing here limits
        any rights you have under your local consumer law.
      </p>

      <h2>9. Changes to these terms</h2>
      <p>
        We may revise these terms from time to time. If the changes are significant, we
        will let you know in advance. If you keep using the service after the new
        version takes effect, you accept the updated terms.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions about these terms? Write to
        <a href="mailto:support@huduma.ai" class="link">support@huduma.ai</a>.
      </p>
    </article>
  </main>
</template>

<style scoped>
.legal-page {
  /* Global CSS sets html/body/#app to overflow-hidden, so the page must
     scroll internally rather than the document. */
  height: 100vh;
  overflow-y: auto;
  background: #ffffff;
  color: #0f172a;
}

.legal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid #e2e8f0;
  position: sticky;
  top: 0;
  background: #ffffff;
  z-index: 10;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 9999px;
  background: #f1f5f9;
  color: #475569;
  transition: background 0.15s, color 0.15s;
}
.back-btn:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.legal-content {
  max-width: 46rem;
  margin: 0 auto;
  padding: 3rem 1.5rem 5rem;
  font-size: 0.95rem;
  line-height: 1.7;
  color: #334155;
}

.legal-content h1 {
  font-size: 2rem;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 1rem;
  line-height: 1.2;
}
.legal-content h2 {
  font-size: 1.125rem;
  font-weight: 600;
  color: #0f172a;
  margin-top: 2.25rem;
  margin-bottom: 0.5rem;
}
.legal-content .lead {
  font-size: 1rem;
  color: #475569;
  margin-bottom: 1.5rem;
}
.legal-content p {
  margin: 0 0 0.875rem;
}
.legal-content ul {
  list-style: disc;
  padding-left: 1.25rem;
  margin: 0 0 0.875rem;
}
.legal-content li {
  margin-bottom: 0.375rem;
}
.link,
.legal-content a {
  color: #0073b9;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.link:hover,
.legal-content a:hover {
  color: #003e62;
}
</style>
