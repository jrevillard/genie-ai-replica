<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  AiBrain01Icon,
  Analytics01Icon,
  Logout01Icon,
  MessageMultiple01Icon,
  Search01Icon,
  SidebarLeftIcon,
  SparklesIcon,
  UserMultipleIcon,
} from '@hugeicons/core-free-icons';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../../stores/auth';
import { notify } from '../../lib/notify';
import {
  setLocale,
  SUPPORTED_LOCALES,
  type LocaleCode,
  type LocaleOption,
} from '../../i18n';
import { useT } from '../../i18n/composables';
import ConfirmDialog from '../ui/ConfirmDialog.vue';
import FlagIcon from '../ui/FlagIcon.vue';
import Icon from '../ui/Icon.vue';
import CommandPalette from './CommandPalette.vue';

withDefaults(
  defineProps<{
    collapsed: boolean;
    mobile?: boolean;
  }>(),
  { mobile: false }
);

defineEmits<{
  (e: 'toggle'): void;
  (e: 'close'): void;
}>();

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const { t } = useT();
const { locale } = useI18n();
const logoutDialogOpen = ref(false);
const paletteOpen = ref(false);
const langOpen = ref(false);
const langWrapperRef = ref<HTMLElement | null>(null);

const selectedLocale = computed<LocaleOption>(
  () => SUPPORTED_LOCALES.find((opt) => opt.code === locale.value) ?? SUPPORTED_LOCALES[0]
);

interface NavItem {
  labelKey: string;
  fallback: string;
  icon: unknown;
  to: string;
  adminOnly?: boolean;
  userOnly?: boolean;
}

const allItems: NavItem[] = [
  { labelKey: 'nav.aiTwins', fallback: 'AI Twins', icon: SparklesIcon, to: '/ai-twins', adminOnly: true },
  { labelKey: 'nav.aiTwins', fallback: 'AI Twins', icon: SparklesIcon, to: '/my-twins', userOnly: true },
  { labelKey: 'nav.patients', fallback: 'Users', icon: UserMultipleIcon, to: '/users', adminOnly: true },
  { labelKey: 'nav.chatCallHistory', fallback: 'Chat/Call History', icon: MessageMultiple01Icon, to: '/chat-history' },
  { labelKey: 'nav.knowledgeSet', fallback: 'Knowledge Set', icon: AiBrain01Icon, to: '/knowledge-set', adminOnly: true },
  { labelKey: 'nav.analytics', fallback: 'Analytics', icon: Analytics01Icon, to: '/analytics', adminOnly: true },
];

const items = computed<NavItem[]>(() =>
  allItems.filter((item) => {
    if (item.adminOnly) return auth.isAdmin;
    if (item.userOnly) return !auth.isAdmin;
    return true;
  })
);

async function pickLocale(code: LocaleCode) {
  await setLocale(code);
  langOpen.value = false;
}

function onLangDocClick(event: MouseEvent) {
  if (!langWrapperRef.value) return;
  if (!langWrapperRef.value.contains(event.target as Node)) {
    langOpen.value = false;
  }
}

onMounted(() => document.addEventListener('mousedown', onLangDocClick));
onBeforeUnmount(() => document.removeEventListener('mousedown', onLangDocClick));

const userInitials = computed(() => {
  const source = auth.displayName || auth.email || '';
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase() || '?';
});

async function onLogout() {
  logoutDialogOpen.value = false;
  try {
    await auth.signOut();
    notify.success(
      t('auth.signOut.successTitle', 'Signed out'),
      t('auth.signOut.successBody', 'See you soon!'),
    );
  } catch (err) {
    const e = err as { message?: string };
    notify.error(
      t('auth.signOut.failedTitle', 'Sign-out failed'),
      e?.message ?? t('auth.signOut.failedBody', 'Could not complete sign-out.'),
    );
  } finally {
    router.push({ name: 'signin' });
  }
}

function isNavActive(to: string): boolean {
  return route.path === to || route.path.startsWith(`${to}/`);
}
</script>

<template>
  <aside
    :class="
      mobile
        ? 'flex h-full w-full flex-col bg-surface-muted text-text shadow-elevated'
        : ['dash-sidebar', collapsed && 'dash-sidebar--collapsed']
    "
  >
    <header
      :class="[
        'gap-2 border-b border-border-subtle p-4',
        collapsed ? 'flex flex-col items-center' : 'flex items-center justify-between',
      ]"
    >
      <img v-if="!collapsed" src="/images/logo.svg" alt="IEEE" class="h-7" />
      <img v-else src="/images/logo.svg" alt="IEEE" class="h-7 w-full object-contain" />
      <div :class="collapsed ? 'flex flex-col items-center gap-1' : 'flex items-center gap-1'">
        <button
          v-if="collapsed"
          type="button"
          class="rounded-lg p-1.5 text-text-subtle transition hover:bg-surface-subtle hover:text-text"
          :title="t('common.search', 'Search')"
          :aria-label="t('common.search', 'Search')"
          @click="paletteOpen = true"
        >
          <Icon :icon="Search01Icon" :size="18" />
        </button>
        <button
          type="button"
          class="rounded-lg p-1.5 text-text-subtle transition hover:bg-surface-subtle hover:text-text"
          :title="
            mobile
              ? t('common.close', 'Close')
              : collapsed
                ? t('nav.expandSidebar', 'Expand sidebar')
                : t('nav.collapseSidebar', 'Collapse sidebar')
          "
          :aria-label="
            mobile
              ? t('common.close', 'Close')
              : collapsed
                ? t('nav.expandSidebar', 'Expand sidebar')
                : t('nav.collapseSidebar', 'Collapse sidebar')
          "
          @click="mobile ? $emit('close') : $emit('toggle')"
        >
          <Icon :icon="SidebarLeftIcon" :size="18" />
        </button>
      </div>
    </header>

    <div v-if="!collapsed" class="px-3 pt-3">
      <button
        type="button"
        class="group flex w-full items-center gap-2.5 rounded-xl border border-border-subtle bg-surface px-3 py-2 text-left text-sm text-text-subtle transition hover:border-border hover:bg-surface hover:text-text focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
        @click="paletteOpen = true"
      >
        <Icon :icon="Search01Icon" :size="16" />
        <span class="flex-1 truncate">{{ t('common.search', 'Search') }}</span>
        <kbd
          class="hidden shrink-0 items-center gap-0.5 rounded-md border border-border-subtle bg-surface-subtle px-1.5 py-0.5 font-sans text-[10px] font-medium text-text-subtle sm:inline-flex"
          aria-hidden="true"
        >
          <span class="text-[11px] leading-none">⌘</span>K
        </kbd>
      </button>
    </div>

    <nav class="flex-1 space-y-1 p-3">
      <RouterLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        custom
        v-slot="{ navigate }"
      >
        <button
          type="button"
          :class="['dash-nav-item w-full', isNavActive(item.to) && 'dash-nav-item--active', collapsed && 'justify-center']"
          @click="navigate"
        >
          <Icon :icon="item.icon" :size="20" />
          <span v-if="!collapsed" class="truncate">{{ t(item.labelKey, item.fallback) }}</span>
        </button>
      </RouterLink>
    </nav>

    <footer class="border-t border-border-subtle p-3">
      <div
        v-if="!collapsed"
        class="rounded-2xl border border-border-subtle bg-surface-subtle/40 p-1.5 shadow-[0_1px_0_rgba(15,23,42,0.02)]"
      >
        <RouterLink to="/profile" custom v-slot="{ navigate }">
          <button
            type="button"
            :class="[
              'group flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-surface',
              isNavActive('/profile') && 'bg-surface',
            ]"
            @click="navigate"
          >
            <span
              class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ieee-50 text-xs font-semibold uppercase text-ieee-700 ring-2 ring-white"
              aria-hidden="true"
            >
              {{ userInitials }}
            </span>
            <span class="flex min-w-0 flex-1 flex-col leading-tight">
              <span class="truncate text-sm font-semibold text-text">{{ auth.displayName }}</span>
              <span v-if="auth.email" class="truncate text-[11px] text-text-subtle">{{ auth.email }}</span>
            </span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="h-3.5 w-3.5 shrink-0 text-text-subtle opacity-0 transition group-hover:opacity-100"
              aria-hidden="true"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" />
            </svg>
          </button>
        </RouterLink>

        <div class="mx-2 my-1 h-px bg-border-subtle" aria-hidden="true" />

        <div class="flex items-center gap-1.5 px-1 pb-0.5">
          <div ref="langWrapperRef" class="relative flex-1">
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-text-subtle transition hover:bg-surface hover:text-text"
              :aria-expanded="langOpen"
              aria-haspopup="listbox"
              @click="langOpen = !langOpen"
            >
              <FlagIcon :code="selectedLocale.flag" :width="18" shape="circle" />
              <span class="min-w-0 flex-1 truncate">{{ selectedLocale.label }}</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                class="h-3 w-3 shrink-0 transition-transform"
                :class="langOpen && 'rotate-180'"
                aria-hidden="true"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
              </svg>
            </button>

            <Transition
              enter-active-class="transition duration-150 ease-out"
              enter-from-class="opacity-0 translate-y-1 scale-95"
              enter-to-class="opacity-100 translate-y-0 scale-100"
              leave-active-class="transition duration-100 ease-in"
              leave-from-class="opacity-100 translate-y-0 scale-100"
              leave-to-class="opacity-0 translate-y-1 scale-95"
            >
              <ul
                v-if="langOpen"
                role="listbox"
                class="absolute bottom-full left-0 right-0 z-30 mb-2 origin-bottom overflow-hidden rounded-2xl border border-border bg-surface p-2 shadow-[0_12px_32px_rgba(15,23,42,0.12)]"
              >
                <li
                  v-for="option in SUPPORTED_LOCALES"
                  :key="option.code"
                  role="option"
                  :aria-selected="selectedLocale.code === option.code"
                >
                  <button
                    type="button"
                    :class="[
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition',
                      selectedLocale.code === option.code
                        ? 'bg-ieee-50 text-ieee-800 font-semibold'
                        : 'text-text hover:bg-surface-subtle',
                    ]"
                    @click="pickLocale(option.code)"
                  >
                    <FlagIcon :code="option.flag" :width="24" shape="circle" />
                    <span class="flex-1 truncate">{{ option.label }}</span>
                    <span
                      :class="[
                        'grid h-4 w-4 shrink-0 place-items-center rounded-full border transition',
                        selectedLocale.code === option.code
                          ? 'border-ieee-700 bg-ieee-700'
                          : 'border-border bg-surface',
                      ]"
                      aria-hidden="true"
                    >
                      <span
                        v-if="selectedLocale.code === option.code"
                        class="h-1.5 w-1.5 rounded-full bg-white"
                      />
                    </span>
                  </button>
                </li>
              </ul>
            </Transition>
          </div>

          <button
            type="button"
            class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-text-subtle transition hover:bg-danger/10 hover:text-danger focus-visible:bg-danger/10 focus-visible:text-danger focus-visible:outline-none"
            :title="t('nav.logout', 'Log Out')"
            :aria-label="t('nav.logout', 'Log Out')"
            @click="logoutDialogOpen = true"
          >
            <Icon :icon="Logout01Icon" :size="16" />
          </button>
        </div>
      </div>

      <div v-else class="flex flex-col items-center gap-1">
        <RouterLink to="/profile" custom v-slot="{ navigate }">
          <button
            type="button"
            :class="[
              'grid h-10 w-10 place-items-center rounded-full transition hover:bg-surface-subtle',
              isNavActive('/profile') && 'bg-surface-subtle',
            ]"
            :title="auth.displayName || t('nav.profile', 'Profile')"
            :aria-label="t('nav.profile', 'Profile')"
            @click="navigate"
          >
            <span
              class="grid h-9 w-9 place-items-center rounded-full bg-ieee-50 text-xs font-semibold uppercase text-ieee-700"
              aria-hidden="true"
            >
              {{ userInitials }}
            </span>
          </button>
        </RouterLink>

        <div ref="langWrapperRef" class="relative">
          <button
            type="button"
            class="grid h-10 w-10 place-items-center rounded-full text-text-subtle transition hover:bg-surface-subtle hover:text-text"
            :aria-expanded="langOpen"
            aria-haspopup="listbox"
            :title="selectedLocale.label"
            :aria-label="selectedLocale.label"
            @click="langOpen = !langOpen"
          >
            <FlagIcon :code="selectedLocale.flag" :width="22" shape="circle" />
          </button>

          <Transition
            enter-active-class="transition duration-150 ease-out"
            enter-from-class="opacity-0 -translate-x-1 scale-95"
            enter-to-class="opacity-100 translate-x-0 scale-100"
            leave-active-class="transition duration-100 ease-in"
            leave-from-class="opacity-100 translate-x-0 scale-100"
            leave-to-class="opacity-0 -translate-x-1 scale-95"
          >
            <ul
              v-if="langOpen"
              role="listbox"
              class="absolute bottom-0 left-full z-30 ml-2 w-48 origin-bottom-left overflow-hidden rounded-2xl border border-border bg-surface p-2 shadow-[0_12px_32px_rgba(15,23,42,0.12)]"
            >
              <li
                v-for="option in SUPPORTED_LOCALES"
                :key="option.code"
                role="option"
                :aria-selected="selectedLocale.code === option.code"
              >
                <button
                  type="button"
                  :class="[
                    'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition',
                    selectedLocale.code === option.code
                      ? 'bg-ieee-50 text-ieee-800 font-semibold'
                      : 'text-text hover:bg-surface-subtle',
                  ]"
                  @click="pickLocale(option.code)"
                >
                  <FlagIcon :code="option.flag" :width="24" shape="circle" />
                  <span class="flex-1 truncate">{{ option.label }}</span>
                  <span
                    :class="[
                      'grid h-4 w-4 shrink-0 place-items-center rounded-full border transition',
                      selectedLocale.code === option.code
                        ? 'border-ieee-700 bg-ieee-700'
                        : 'border-border bg-surface',
                    ]"
                    aria-hidden="true"
                  >
                    <span
                      v-if="selectedLocale.code === option.code"
                      class="h-1.5 w-1.5 rounded-full bg-white"
                    />
                  </span>
                </button>
              </li>
            </ul>
          </Transition>
        </div>

        <button
          type="button"
          class="grid h-10 w-10 place-items-center rounded-full text-text-subtle transition hover:bg-danger/10 hover:text-danger"
          :title="t('nav.logout', 'Log Out')"
          :aria-label="t('nav.logout', 'Log Out')"
          @click="logoutDialogOpen = true"
        >
          <Icon :icon="Logout01Icon" :size="18" />
        </button>
      </div>
    </footer>

    <ConfirmDialog
      v-model:open="logoutDialogOpen"
      :title="t('nav.logoutDialog.title', 'Log out?')"
      :description="t('nav.logoutDialog.body', 'You will be signed out of this admin workspace.')"
      :confirm-label="t('nav.logoutDialog.confirm', 'Log Out')"
      @confirm="onLogout"
    />

    <CommandPalette v-model:open="paletteOpen" />
  </aside>
</template>
