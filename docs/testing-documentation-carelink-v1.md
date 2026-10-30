# CareLink V1: Testing documentation, technical annex

**How test findings were addressed in the solution**

- **For:** the Challenge deliverable "Testing Documentation"
- **Prepared by:** Code Above Lab, for Innov8AI
- **Date:** 27 October 2026
- **Status:** Draft v2 for review by Innov8AI
- **Code version:** the code in this branch (CareLink V1 as deployed on 22 October 2026)

## 1. About this document

### 1.1 Purpose

CareLink V1 was tested in two ways:

- **Structured system-behavior testing** (Innov8AI, Part 2A): the test method, the test sets and the results.
- **Stakeholder interaction and implementation learning** (Innov8AI, Part 2B): the sessions with the Ministry of Health, MRC Gambia, WHO, ITU and IEEE.

This annex covers the engineering side. For each finding, it shows what changed in the solution and what the status is. It does not repeat the test results of Part 2A and Part 2B.

### 1.2 Readers

IEEE, ITU, WHO and Ministry of Health reviewers, Innov8AI, and the developers who continue the work.

### 1.3 Related documents in this branch

- `docs/changelog-asante-1.0.md`: the list of all changes, with dates and commit codes.
- `docs/scaling-and-cost-recommendations-carelink-v1.md`: the plan for scaling, with budgetary costs.

## 2. Words used in this document

| Word | Meaning |
|---|---|
| CareLink | The health assistant at asante.innov8ai.com. |
| Topic Module | A CareLink assistant for one topic, for example hypertension. |
| Knowledge Set | The documents that belong to one Topic Module. |
| Sources | The list of documents under an answer. |
| Retrieval relevance | How well the text passages given to the AI matched the question. It does not measure whether the answer is correct. |
| Strict mode | An optional setting. With strict mode, CareLink answers only when a document supports the answer. |
| Audio | Talking to CareLink with your voice, in the browser. |
| Guest | A person who uses CareLink from a shared link, without an account. |
| Rev 0, Rev 1 | Rev 0 is the earlier deployment, before the move to AWS in July 2026. Rev 1 is CareLink V1 on AWS, from July 2026. |

**Status labels:**

| Label | Meaning |
|---|---|
| Fixed | We changed the solution and checked the change. |
| Partly fixed | We changed the solution, but part of the problem remains. |
| Explained | The solution works as designed. The behavior is a design choice. |
| Open | Not changed yet. |

## 3. Summary

- 22 findings, from tests and from engineering review, between 14 August and 22 October 2026.
- 15 are Fixed (one waits for a retest), 1 is Partly fixed, 4 are Explained and 2 are Open.
- From Rev 0 to Rev 1, the stability and reliability of CareLink improved from "Poor" to "Excellent", and CareLink is always on (section 4).

## 4. Stability and reliability: Rev 0 to Rev 1

**Assessment by Innov8AI:** from Rev 0 to Rev 1, the overall stability and reliability of CareLink went from **"Poor"** to **"Excellent"**. Rev 1 is always on.

This assessment comes from the experience of testers and of the team. Measured availability data starts with the monitoring that is planned in Stage 2 of the scaling document.

The changes in Rev 1 that support it:

- The whole platform is defined in code (Terraform and Ansible), so it can be rebuilt.
- Every code change is installed in place, with automatic checks, and without replacing the server (9 August).
- A wrong restart rule, which kept services stopped after a deployment, was corrected (9 August). Services that stop are now restarted.
- Services that never started were repaired: six images that were never built, including the voice service, and the search-ranking and document-processing services (9 August).
- Deployments wait until all services are healthy, and outside software has fixed versions (20 August).
- A name server error that made the site unreachable for some testers was corrected (19 September).
- The server has been running since 14 July 2026, with no stop or start since then. No stop schedule is set. (checked on 27 October)

## 5. Findings and changes

Findings 1 to 17 come from tests by Innov8AI and its testers. Findings 18 to 21 come from engineering review. Finding 22 comes from an Audio test on 21 October 2026.

| # | Finding (reported) | What changed in the solution | Status |
|---|---|---|---|
| 1 | Screen names for demos: "IEEE", "Twin" (14 August) | "IEEE" is now "Health Navigator 1.0". "Twin" is now "Topic Module". (19 August) | Fixed |
| 2 | Answers go beyond the documents (14 August) | An optional strict mode: CareLink refuses to answer when no document supports the answer (20 to 22 August). It is off on CareLink, because it would also refuse some normal follow-up questions. | Explained |
| 3 | Offers to book appointments (21 August) | A rule in the instructions (22 August). A check in the code that replaces a sentence offering to book, schedule or arrange a visit with a fixed sentence, in typed chat and Audio, in English, French and Spanish (19 October). Retests by Innov8AI on 23 August, 18 October and 21 October. | Fixed |
| 4 | Sources named that were not in the documents (23 August) | No change. The Sources list is the reliable record. This was explained on 8 September. | Explained |
| 5 | Uploaded documents stayed on "Pending" (26 August) | A permission setting was corrected (27 August). Processing starts when someone clicks "Ingest now". Tests before 27 August ran when the documents were not searchable. | Fixed |
| 6 | Meaning of "Match %" (8 September) | Renamed "retrieval relevance" (8 September). | Fixed |
| 7 | "Only from" or "not using" a document, inside the question (8 September) | No change. The search compares words and ignores "only" and "not". Only the Knowledge Set limits the documents. | Explained |
| 8 | Website not reachable for some testers (8 September) | A name server setting at the domain registrar was corrected (19 September). | Fixed |
| 9 | Topic Module used documents outside its Knowledge Set (17 September) | The search uses only the Knowledge Set (19 September). A Topic Module without a Knowledge Set uses no documents (18 October). A setting can restore the old rule. | Fixed |
| 10 | Old topic carried over into new answers (17 September) | The AI sees only the previous question and answer, and the new question (17 October). Checked in a live test the same day. | Fixed |
| 11 | Links in Sources did not open (22 September) | The links use the address of this deployment (22 September). Older answers keep the old link. | Fixed |
| 12 | A typo changed the meaning of 140/90 (28 September) | The relevance check keeps a minimum number of the best passages, and gives the AI no weak passages (30 September, 2 October). Replays of logged requests: the correct spelling gave the same answers; "150/100" with the typo changed from "high-normal" to "high"; "180/100" with the typo changed from "severe" to "quite high". Part 2A reports a correct retest on 26 October. Answers can vary between runs, so the case stays on the re-test list. | Partly fixed |
| 13 | Screen wording: "Call", "Patient", phone icons (2 October) | "Audio" and "User". The phone icons are removed. (6 October) | Fixed |
| 14 | Answers without Sources (5 October) | No change. Very short messages do not start a search. When no passage is relevant enough, CareLink gives the AI no passages. A change for short medical questions is possible after testing. | Explained |
| 15 | Audio did not connect (6 October) | The wrong voice address was corrected. If Audio cannot start, the screen goes back to the chat with a message. (6 October) Audio was used on 8 October in English, French and Spanish. | Fixed |
| 16 | Deleting an Audio recording does not delete it (6 October) | No change. The delete function is not connected to the server. Since 17 October, recordings are not available at public links (finding 20). | Open |
| 17 | "High-normal" for 140/90, and "Call" in the goodbye (8 October) | No change. Part 2A records the 140/90 case as a finding. The instructions can be changed after testing. | Open |
| 18 | Guests could use any Topic Module (16 October) | A setting limits guests to chosen Topic Modules ("General NCD" on CareLink). For other Topic Modules, guests are asked to sign in. (18 October) | Fixed |
| 19 | Guests could open the chats of other guests (16 October) | Each guest chat has its own secret key. The browser keeps a guest chat only while the tab is open. (18 October) | Fixed |
| 20 | Audio recordings were reachable at public links (16 October) | The links answer "404 Not Found". Recording continues. (17 October) Other files in the upload folder are part of the security work in Stage 2 of the scaling document. | Fixed |
| 21 | An internal address was open to the internet (18 October) | Only services inside the server can use it. (18 October) | Fixed |
| 22 | Audio read out the style setting of the Topic Module (21 October) | Before CareLink speaks a sentence, it drops lines that repeat the style setting. (22 October) | Fixed. A retest by Innov8AI is pending. |

Also: the screens showed counters and a filter for a channel that is not connected. They are hidden, and the service of that channel is stopped. The code is included, and the function is disabled. (17 October)

## 6. How changes were checked

- **Automatic checks** run on every change: the build of the web app; lint, format and tests of the document repository (117 tests); lint and format of the shared library; the installation of the backend; and the Python unit tests (95 tests, in `tests/`). The definitions are in `.github/workflows/ci.yml`.
- **New tests** were added for findings 2, 3, 9, 12, 18, 19, 20, 21 and 22: five Python test files in `tests/`, and four backend test files in `components/gov-chat-backend/__tests__/` (93 tests).
- **Replays of logged requests** were used for the typo case (finding 12).
- **Live checks** followed each deployment. Examples: recording links answer 404, the guest list shows only General NCD, the internal address answers 404 from the internet.
- **Retests** by Innov8AI covered appointment offers, guest links and Audio. Code Above Lab tested long chats on the live system on 17 October.

**Gaps:** the voice service has no unit tests. Its changes were reviewed, compiled and tested live. In the whole backend test suite, 5 tests in `authController.test.js` fail. They failed before these changes. These checks are advisory.

## 7. Before the next round of testing

1. Share the list of changes (`docs/changelog-asante-1.0.md` and section 5) with the reviewers before testing. The method of Part 2A was shared this way on 30 September.
2. Run the test sets of Part 2A again after each release. Use the same result categories: PASS, PASS WITH OBSERVATION and FINDING.
3. Turn the questions of the findings into an automatic regression set, so that a change cannot bring back a fixed finding. This is work package M in the scaling document.

## Appendix: Findings of Part 2A and this annex

| Finding in Part 2A | Annex finding | What changed in the solution | Status |
|---|---|---|---|
| Inconsistent BP interpretation under wording variation | 12 | Minimum of the best passages; no weak passages (30 September, 2 October) | Partly fixed |
| "Is 140/90 normal blood pressure?" described as "high-normal" | 17 | None yet | Open |
| Unsupported personalized recommendations | none | None. The instructions already tell CareLink not to diagnose or prescribe. | See Part 2A |
| Unsupported appointment or coordination claims | 3 | Rule in the instructions (22 August); check in the code (19 October) | Fixed for offers to book, schedule or arrange a visit |
| Multi-turn scope drift | 10 | The AI sees only the previous question and answer (17 October) | Partly addressed: an old topic carries over less. "Tell me more" can still go beyond the documents. |
| Additional RED interactions | none | None. Part 2A makes no claim that all findings are corrected. | See Part 2A |
