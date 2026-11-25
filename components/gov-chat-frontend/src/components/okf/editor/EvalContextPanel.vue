<!--
  EvalContextPanel.vue — the Evaluation Context COMPOSER (OKF Testing Lab,
  #2061 phase 4 / E-5).

  WHY THIS EXISTS (2026-11-24): the phase-3 work shipped the whole
  Evaluation Context API — a named, versioned, snapshot-resolved principal —
  and the operator had NO way to reach it: the Lab's dialog had no context
  affordance at all, so every suite was minted against the deployment
  ("open context") and every run measured the deployment rather than a
  group's scope. The engine was there; the surface was not. This file is
  that surface.

  THE MODEL, IN ONE PARAGRAPH: an evaluation context is a DUMMY USER with
  group memberships. A name plus the groups it belongs to; the union of
  those groups' grants is the principal it resolves to — the same reduction
  a real multi-group token gets, computed by the one authority
  (resolveGraphSet) and FROZEN at a version. It is NOT a Keycloak role and
  NOT a Keycloak user you can log in as: it is an OKF-side snapshot of what
  such a principal would resolve to. A context is MANAGEABLE (David,
  2026-11-25): it can be renamed, its memberships added/removed (each
  change re-resolves and bumps the version), and deleted — a delete is
  REFUSED while any test suite is bound to the context, because a suite's
  frozen snapshot must not outlive its principal's catalogue entry
  silently. The composer still PREVIEWS a resolution before it commits.

  THE THREE FACTS THE OPERATOR MUST SEE, or the number is not evidence:
    1. WHICH memberships it holds (the groups) — a run must say which
       principal was measured;
    2. WHAT it reaches (the repositories the union resolves to);
    3. its VERSION and the two comparison hashes — the version alone says
       nothing about comparability.

  HONEST STATES: a group that cannot be read is REPORTED (the preview says
  so) — never silently widened to the public corpus. A create that is
  refused says what was refused.
-->
<template>
  <div class="okf-evalctx">
    <!-- The catalogue -->
    <section class="okf-evalctx__catalogue" aria-labelledby="okf-evalctx-catalogue">
      <h3 id="okf-evalctx-catalogue" class="okf-evalctx__heading">
        {{ translate('okf.testingLab.contexts.catalogue', 'Evaluation contexts') }}
      </h3>
      <p class="okf-evalctx__hint">
        {{
          translate(
            'okf.testingLab.contexts.catalogueHint',
            'A context is a named principal: a set of group memberships, resolved once and frozen. A suite minted for a context is measured over that context — never over the whole deployment.'
          )
        }}
      </p>
      <DsSpinner v-if="loading && !contexts.length" size="sm" />
      <p v-else-if="!contexts.length" class="okf-evalctx__empty">
        {{
          translate(
            'okf.testingLab.contexts.empty',
            'No evaluation context yet. Compose one below — it is the scope a scoped evaluation is measured over.'
          )
        }}
      </p>
      <ul v-else class="okf-evalctx__list">
        <li v-for="c in contexts" :key="c._key" class="okf-evalctx__item">
          <div class="okf-evalctx__item-head">
            <span class="okf-evalctx__item-name">{{ c.name }}</span>
            <DsStatusTag variant="neutral" small>
              {{ translate('okf.testingLab.contexts.version', 'v{n}').replace('{n}', String(c.version || 1)) }}
            </DsStatusTag>
            <!-- The STORED verdict is the authority: a context with explicit
                 scopes but no group refs is NOT the open context, and the
                 client must not relabel it from a shape guess. -->
            <DsStatusTag v-if="c.resolved && c.resolved.open_context" variant="warning" small>
              {{ translate('okf.testingLab.contexts.open', 'open context') }}
            </DsStatusTag>
          </div>
          <div class="okf-evalctx__item-meta">
            <span>
              {{
                translate('okf.testingLab.contexts.memberships', '{n} membership(s)').replace(
                  '{n}',
                  String((c.principal_refs || []).length)
                )
              }}
            </span>
            <span>
              {{
                translate('okf.testingLab.contexts.repos', '{n} repository(ies)').replace(
                  '{n}',
                  String(((c.resolved && c.resolved.repos) || []).length)
                )
              }}
            </span>
            <span v-if="c.resolved && c.resolved.hash" class="okf-evalctx__hash">
              {{
                translate('okf.testingLab.contexts.hash', 'set {h}').replace(
                  '{h}',
                  String(c.resolved.hash).slice(0, 10)
                )
              }}
            </span>
          </div>
          <ul v-if="(c.principal_refs || []).length" class="okf-evalctx__memberships">
            <li v-for="m in c.principal_refs" :key="m" class="okf-evalctx__membership">{{ m }}</li>
          </ul>
          <div class="okf-evalctx__item-actions">
            <DsButton variant="secondary" small :disabled="busy" @click="onRefresh(c)">
              {{ translate('okf.testingLab.contexts.refresh', 'Refresh') }}
            </DsButton>
            <DsButton variant="secondary" small :disabled="busy" @click="onEdit(c)">
              {{ translate('okf.testingLab.contexts.edit', 'Edit') }}
            </DsButton>
            <!-- The delete is refused SERVER-side while any suite is bound
                 to the context — the refusal names the suites, so the
                 button is honest even when it fails. -->
            <DsButton variant="secondary" small :disabled="busy" @click="onDelete(c)">
              {{ translate('okf.testingLab.contexts.delete', 'Delete') }}
            </DsButton>
          </div>
        </li>
      </ul>
    </section>

    <!-- The composer -->
    <section class="okf-evalctx__composer" aria-labelledby="okf-evalctx-composer">
      <h3 id="okf-evalctx-composer" class="okf-evalctx__heading">
        {{ translate('okf.testingLab.contexts.compose', 'Compose a context') }}
      </h3>
      <label class="okf-evalctx__label" for="okf-evalctx-name">
        {{ translate('okf.testingLab.contexts.name', 'Name') }}
      </label>
      <DsInput
        id="okf-evalctx-name"
        v-model="name"
        type="text"
        size="sm"
        :maxlength="80"
        :placeholder="translate('okf.testingLab.contexts.namePlaceholder', 'e.g. ministry-a readers')"
      />

      <label class="okf-evalctx__label" for="okf-evalctx-group">
        {{ translate('okf.testingLab.contexts.addMembership', 'Add a membership (a group)') }}
      </label>
      <DsCombobox
        id="okf-evalctx-group"
        v-model="pickedGroup"
        :options="groupOptions"
        option-label="label"
        option-value="value"
        :placeholder="translate('okf.testingLab.contexts.groupPlaceholder', 'Search the realm groups…')"
        :search-placeholder="translate('okf.testingLab.contexts.groupSearch', 'Search groups…')"
        :no-results-text="translate('okf.testingLab.contexts.noGroups', 'No group matches')"
        @update:model-value="onAddMembership"
      />

      <ul v-if="memberships.length" class="okf-evalctx__chosen">
        <li v-for="m in memberships" :key="m.name" class="okf-evalctx__chosen-item">
          <span class="okf-evalctx__chosen-name">{{ m.name }}</span>
          <span class="okf-evalctx__chosen-meta">
            <!-- grants null = the groups catalogue could not match this
                 membership (a >100-group realm, a uuid-shaped ref, a failed
                 groups read): UNKNOWN, never a counted zero that says a
                 carrying group grants nothing. -->
            {{
              m.grants === null
                ? translate('okf.testingLab.contexts.grantsUnknown', 'grants unknown')
                : translate('okf.testingLab.contexts.grants', '{n} grant(s)', { n: (m.grants || []).length })
            }}
            <template v-if="m.member_count">
              ·
              <!-- A paged membership read that hit its cap says so in its
                   OWN sentence — per-locale phrasable, never a locale-blind
                   "+" glued to a number. -->
              {{
                m.members_truncated
                  ? translate('okf.testingLab.contexts.membersTruncated', '{n}+ member(s) — the read is capped', {
                      n: String(m.member_count)
                    })
                  : translate('okf.testingLab.contexts.members', '{n} member(s)', { n: String(m.member_count) })
              }}
            </template>
          </span>
          <DsButton
            variant="ghost"
            small
            :aria-label="translate('okf.testingLab.contexts.remove', 'Remove {n}', { n: m.name })"
            @click="onRemoveMembership(m.name)"
          >
            ×
          </DsButton>
        </li>
      </ul>
      <p v-else class="okf-evalctx__hint">
        {{
          translate(
            'okf.testingLab.contexts.noMemberships',
            'No membership yet — with none, the context resolves to the deployment (the open context).'
          )
        }}
      </p>

      <!-- The preview: what the create WOULD freeze. A context is immutable
           and cannot be deleted, so the operator sees the union BEFORE it
           commits. -->
      <div class="okf-evalctx__preview">
        <DsButton variant="secondary" small :disabled="busy" @click="onPreview">
          {{ translate('okf.testingLab.contexts.preview', 'Preview what this reaches') }}
        </DsButton>
        <div v-if="preview" class="okf-evalctx__preview-body">
          <p class="okf-evalctx__preview-line">
            <strong>{{ translate('okf.testingLab.contexts.previewRepos', 'Reaches') }}:</strong>
            {{
              translate('okf.testingLab.contexts.repos', '{n} repository(ies)').replace(
                '{n}',
                String(((preview.resolved && preview.resolved.repos) || []).length)
              )
            }}
          </p>
          <ul v-if="((preview.resolved && preview.resolved.repos) || []).length" class="okf-evalctx__preview-repos">
            <li v-for="r in preview.resolved.repos" :key="r.repo_id">{{ r.name || r.repo_id }}</li>
          </ul>
          <p v-if="(preview.unreadable || []).length" class="okf-evalctx__error" role="alert">
            {{
              translate('okf.testingLab.contexts.unreadable', 'These memberships could not be read: {list}').replace(
                '{list}',
                preview.unreadable.join(', ')
              )
            }}
          </p>
          <ul v-if="(preview.warnings || []).length" class="okf-evalctx__warnings">
            <li v-for="(w, i) in preview.warnings" :key="i">{{ w }}</li>
          </ul>
        </div>
      </div>

      <!-- The EDIT banner (David, 2026-11-25): the composer doubles as the
           editor — an edit loads the stored name + memberships (with their
           grants) into these same controls, and saving re-resolves. -->
      <p v-if="editingKey" class="okf-evalctx__edit-banner" role="status">
        {{
          translate(
            'okf.testingLab.contexts.editing',
            'Editing {name} — saving re-resolves the union and bumps the version.',
            {
              name
            }
          )
        }}
        <DsButton variant="ghost" small :disabled="busy" @click="onCancelEdit">
          {{ translate('okf.testingLab.contexts.cancelEdit', 'Cancel') }}
        </DsButton>
      </p>

      <div class="okf-evalctx__actions">
        <DsButton
          variant="primary"
          small
          :disabled="busy || !name.trim()"
          @click="editingKey ? onSaveEdit() : onCreate()"
        >
          {{
            editingKey
              ? translate('okf.testingLab.contexts.save', 'Save the changes')
              : translate('okf.testingLab.contexts.create', 'Create the context')
          }}
        </DsButton>
        <DsSpinner v-if="busy" size="sm" />
      </div>
      <p v-if="error" class="okf-evalctx__error" role="alert">{{ error }}</p>
      <p v-if="note" class="okf-evalctx__note" role="status">{{ note }}</p>
    </section>
  </div>
</template>

<script>
import DsButton from '@/components/ds/Button.vue';
import DsCombobox from '@/components/ds/Combobox.vue';
import DsInput from '@/components/ds/Input.vue';
import DsSpinner from '@/components/ds/Spinner.vue';
import DsStatusTag from '@/components/ds/StatusTag.vue';
import evalContextSurfaceMixin from '@/mixins/evalContextSurfaceMixin';
import evalContextService from '@/services/evalContextService';

/**
 * The composer's state. The catalogue and the group's grants are READ
 * through the service; nothing here computes a resolution — the server
 * owns that (one authority).
 */
export default {
  name: 'EvalContextPanel',
  components: { DsButton, DsCombobox, DsInput, DsSpinner, DsStatusTag },
  mixins: [evalContextSurfaceMixin],
  data() {
    return {
      contexts: [],
      groups: [],
      memberships: [],
      name: '',
      pickedGroup: '',
      preview: null,
      /** The composer doubles as the EDITOR: null = composing a new
       *  context; a key = the loaded context the controls are editing. */
      editingKey: null,
      busy: false,
      loading: false,
      error: '',
      note: ''
    };
  },
  computed: {
    /** The combobox's options: the realm's groups, minus the chosen ones.
     *  DsCombobox reads only label/value — the grants and member counts
     *  render on the CHOSEN rows, not in the dropdown. */
    groupOptions() {
      const chosen = new Set(this.memberships.map((m) => m.name));
      return this.groups.filter((g) => !chosen.has(g.name)).map((g) => ({ value: g.name, label: g.name }));
    }
  },
  async mounted() {
    await this.loadAll();
  },
  methods: {
    /** The catalogue + the composer's source, in one pass (mount only —
     *  the groups read fans out server-side, so a create or a refresh must
     *  not re-trigger it: groups do not change when contexts do). */
    async loadAll() {
      this.loading = true;
      this.error = '';
      try {
        const [contexts, groups] = await Promise.all([
          evalContextService.listContexts(),
          evalContextService.listGroups('')
        ]);
        this.contexts = contexts;
        this.groups = groups;
      } catch (err) {
        this.error = this.errorText(err);
      } finally {
        this.loading = false;
      }
    },

    /** Reload ONLY the catalogue (after a write changed it). */
    async loadContexts() {
      try {
        this.contexts = await evalContextService.listContexts();
      } catch (err) {
        this.error = this.errorText(err);
      }
    },

    /** The graft every membership entry goes through: the loaded group's
     *  facts when the catalogue holds it, and — when it cannot (a >100-group
     *  realm, a uuid-shaped ref, a failed groups read) — a placeholder with
     *  grants UNKNOWN (null), never a counted zero. */
    graftMembership(name) {
      const found = this.groups.find((g) => g.name === name);
      return found ? { ...found } : { name, grants: null, member_count: 0 };
    },

    onAddMembership(name) {
      const ref = String(name || '').trim();
      this.pickedGroup = '';
      if (!ref) return;
      if (this.memberships.some((m) => m.name === ref)) return;
      this.memberships.push(this.graftMembership(ref));
      this.preview = null;
    },

    onRemoveMembership(name) {
      this.memberships = this.memberships.filter((m) => m.name !== name);
      this.preview = null;
    },

    /** The write cycle every mutation shares: busy, the honest error, the
     *  catalogue reload (the service's own write already dropped its memo),
     *  the note. `work` returns what the note may need. */
    async runWrite(work, noteKey, noteDefault) {
      this.busy = true;
      this.error = '';
      this.note = '';
      try {
        const out = await work();
        await this.loadContexts();
        this.note = this.translate(noteKey, noteDefault);
        return out;
      } catch (err) {
        this.error = this.errorText(err);
        return null;
      } finally {
        this.busy = false;
      }
    },

    /** The resolution the create WOULD freeze — nothing is written. */
    async onPreview() {
      this.busy = true;
      this.error = '';
      this.note = '';
      try {
        this.preview = await evalContextService.previewContext({
          principal_refs: this.memberships.map((m) => m.name)
        });
      } catch (err) {
        this.error = this.errorText(err);
        this.preview = null;
      } finally {
        this.busy = false;
      }
    },

    /** CREATE: the server resolves, freezes and audits it. Only the
     *  CATALOGUE changed — the groups list is untouched, so it is not
     *  re-fetched (its read is the expensive one). */
    onCreate() {
      return this.runWrite(
        async () => {
          const created = await evalContextService.createContext({
            name: this.name.trim(),
            principal_refs: this.memberships.map((m) => m.name)
          });
          this.name = '';
          this.memberships = [];
          this.preview = null;
          return created;
        },
        'okf.testingLab.contexts.created',
        'The context was created and frozen.'
      ).then((created) => {
        if (created && created.name) this.note += ` ${created.name}`;
      });
    },

    /** REFRESH: re-resolve the same memberships; the version bumps. */
    onRefresh(c) {
      return this.runWrite(
        () => evalContextService.refreshContext(c._key),
        'okf.testingLab.contexts.refreshed',
        'The context was re-resolved.'
      );
    },

    /**
     * EDIT (David, 2026-11-25): load a stored context into the composer.
     * The stored refs are NAMES; they are grafted onto the loaded groups
     * so the operator sees the GRANTS each membership carries — the groups
     * of an existing context are visible here, not just their count.
     */
    onEdit(c) {
      this.editingKey = c._key;
      this.name = c.name;
      this.memberships = (c.principal_refs || []).map((name) => this.graftMembership(name));
      this.preview = null;
      this.error = '';
      this.note = '';
    },

    onCancelEdit() {
      this.editingKey = null;
      this.name = '';
      this.memberships = [];
      this.preview = null;
    },

    /**
     * SAVE the edit: the name and the memberships go as ONE update — the
     * server re-resolves a changed membership set and bumps the version.
     */
    onSaveEdit() {
      if (!this.editingKey) return Promise.resolve();
      const key = this.editingKey;
      return this.runWrite(
        async () => {
          const updated = await evalContextService.updateContext(key, {
            name: this.name.trim(),
            principal_refs: this.memberships.map((m) => m.name)
          });
          this.onCancelEdit();
          return updated;
        },
        'okf.testingLab.contexts.updated',
        'The context was updated and re-resolved.'
      );
    },

    /**
     * DELETE: refused server-side (409, naming the bound suites) while any
     * test suite is minted for the context — that refusal renders here via
     * errorText, so the operator learns WHICH suites hold it in place.
     */
    onDelete(c) {
      return this.runWrite(
        async () => {
          const out = await evalContextService.deleteContext(c._key);
          // Deleting the row being EDITED leaves the composer — a stale edit
          // banner over a removed row would 404 on its next Save.
          if (c._key === this.editingKey) this.onCancelEdit();
          return out;
        },
        'okf.testingLab.contexts.deleted',
        'The context was removed.'
      );
    }
  }
};
</script>

<style scoped>
.okf-evalctx {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1.25rem;
  align-items: start;
}

.okf-evalctx__heading {
  margin: 0 0 0.35rem;
  font-size: 0.95rem;
  font-weight: 600;
}

.okf-evalctx__hint {
  margin: 0 0 0.6rem;
  font-size: 0.8rem;
  color: var(--muted);
}

.okf-evalctx__label {
  display: block;
  margin: 0.5rem 0 0.2rem;
  font-size: 0.78rem;
  font-weight: 600;
}

.okf-evalctx__list,
.okf-evalctx__memberships,
.okf-evalctx__chosen,
.okf-evalctx__preview-repos,
.okf-evalctx__warnings {
  list-style: none;
  margin: 0;
  padding: 0;
}

.okf-evalctx__item {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.5rem 0.6rem;
  margin-bottom: 0.5rem;
}

.okf-evalctx__item-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.okf-evalctx__item-name {
  font-weight: 600;
}

.okf-evalctx__item-meta {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.2rem;
  font-size: 0.75rem;
  color: var(--muted);
}

.okf-evalctx__memberships {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.3rem;
}

.okf-evalctx__membership {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.05rem 0.45rem;
  font-size: 0.72rem;
}

.okf-evalctx__item-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.35rem;
}

.okf-evalctx__edit-banner {
  margin: 0.6rem 0 0;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.78rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.okf-evalctx__chosen {
  margin-top: 0.4rem;
}

.okf-evalctx__chosen-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.15rem 0;
  font-size: 0.78rem;
}

.okf-evalctx__chosen-name {
  font-weight: 600;
}

.okf-evalctx__chosen-meta {
  color: var(--muted);
  font-size: 0.72rem;
}

.okf-evalctx__preview {
  margin-top: 0.6rem;
}

.okf-evalctx__preview-body {
  margin-top: 0.35rem;
  font-size: 0.78rem;
}

.okf-evalctx__preview-repos {
  margin-top: 0.2rem;
}

.okf-evalctx__preview-line {
  margin: 0;
}

.okf-evalctx__actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.7rem;
}

.okf-evalctx__error {
  margin: 0.5rem 0 0;
  color: var(--danger);
  font-size: 0.78rem;
}

.okf-evalctx__note {
  margin: 0.5rem 0 0;
  font-size: 0.78rem;
}

.okf-evalctx__warnings li {
  margin-top: 0.2rem;
  font-size: 0.75rem;
}
</style>
