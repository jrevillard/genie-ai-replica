<!--
  OkfPiiReviewSummary.vue — WHAT THE PII SCAN ACTUALLY SAYS, shown at the
  moment a steward is about to publish.

  WHY THIS EXISTS (2026-10-13, follow-up to the 141-concept PII incident):
  a real publish carried 107 flagged concepts while the repository's
  acknowledgement record read 0. Three states rendered as one indistinguishable
  "nothing to see here":

    - never scanned / a scan ERRORED  →  the truth is UNKNOWN
    - scanned, genuinely clean          →  the truth is "found nothing"
    - N hits, nobody reviewed them      →  the truth is "found N, nobody looked"

  Only the third is waivable by an acknowledgement, and only when `pii_ack`
  actually covers the findings on screen NOW (see piiReview.js#isAckCurrent).
  A stale ack — recorded against a different flagged count, or before the scan
  that produced the current count — must never render as a completed review.

  This component OWNS THE READ. It dispatches `okf/fetchConcepts` itself, so
  the verdict at publish time is a fresh read rather than whatever the screen
  happened to be holding: the incident was a stale view, and a cache is how
  that view goes stale. While the read is in flight the verdict is `checking`,
  which renders as an explicit unknown — never as "clean".

  It is deliberately a banner with NO publish-blocking behaviour of its own:
  publishing stays free (David, 2026-10-13). What changes is that it becomes
  impossible to publish while believing you reviewed something.
-->
<template>
  <section class="okf-pii-review" :class="'okf-pii-review--' + review.verdict" role="status">
    <p class="okf-pii-review__head">
      <DsStatusTag :variant="review.variant" small>{{ headline }}</DsStatusTag>
      <span class="okf-pii-review__title">{{ translate('okf.piiReview.title', 'Personal data check') }}</span>
    </p>
    <!-- The body always names the STATE, so "unknown" can never be read as
         "nothing found" — the exact conflation that let 107 flagged pages
         through an acknowledgement recorded against zero. -->
    <p class="okf-pii-review__body">{{ body }}</p>
    <p v-if="review.ack && !review.ackCurrent && review.hits > 0" class="okf-pii-review__stale">
      {{ staleAckLine }}
    </p>
    <p v-if="review.verdict === 'unreviewed'" class="okf-pii-review__banner">
      <strong>{{ translate('okf.piiReview.bannerTitle', 'Nobody has reviewed these findings.') }}</strong>
      {{
        translate(
          'okf.piiReview.bannerBody',
          'Publishing is still allowed and no gate will stop you — but the flagged pages go into the published repository exactly as they are. Open each one and decide before you publish.'
        )
      }}
    </p>
  </section>
</template>

<script>
import { mapGetters } from 'vuex';
import DsStatusTag from '../../ds/StatusTag.vue';
import translateMixin from '../../../mixins/translateMixin';
import { computePiiReview, PII_CHECKING, PII_UNREADABLE } from '../piiReview';

export default {
  name: 'OkfPiiReviewSummary',
  components: { DsStatusTag },
  mixins: [translateMixin],
  props: {
    // The repository row. Carries pii_scan_status / pii_scanned_at / pii_ack.
    repo: { type: Object, default: null },
    // Which repository to read the concept verdicts for.
    repoId: { type: String, default: '' },
    // Read the concept list on show. Off only when a parent already owns a
    // fresher read it wants passed in (unused today; kept so the component
    // never has to lie about freshness).
    autoLoad: { type: Boolean, default: true }
  },
  emits: ['loaded'],
  data() {
    return {
      loading: false,
      readFailed: false,
      // STALE-ANSWER GUARD: a read describes ONE repository at ONE moment.
      // Bumped by every new read and by a repoId change; a read whose epoch
      // moved while in flight is discarded rather than rendered against the
      // wrong repository. Same idiom as HeadTestDialog's suiteEpoch/queryEpoch.
      loadEpoch: 0
    };
  },
  computed: {
    ...mapGetters('okf', ['conceptsByRepo']),
    concepts() {
      return this.repoId ? this.conceptsByRepo(this.repoId) : [];
    },
    review() {
      return computePiiReview({
        repo: this.repo,
        concepts: this.concepts,
        // `loaded` gates the whole verdict: a verdict computed from a list
        // still in flight would see zero rows and call a scanned repository
        // clean. That is the bug, not the fix.
        loaded: this.autoLoad ? !this.loading : true,
        readFailed: this.readFailed
      });
    },
    headline() {
      const key = {
        [PII_CHECKING]: ['okf.piiReview.checking', 'Checking…'],
        [PII_UNREADABLE]: ['okf.piiReview.unreadableTitle', 'State unknown'],
        unscanned: ['okf.piiReview.unscanned', 'Not scanned'],
        error: ['okf.piiReview.error', 'Scan failed'],
        unreviewed: ['okf.piiReview.unreviewed', 'Flagged, not reviewed'],
        reviewed: ['okf.piiReview.reviewed', 'Flagged, reviewed'],
        clean: ['okf.piiReview.clean', 'Scanned — nothing found']
      }[this.review.verdict];
      return key ? this.translate(key[0], key[1]) : '';
    },
    body() {
      const r = this.review;
      const n = (v) => String(v);
      switch (r.verdict) {
        case PII_CHECKING:
          return this.translate('okf.piiReview.checkingBody', 'Reading the personal-data state of every page…');
        case PII_UNREADABLE:
          return this.translate(
            'okf.piiReview.unreadableBody',
            'The personal-data state of this repository could not be read. Whether anything was found is UNKNOWN — this is not a clean result.'
          );
        case 'unscanned':
          return this.translate(
            'okf.piiReview.unscannedBody',
            'No completed personal-data scan covers this repository ({n} page(s) never scanned). Nothing is known to be free of personal data — publishing is not blocked by findings, but there is no scan behind this verdict.'
          ).replace('{n}', n(r.unscanned + r.total));
        case 'error':
          return this.translate(
            'okf.piiReview.errorBody',
            '{n} page(s) could not be scanned. Their content was NOT read successfully, so whether they contain personal data is UNKNOWN — they are not clean, and they block publishing.'
          ).replace('{n}', n(r.errors));
        case 'unreviewed':
          return this.translate(
            'okf.piiReview.unreviewedBody',
            'The scanner found possible personal data on {n} page(s) and no one has looked at them. Publishing is allowed, but nothing on those pages has been reviewed.'
          ).replace('{n}', n(r.hits));
        case 'reviewed':
          return this.translate(
            'okf.piiReview.reviewedBody',
            '{n} page(s) carry flagged personal data that a steward acknowledged ({by} on {at}).'
          )
            .replace('{n}', n(r.hits))
            .replace('{by}', (r.ack && r.ack.by) || this.translate('okf.piiReview.unknownActor', 'unknown'))
            .replace('{at}', (r.ack && r.ack.at) || '—');
        default:
          return this.translate('okf.piiReview.cleanBody', 'Every page was scanned and no personal data was found.');
      }
    },
    staleAckLine() {
      const r = this.review;
      return this.translate(
        'okf.piiReview.staleAck',
        'A previous acknowledgement recorded {a} flagged page(s) on {at}; {n} are flagged now, so it does not cover them.'
      )
        .replace('{a}', String((r.ack && r.ack.flagged_concepts) || 0))
        .replace('{at}', (r.ack && r.ack.at) || '—')
        .replace('{n}', String(r.hits));
    }
  },
  watch: {
    repoId: {
      immediate: true,
      handler() {
        this.load();
      }
    }
  },
  beforeUnmount() {
    // A read in flight must not land on a torn-down component.
    this.loadEpoch += 1;
  },
  methods: {
    async load() {
      if (!this.autoLoad || !this.repoId) return;
      const epoch = ++this.loadEpoch;
      const repoId = this.repoId;
      this.loading = true;
      this.readFailed = false;
      const res = await this.$store.dispatch('okf/fetchConcepts', repoId);
      // STALE-ANSWER GUARD: the curator switched repositories (or the
      // component was torn down) while the read was in flight.
      if (epoch !== this.loadEpoch || repoId !== this.repoId) return;
      this.loading = false;
      // FAIL-CLOSED: a failed read leaves the verdict UNKNOWN, never clean.
      this.readFailed = !res || !res.ok;
      this.$emit('loaded', { repoId, ok: !!res && !!res.ok });
    }
  }
};
</script>

<style scoped>
.okf-pii-review {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-sm);
  border: 1px solid var(--border);
  border-left: 3px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg);
  text-align: left;
}
/* Severity is carried by the LEFT EDGE, not only by the tag colour: a curator
   who cannot distinguish the hues still sees which states block. */
.okf-pii-review--error {
  border-left-color: var(--danger);
}
.okf-pii-review--unreviewed {
  border-left-color: var(--warning);
}
.okf-pii-review--reviewed {
  border-left-color: var(--accent);
}
.okf-pii-review--clean {
  border-left-color: var(--success);
}
.okf-pii-review__head {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin: 0;
}
.okf-pii-review__title {
  font-size: var(--text-sm);
  font-weight: 600;
}
.okf-pii-review__body {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
/* The unreviewed-hits warning is the one PROMINENT, unmissable block: it is
   the state where publishing succeeds and nobody looked. */
.okf-pii-review__banner {
  margin: 0;
  padding: var(--space-sm);
  border-radius: var(--radius-sm);
  background: var(--warning-bg, var(--surface-variant, var(--surface)));
  color: var(--fg);
  font-size: var(--text-sm);
}
.okf-pii-review__stale {
  margin: 0;
  color: var(--warning);
  font-size: var(--text-sm);
}
</style>
