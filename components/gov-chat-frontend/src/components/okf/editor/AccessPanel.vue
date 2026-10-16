<!--
  OkfAccessPanel.vue — Story 6-1c per-repository access control (2026-10-16).

  The editor's right-rail panel for WHO CAN QUERY this repository:
    - a restriction toggle (restricted repos are fenced off from regular
      users until granted; unrestricted repos follow the deployment's
      default-open rule — every new repo starts OPEN for all users),
    - the grant/revoke table (writes the user's okf_scopes attribute
      through Keycloak; takes effect at the user's next login).

  The panel degrades honestly when okf-server has no Keycloak credentials
  (configured=false): the toggle still works (enforcement needs no
  Keycloak) and grant/revoke explain themselves instead of failing blind.
-->
<template>
  <section class="okf-access" :aria-label="translate('okf.editor.access.label', 'Repository access')">
    <header class="okf-access__head">
      <h4>{{ translate('okf.editor.access.title', 'Access') }}</h4>
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
              'Every signed-in user can query this repository. Restrict it to fence it off and grant access per user.'
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
      <!-- GROUP grants — the scale path: one operation, any member count. -->
      <table v-if="model.group_holders.length" class="okf-access__table">
        <thead>
          <tr>
            <th>{{ translate('okf.editor.access.col.group', 'Group') }}</th>
            <th>{{ translate('okf.editor.access.col.level', 'Level') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in model.group_holders" :key="g.group_id">
            <td>{{ g.name }}</td>
            <td>
              <DsPill variant="info">{{ g.levels.join(', ') }}</DsPill>
            </td>
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
            <th>{{ translate('okf.editor.access.col.level', 'Level') }}</th>
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
              <DsPill variant="info">{{ h.levels.join(', ') }}</DsPill>
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

      <!-- GROUP grant — the enterprise path (one operation, any member count). -->
      <div class="okf-access__grant">
        <DsInput
          v-model="grantGroupName"
          type="text"
          :placeholder="translate('okf.editor.access.groupPlaceholder', 'Group name')"
          class="okf-access__grant-user"
        />
        <DsSelect v-model="grantGroupLevel" class="okf-access__grant-level">
          <option value="read">{{ translate('okf.editor.access.levelRead', 'Read') }}</option>
          <option value="admin">{{ translate('okf.editor.access.levelAdmin', 'Admin') }}</option>
        </DsSelect>
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

      <!-- BULK per-user grant: one username per line. -->
      <textarea
        v-model="grantUsernames"
        rows="3"
        class="okf-access__grant-users"
        :placeholder="translate('okf.editor.access.usernamesPlaceholder', 'Usernames — one per line')"
      ></textarea>
      <div class="okf-access__grant">
        <DsSelect v-model="grantLevel" class="okf-access__grant-level">
          <option value="read">{{ translate('okf.editor.access.levelRead', 'Read') }}</option>
          <option value="admin">{{ translate('okf.editor.access.levelAdmin', 'Admin') }}</option>
        </DsSelect>
        <DsButton variant="primary" small :disabled="!userList.length || busy !== null" @click="grant">
          {{ translate('okf.editor.access.grant', 'Grant users') }}
        </DsButton>
      </div>
    </template>

    <p v-if="error" class="okf-access__error">{{ error }}</p>
    <p v-if="notice" class="okf-access__notice">{{ notice }}</p>
  </section>
</template>

<script>
import translateMixin from '../../../mixins/translateMixin';
import DsButton from '../../ds/Button.vue';
import DsPill from '../../ds/Pill.vue';
import DsInput from '../../ds/Input.vue';
import DsSelect from '../../ds/Select.vue';
import DsInfoTip from '../../ds/InfoTip.vue';
import repoOkfService from '../../../services/repoOkfService';

export default {
  name: 'OkfAccessPanel',
  components: { DsButton, DsPill, DsInput, DsSelect, DsInfoTip },
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
      grantUsernames: '',
      grantLevel: 'read',
      grantGroupName: '',
      grantGroupLevel: 'read',
      busyGroup: null
    };
  },
  async created() {
    await this.refresh();
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
    userList() {
      return this.grantUsernames
        .split(/[\n,;]+/)
        .map((u) => u.trim())
        .filter(Boolean);
    },
    async grant() {
      const usernames = this.userList();
      if (!usernames.length) return;
      this.busy = 'bulk';
      this.error = '';
      this.notice = '';
      try {
        const out = await repoOkfService.grantAccess(this.repoId, { usernames, level: this.grantLevel });
        const missing = (out && out.missing) || [];
        this.notice = missing.length
          ? this.translate('okf.editor.access.grantedSomeNotice', 'Granted {n} — unknown: {m}')
              .replace('{n}', String(out.granted.length))
              .replace('{m}', missing.join(', '))
          : this.translate('okf.editor.access.grantedNotice', 'Access granted — effective at next login.');
        this.grantUsernames = '';
        await this.refresh();
      } catch (err) {
        this.error = this.errText(err);
      } finally {
        this.busy = null;
      }
    },
    async grantGroup() {
      this.busyGroup = this.grantGroupName;
      this.error = '';
      this.notice = '';
      try {
        await repoOkfService.grantGroupAccess(this.repoId, {
          group: this.grantGroupName.trim(),
          level: this.grantGroupLevel
        });
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
.okf-access__grant-level {
  width: 110px;
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
.okf-access__truncated {
  color: var(--danger);
  font-size: 12px;
  margin: 6px 0 0;
}
.okf-access__empty {
  font-size: 12px;
  color: var(--muted);
}
.okf-access__unconfigured {
  margin-top: 10px;
}
</style>
