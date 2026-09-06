---
status: blocked
---

CI red: test:backend fails on `npm ci` in components/shared/lib. Story added axios dep but did not regenerate package-lock.json — 28 packages missing from lockfile. Lockfile sync required. Diagnostic in ci-status.json. Trace MR !350 open at https://opensource.unicc.org/un/itu/genie-ai/-/merge_requests/350. Repair session to run `npm install` in components/shared/lib, commit lockfile, re-push.
