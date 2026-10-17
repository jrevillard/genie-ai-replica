<!--
  OkfAccessPanel.vue — Story 6-1c per-repository access control (2026-10-16).

  The editor's right-rail panel for WHO CAN QUERY this repository:
    - a restriction toggle (restricted repos are fenced off from regular
      users until granted; unrestricted repos follow the deployment's
      default-open rule — every new repo starts OPEN for all users),
    - the grant/revoke UI. Grants are QUERY ACCESS, period — this panel's
      only audience is stewards (regular users never reach the editor), so
      no "levels" are exposed; stewardship comes from realm roles, not here.

  The USER GRANT is a picker dialog with server-side search and TWO bulk
  paths, sized for hundreds/thousands of users (David, 2026-10-17):
    - checkboxes on the visible page (a handful of known users),
    - "select all N matching" → grant-by-search: the SERVER walks every
      directory page matching the query and grants each user. 3 clicks for
      1,000 users; no username list ever crosses the wire.
  GROUP grants remain the path for entire populations (one operation, any
  member count).

  The panel degrades honestly when okf-server has no Keycloak credentials
  (configured=false): the toggle still works (enforcement needs no
  Keycloak) and grant/revoke explain themselves instead of failing blind.
-->
<template>
  <section class="okf-access" :aria-label="translate('okf.editor.access.label', 'Repository access')">
    <header class="okf-access__head">
      <h4>{{ translate('okf.editor.access.title', 'Access Control') }}</h4>
      <DsPill :variant="model.restricted ? 'danger' : 'success'">
        {{
          model.restricted
            ? translate('okf.editor.access.restricted', 'Restricted')
            : translate('okf.editor.access.openForAll', 'Open for all users')
        }}
      </DsPill>
    </header>

    <p class="okf-access__hint">
      {{
        model.restricted
          ? translate(
              'okf.editor.access.hintRestricted',
              'Only granted users (and stewards) can query this repository. Grant access below — it takes effect at the user’s next login.'
            )
          : translate(
              'okf.editor.access.hintOpen',
              'Every signed-in user can query this repository. Restrict it to fence it off and grant access per user or group.'
            )
      }}
    </p>

    <DsButton
      :variant="model.restricted ? 'secondary' : 'primary'"
      small
      :disabled="toggling || loading"
      @click="toggleRestriction"
    >
      {{
        model.restricted
          ? translate('okf.editor.access.unrestrict', 'Open for all users')
          : translate('okf.editor.access.restrict', 'Restrict repository')
      }}
    </DsButton>

    <div v-if="!model.configured" class="okf-access__unconfigured">
      <DsInfoTip
        :text="
          translate(
            'okf.editor.access.unconfiguredTip',
            'Grant/revoke needs Keycloak credentials on the server (KC_OKF_ACCESS_CLIENT_SECRET). Restriction enforcement works regardless.'
          )
        "
      />
    </div>

    <template v-else>
      <!-- GROUP grants — the population path (one operation, any member count). -->
      <table v-if="model.group_holders.length" class="okf-access__table">
        <thead>
          <tr>
            <th>{{ translate('okf.editor.access.col.group', 'Group') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in model.group_holders" :key="g.group_id">
            <td>{{ g.name }}</td>
            <td>
              <DsButton variant="secondary" small :disabled="busyGroup === g.name" @click="revokeGroup(g)">
                {{ translate('okf.editor.access.revoke', 'Revoke') }}
              </DsButton>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Per-user grants (attribute-based). -->
      <table v-if="model.user_holders.length" class="okf-access__table">
        <thead>
          <tr>
            <th>{{ translate('okf.editor.access.col.user', 'User') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in model.user_holders" :key="h.user_id">
            <td>
              {{ h.username }}
              <DsPill v-if="h.via === 'role'" variant="warning">{{
                translate('okf.editor.access.viaRole', 'direct role')
              }}</DsPill>
            </td>
            <td>
              <DsButton variant="secondary" small :disabled="busy === h.username" @click="revoke(h.username)">
                {{ translate('okf.editor.access.revoke', 'Revoke') }}
              </DsButton>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!model.user_holders.length && !model.group_holders.length" class="okf-access__empty">
        {{ translate('okf.editor.access.noHolders', 'No users or groups granted yet.') }}
      </p>

      <DsButton variant="primary" small class="okf-access__grant-btn" @click="openPicker">
        {{ translate('okf.editor.access.grantUsersCta', 'Grant access to users…') }}
      </DsButton>

      <div class="okf-access__grant">
        <DsInput
          v-model="grantGroupName"
          type="text"
          :placeholder="translate('okf.editor.access.groupPlaceholder', 'Group name')"
          class="okf-access__grant-user"
        />
        <DsButton variant="primary" small :disabled="!grantGroupName || busyGroup !== null" @click="grantGroup">
          {{ translate('okf.editor.access.grantGroup', 'Grant group') }}
        </DsButton>
      </div>
      <p class="okf-access__hint">
        {{
          translate(
            'okf.editor.access.groupHint',
            'Every member of the group gains access at their next login — one operation for any number of users.'
          )
        }}
      </p>
    </template>

    <!-- USER PICKER — server-side search + checkboxes + grant-by-search. -->
    <DsDialog
      :visible="pickerOpen"
      :title="translate('okf.editor.access.pickerTitle', 'Grant query access')"
      size="lg"
      :actions="pickerActions"
      @close="closePicker"
      @action="onPickerAction"
    >
      <div class="okf-access__picker">
        <DsInput
          v-model="pickerQuery"
          type="text"
          class="okf-access__picker-search"
          :placeholder="translate('okf.editor.access.pickerSearch', 'Search users by name, username or email')"
        />
        <p v-if="pickerLoading" class="okf-access__picker-status">
          {{ translate('okf.editor.access.pickerSearching', 'Searching…') }}
        </p>
        <!-- Grant-by-search bar: only when the query matches MORE than the page —
             this is the path that scales to hundreds and thousands of users. -->
        <div
          v-if="!pickerLoading && grantByQuery === null && pickerTotal > pickerUsers.length"
          class="okf-access__picker-all"
        >
          <span class="okf-access__picker-match">
            {{
              translate('okf.editor.access.pickerMatching', '{n} users match this search').replace(
                '{n}',
                String(pickerTotal)
              )
            }}
          </span>
          <DsButton variant="secondary" small @click="grantByQuery = true">
            {{ translate('okf.editor.access.pickerSelectAll', 'Select all {n}').replace('{n}', String(pickerTotal)) }}
          </DsButton>
        </div>
        <div v-else-if="grantByQuery" class="okf-access__picker-all okf-access__picker-all--on">
          <span>
            {{
              translate('okf.editor.access.pickerAllSelected', 'All {n} matching users selected').replace(
                '{n}',
                String(pickerTotal)
              )
            }}
          </span>
          <DsButton variant="ghost" small @click="grantByQuery = null">
            {{ translate('okf.editor.access.pickerClearSelection', 'Clear') }}
          </DsButton>
        </div>

        <ul v-if="!pickerLoading && pickerUsers.length" class="okf-access__picker-list">
          <li v-for="u in pickerUsers" :key="u.id" :class="{ 'okf-access__picker-row--off': u.has_access }">
            <label class="okf-access__picker-row">
              <input
                type="checkbox"
                :checked="pickerSelected.has(u.username)"
                :disabled="u.has_access || granting"
                @change="togglePick(u)"
              />
              <span class="okf-access__picker-username">{{ u.username }}</span>
              <span class="okf-access__picker-name">{{ u.name || '' }}</span>
              <span class="okf-access__picker-email">{{ u.email || '' }}</span>
              <DsPill v-if="u.has_access" variant="success">
                {{ translate('okf.editor.access.pickerHasAccess', 'has access') }}
              </DsPill>
            </label>
          </li>
        </ul>
        <p v-else-if="!pickerLoading" class="okf-access__picker-status">
          {{ translate('okf.editor.access.pickerEmpty', 'No users match.') }}
        </p>
        <p v-if="pickerTotal > 500" class="okf-access__hint">
          {{
            translate(
              'okf.editor.access.pickerLargeHint',
              'For very large sets, prefer a group grant — one operation, any member count.'
            )
          }}
        </p>
      </div>
    </DsDialog>

    <p v-if="error" class="okf-access__error">{{ error }}</p>
    <p v-if="notice" class="okf-access__notice">{{ notice }}</p>
  </section>
</template>

<script>
import translateMixin from '../../../mixins/translateMixin';
import DsButton from '../../ds/Button.vue';
import DsPill from '../../ds/Pill.vue';
import DsInput from '../../ds/Input.vue';
import DsInfoTip from '../../ds/InfoTip.vue';
import DsDialog from '../../ds/Dialog.vue';
import repoOkfService from '../../../services/repoOkfService';

const SEARCH_DEBOUNCE_MS = 300;

export default {
  name: 'OkfAccessPanel',
  components: { DsButton, DsPill, DsInput, DsInfoTip, DsDialog },
  mixins: [translateMixin],
  props: {
    repoId: { type: String, required: true }
  },
  emits: ['changed'],
  data() {
    return {
      loading: true,
      toggling: false,
      busy: null,
      error: '',
      notice: '',
      model: {
        restricted: false,
        required_scopes: [],
        user_holders: [],
        group_holders: [],
        configured: false
      },
      grantGroupName: '',
      busyGroup: null,
      // Picker state.
      pickerOpen: false,
      pickerQuery: '',
      pickerUsers: [],
      pickerTotal: 0,
      pickerLoading: false,
      pickerSelected: new Set(),
      grantByQuery: null,
      granting: false,
      searchTimer: null
    };
  },
  computed: {
    pickerActions() {
      if (this.granting) {
        return [
          { key: 'cancel', label: this.translate('common.cancel', 'Cancel'), variant: 'secondary', disabled: true },
          {
            key: 'grant',
            label: this.translate('okf.editor.access.pickerGranting', 'Granting {n} users…').replace(
              '{n}',
              String(this.grantByQuery ? this.pickerTotal : this.pickerSelected.size)
            ),
            variant: 'primary',
            disabled: true
          }
        ];
      }
      const n = this.grantByQuery ? this.pickerTotal : this.pickerSelected.size;
      return [
        { key: 'cancel', label: this.translate('common.cancel', 'Cancel'), variant: 'secondary' },
        {
          key: 'grant',
          label: this.translate('okf.editor.access.pickerGrant', 'Grant access ({n})').replace('{n}', String(n)),
          variant: 'primary',
          disabled: n === 0
        }
      ];
    }
  },
  watch: {
    pickerQuery() {
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => this.searchUsers(), SEARCH_DEBOUNCE_MS);
    }
  },
  async created() {
    await this.refresh();
  },
  beforeUnmount() {
    clearTimeout(this.searchTimer);
  },
  methods: {
    async refresh() {
      this.loading = true;
      this.error = '';
      try {
        const m = await repoOkfService.getAccess(this.repoId);
        this.model = {
          restricted: m.restricted,
          required_scopes: m.required_scopes,
          user_holders: m.user_holders || [],
          group_holders: m.group_holders || [],
          configured: m.configured
        };
      } catch (err) {
        this.error = this.errText(err);
      } finally {
        this.loading = false;
      }
    },
    async toggleRestriction() {
      this.toggling = true;
      this.error = '';
      this.notice = '';
      try {
        const { restricted } = await repoOkfService.putAccess(this.repoId, !this.model.restricted);
        this.model.restricted = restricted;
        this.notice = restricted
          ? this.translate('okf.editor.access.nowRestricted', 'Repository restricted.')
          : this.translate('okf.editor.access.nowOpen', 'Repository open for all users.');
        this.$emit('changed');
      } catch (err) {
        this.error = this.errText(err);
      } finally {
        this.toggling = false;
      }
    },
    openPicker() {
      this.pickerOpen = true;
      this.pickerQuery = '';
      this.pickerUsers = [];
      this.pickerTotal = 0;
      this.pickerSelected = new Set();
      this.grantByQuery = null;
      this.granting = false;
      this.searchUsers();
    },
    closePicker() {
      if (this.granting) return; // a bulk grant is in flight — keep the dialog up
      this.pickerOpen = false;
    },
    async searchUsers() {
      this.pickerLoading = true;
      try {
        const out = await repoOkfService.getAccessUsers(this.repoId, this.pickerQuery);
        this.pickerUsers = (out && out.users) || [];
        this.pickerTotal = (out && out.total_matching) || 0;
        this.grantByQuery = null; // a new search invalidates select-all-matching
        // Drop selections that no longer appear (stale picks across searches).
        const visible = new Set(this.pickerUsers.map((u) => u.username));
        this.pickerSelected = new Set(Array.from(this.pickerSelected).filter((u) => visible.has(u)));
      } catch (err) {
        this.error = this.errText(err);
      } finally {
        this.pickerLoading = false;
      }
    },
    togglePick(u) {
      if (u.has_access) return;
      const next = new Set(this.pickerSelected);
      if (next.has(u.username)) next.delete(u.username);
      else next.add(u.username);
      this.pickerSelected = next;
    },
    async onPickerAction(key) {
      if (key === 'cancel') {
        this.closePicker();
        return;
      }
      if (key !== 'grant' || this.granting) return;
      const byQuery = this.grantByQuery !== null;
      const usernames = Array.from(this.pickerSelected);
      if (!byQuery && !usernames.length) return;
      this.granting = true;
      this.error = '';
      this.notice = '';
      try {
        const out = byQuery
          ? await repoOkfService.grantAccess(this.repoId, { query: this.pickerQuery.trim() })
          : await repoOkfService.grantAccess(this.repoId, { usernames });
        const missing = (out && out.missing) || [];
        const n = byQuery ? (out && out.granted) || 0 : (out && out.granted && out.granted.length) || 0;
        this.notice = missing.length
          ? this.translate('okf.editor.access.grantedSomeNotice', 'Granted {n} — unknown: {m}')
              .replace('{n}', String(n))
              .replace('{m}', missing.join(', '))
          : this.translate('okf.editor.access.grantedNotice', 'Access granted — effective at each user’s next login.');
        if (byQuery && out && out.granted !== undefined) {
          this.notice = this.translate(
            'okf.editor.access.grantedQueryNotice',
            'Granted {n} users — effective at each user’s next login.'
          ).replace('{n}', String(out.granted));
        }
        this.pickerOpen = false;
        await this.refresh();
      } catch (err) {
        this.error = this.errText(err);
      } finally {
        this.granting = false;
      }
    },
    async grantGroup() {
      this.busyGroup = this.grantGroupName;
      this.error = '';
      this.notice = '';
      try {
        await repoOkfService.grantGroupAccess(this.repoId, { group: this.grantGroupName.trim() });
        this.notice = this.translate(
          'okf.editor.access.grantedGroupNotice',
          'Group granted — every member gains access at next login.'
        );
        this.grantGroupName = '';
        await this.refresh();
      } catch (err) {
        this.error = this.errText(err);
      } finally {
        this.busyGroup = null;
      }
    },
    async revokeGroup(g) {
      this.busyGroup = g.name;
      this.error = '';
      this.notice = '';
      try {
        await repoOkfService.revokeGroupAccess(this.repoId, { group: g.name });
        this.notice = this.translate('okf.editor.access.revokedNotice', 'Access revoked.');
        await this.refresh();
      } catch (err) {
        this.error = this.errText(err);
      } finally {
        this.busyGroup = null;
      }
    },
    async revoke(username) {
      this.busy = username;
      this.error = '';
      this.notice = '';
      try {
        await repoOkfService.revokeAccess(this.repoId, { username });
        this.notice = this.translate('okf.editor.access.revokedNotice', 'Access revoked.');
        await this.refresh();
      } catch (err) {
        this.error = this.errText(err);
      } finally {
        this.busy = null;
      }
    },
    errText(err) {
      if (err && err.response && err.response.data && err.response.data.message) {
        return err.response.data.message;
      }
      return (err && err.message) || this.translate('okf.editor.access.error', 'Operation failed.');
    }
  }
};
</script>

<style scoped>
.okf-access {
  border-top: 1px solid var(--border, var(--border-light));
  padding-top: 12px;
  margin-top: 12px;
}
.okf-access__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.okf-access__head h4 {
  margin: 0;
  font-size: 13px;
}
.okf-access__hint {
  margin: 8px 0;
  font-size: 12px;
  color: var(--muted);
}
.okf-access__table {
  width: 100%;
  margin-top: 12px;
  font-size: 12px;
  border-collapse: collapse;
}
.okf-access__table th {
  text-align: left;
  font-weight: 600;
  padding: 4px 6px 4px 0;
}
.okf-access__table td {
  padding: 4px 6px 4px 0;
  border-top: 1px solid var(--border, var(--border-light));
}
.okf-access__grant {
  display: flex;
  gap: 6px;
  margin-top: 10px;
  align-items: center;
}
.okf-access__grant-user {
  flex: 1;
}
.okf-access__grant-btn {
  margin-top: 12px;
}
.okf-access__error {
  color: var(--danger);
  font-size: 12px;
  margin: 8px 0 0;
}
.okf-access__notice {
  color: var(--success);
  font-size: 12px;
  margin: 8px 0 0;
}
.okf-access__empty {
  font-size: 12px;
  color: var(--muted);
}
.okf-access__unconfigured {
  margin-top: 10px;
}
.okf-access__picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.okf-access__picker-search {
  width: 100%;
}
.okf-access__picker-all {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--border, var(--border-light));
  border-radius: 6px;
  font-size: 12px;
}
.okf-access__picker-all--on {
  border-color: var(--primary);
}
.okf-access__picker-match {
  color: var(--muted);
}
.okf-access__picker-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid var(--border, var(--border-light));
  border-radius: 6px;
}
.okf-access__picker-list li + li {
  border-top: 1px solid var(--border, var(--border-light));
}
.okf-access__picker-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  font-size: 12px;
  cursor: pointer;
}
.okf-access__picker-row--off .okf-access__picker-row {
  cursor: default;
  color: var(--muted);
}
.okf-access__picker-username {
  font-weight: 600;
  min-width: 120px;
}
.okf-access__picker-name {
  color: var(--muted);
  flex: 1;
}
.okf-access__picker-email {
  color: var(--muted);
}
.okf-access__picker-status {
  font-size: 12px;
  color: var(--muted);
}
</style>
