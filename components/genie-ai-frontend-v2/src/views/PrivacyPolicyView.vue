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
      <h1>Privacy Policy</h1>
      <p class="lead">
        This page explains what data Huduma AI collects, why we collect it, and what
        choices you have over how it is used.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account details.</strong> Your name, email, the password you create
          (stored only as a hash), and any optional profile fields you fill in such as
          date of birth, gender, nationality, or marital status.
        </li>
        <li>
          <strong>Conversations.</strong> The questions you ask, voice notes you send,
          files you upload, and the responses the AI returns.
        </li>
        <li>
          <strong>Usage data.</strong> Basic information about how you use the service:
          time of access, browser type, IP address, and which features you open.
        </li>
        <li>
          <strong>Cookies.</strong> Small pieces of data we store in your browser so you
          stay signed in and so we remember your language preference.
        </li>
      </ul>

      <h2>Why we collect it</h2>
      <ul>
        <li>To run your account and to authenticate you.</li>
        <li>
          To answer your questions and remember your conversations so you can come back
          to them later.
        </li>
        <li>To personalise the service in ways you control, like language or tone.</li>
        <li>To diagnose problems and improve the product.</li>
        <li>To meet our legal duties.</li>
      </ul>

      <h2>Who sees your data</h2>
      <p>
        Your conversations and uploads are accessible to you and to a small number of
        operations staff who maintain the service. We rely on cloud and AI infrastructure
        providers under contracts that require them to protect your data and to use it
        only for the work we ask them to do.
      </p>
      <p>We do not sell your personal data. We do not share it with advertisers.</p>
      <p>
        We share data with law enforcement only when we are legally required to do so,
        and we push back on requests that look overly broad.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>
          <strong>Account data</strong> stays as long as your account is active. If you
          delete your account, we erase or anonymise personal fields within 30 days.
          Some records may be kept longer where the law requires.
        </li>
        <li>
          <strong>Conversation history</strong> stays until you delete it from the app.
        </li>
        <li>
          <strong>Backups</strong> may keep deleted data for a short rolling window
          before they are overwritten.
        </li>
      </ul>

      <h2>Where it is stored</h2>
      <p>
        The service runs on servers located inside the European Union. When data needs to
        leave the EU for a specific feature, we use providers that meet recognised
        transfer safeguards.
      </p>

      <h2>Your rights</h2>
      <p>You can:</p>
      <ul>
        <li>See, edit, or export your profile data from the profile page.</li>
        <li>
          Delete your account, which triggers erasure of your personal data from active
          systems.
        </li>
        <li>
          Ask for a full copy of the data we hold about you, or ask us to delete it, by
          writing to <a href="mailto:privacy@huduma.ai" class="link">privacy@huduma.ai</a>.
        </li>
        <li>
          Complain to your local data protection authority if you think we have
          mishandled your data.
        </li>
      </ul>

      <h2>Children</h2>
      <p>
        The service is not intended for children under 16. If you believe a child has
        given us their personal data without a parent or guardian present, contact us and
        we will remove it.
      </p>

      <h2>Security</h2>
      <p>
        We protect your data using encryption in transit, hashed passwords, role-based
        access controls, and audit logging. No system is perfect, so if we discover a
        breach that affects you we will notify you and the relevant authorities as the
        law requires.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        We update this page when our practices change. The effective date at the top
        tells you when the current version was published. Significant changes are also
        flagged inside the app.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or requests about your data:
        <a href="mailto:privacy@huduma.ai" class="link">privacy@huduma.ai</a>.
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
