#!/bin/bash
# Crawler resilience + kill-before-delete issue filing (documentation mandate)
mk() {
  glab api "projects/:id/issues" -f title="$1" -f description="$2" -f labels="bug,okf,crawler" > /dev/null
  echo "filed: $1"
}

mk "okf(crawler): crawl worker thread OOM death is permanent — no respawn, jobs silently starve" "Incident 2026-09-04/07: the doc-repo crawl worker thread (spawned once in src/server.js:75-97) hit 'JS heap out of memory' on Sep 4 13:06 and exited; the exit handler only logs. Container stayed healthy while every crawl scheduled for 3 days sat status=Pending forever.
Fix (approved plan, session 65): respawn-on-exit supervisor with backoff + cap; startup adoption of non-terminal (zombie Crawling) jobs via reaper; degraded-health surface in status/healthcheck payload; OOM forensics (which crawl ballooned; resourceLimits sized to legal 1000-page crawls).
Evidence: docker logs 'Crawl Worker Error: Worker terminated due to reaching memory limit' Sep 4 13:06; crawl_job rows Pending with zero worker activity.
Fix MR must reference this issue."

mk "okf(crawler): deleting a file mid-crawl orphans the running crawl — enforce kill-before-delete" "Directive (David, 2026-09-07): prevent mid-crawl deletes; the crawl must be killed first, confirmed, then deleted.
Current gap: DELETE /files/:fileId (fileRoutes.js:589 -> fileController.deleteFile:664-707) has NO active-crawl check; killCrawlTask exists (fileService.js:578-587, cooperative kill_requested flag) but nothing orchestrates it before delete. Bulk delete route has the same gap.
Fix (approved ruling): server-orchestrated kill-first — on delete with an active crawl_job: set kill_requested, await terminal state with a bounded window, then delete; if not terminal in window -> 409 CRAWL_ACTIVE with kill-first contract. UI confirm dialog (session 15) states the consequence: stops the crawl AND removes partial content. Requires the reaper/adoption work so a dead worker cannot make orchestration await forever.
Fix MR must reference this issue."
