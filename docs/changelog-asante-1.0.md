# Change log: CareLink V1 (branch `asante/1.0`)

- **Branch:** `asante/1.0` in the GitHub repository `Innov8AI-dev/ASante`
- **Period:** 31 July 2026 to 22 October 2026
- **Last code change:** commit `cf5908de2` (pull request #31, 22 October 2026)
- **Prepared by:** Code Above Lab
- **Date of this document:** 22 October 2026

## 1. About this document

### 1.1 Purpose

This document lists the changes to CareLink V1 for the hand-over to ITU.
It covers the work from 31 July 2026 to 22 October 2026.

CareLink V1 is a prototype of a health-information navigator, at asante.innov8ai.com.
It served as a learning tool.
It helped the team and the stakeholders understand how people use a health assistant.
Most changes in this document came from testing, demonstrations and feedback from stakeholders.

### 1.2 Readers

- ITU and UNICC reviewers of the GENIE.AI repository
- Innov8AI, who owns CareLink
- Developers who will continue the work

Sections 1 to 4 are for all readers.
The appendices are for developers.

### 1.3 How this document is written

This document follows the plain-language principles of ISO 24495-1:2023:

- Short sentences, with one idea in each sentence.
- The same word always means the same thing. Section 2 explains the words.
- Dates are written as "19 October 2026". They are the dates when the change was merged.
- Names of files and settings are written like `this`.

### 1.4 How changes go live

Every code change that is merged into `asante/1.0` goes live automatically on asante.innov8ai.com.

## 2. Words used in this document

| Word | Meaning |
|---|---|
| CareLink | The health assistant at asante.innov8ai.com. |
| Topic Module | A CareLink assistant for one topic, for example hypertension. The code calls it a "twin". |
| Knowledge Set | The documents that belong to one Topic Module. |
| Sources | The list of documents under an answer. |
| Retrieval relevance | A number under an answer. It shows how well the documents matched the question. |
| Strict mode | An optional setting. With strict mode, CareLink answers only when a document supports the answer. |
| Audio | Talking to CareLink with your voice, in the browser. |
| Guest | A person who uses CareLink from a shared link, without an account. |
| Admin | A signed-in person who manages Topic Modules, documents and users. |
| Pull request (PR) | One proposed change. After a review, it is merged into the branch. |
| Commit | One saved step in the code history. It has a short code, for example `607d153ae`. |

## 3. Summary

### 3.1 Numbers

- 30 pull requests and 4 direct commits were merged.
- 62 commits in total (without merge commits).
- Authors: Vitaly Pronto (Code Above Lab), Raul Lopez, and Han Kyul Kim (first commit).

### 3.2 Changes by area

| Area | What changed |
|---|---|
| Screens and wording | Clearer names, formatted answers, "Audio" and "User" |
| Answers and search | Documents of the Topic Module only, a rule against appointment offers, steadier answers, an optional strict mode |
| Guests and Audio | Audio works for everyone; guests use the chosen Topic Modules and see only their own chat |
| Privacy and security | Audio recordings and an internal address are closed to the public |
| Deployment and operations | Automatic checks and deploys, a tool for user accounts |

### 3.3 Main changes at a glance

Newest changes first.

| Date | Change | Reference |
|---|---|---|
| 22 October 2026 | Audio no longer reads out the style setting of a Topic Module | PR #31 |
| 19 October 2026 | Offers to book visits are replaced in answers | PR #30 |
| 18 October 2026 | The internal translations address is closed to the internet | PR #29 |
| 18 October 2026 | Guests use only chosen Topic Modules, and only their own chat | PR #28 |
| 18 October 2026 | A Topic Module without a Knowledge Set uses no documents | PR #27 |
| 17 October 2026 | Audio recordings are no longer available at public links | PR #25 |
| 17 October 2026 | Guests can use Audio | PR #24 |
| 17 October 2026 | The AI sees only the last question and answer of the chat | PR #23 |
| 6 October 2026 | Audio connects on the live website | PR #21 |
| 6 October 2026 | The screens say "Audio" and "User"; the Audio screen handles errors | PR #20 |
| 30 September and 2 October 2026 | Steadier answers to questions with small typos | PR #16 to #19 |
| 22 September 2026 | Links in Sources open the documents | `808904f5a` |
| 19 September 2026 | A Topic Module uses only its own Knowledge Set | `7ef13ebe5`, `c4215a79b` |
| 8 September 2026 | "% match" is now "% retrieval relevance" | `67db508af` |
| 6 September 2026 | Overview document of the deployment process | PR #9 |
| 22 August 2026 | Rule against offers to book appointments | PR #15 |
| 20 August 2026 | Optional strict mode | PR #14 |
| 20 August 2026 | Formatted chat answers | PR #13 |
| 20 August 2026 | New names: "Health Navigator 1.0" and "Topic Module" | PR #12 |
| 20 August 2026 | Deploys wait until all services are ready | PR #11 |
| 19 August 2026 | Tool to manage user accounts | PR #10 |
| 9 August 2026 | Automatic checks and automatic deploys | PR #2 to #8 |
| 31 July 2026 | First commit of the branch | `58fd08429` |

## 4. Changes by area

### 4.1 Screens and wording

- **New names (20 August 2026, PR #12).**
  "IEEE" is now "Health Navigator 1.0". "AI Twin" is now "Topic Module".
  The start page says "Pick your Health Topic".
  Why: the new names were clearer for users in demonstrations.
- **Formatted answers (20 August 2026, PR #13).**
  Answers show bold text, lists, headings and tables.
  The text is cleaned for safety before it is shown.
- **"% retrieval relevance" (8 September 2026).**
  The number under an answer was called "% match". It is now "% retrieval relevance".
  Why: testers read "match" as "how correct the answer is". The number does not measure this.
- **"Audio" and "User" (6 October 2026, PR #20).**
  "Call" is now "Audio". "Patient" is now "User". The phone icons are gone.
  Why: Innov8AI asked for these words before the CareLink Learning Session.

### 4.2 Answers and search

- **A Topic Module uses only its own Knowledge Set (19 September 2026).**
  CareLink now searches only the documents of the Topic Module.
  Sources show only these documents.
  Why: in testing, a Topic Module used documents from other topics.
- **A Topic Module without a Knowledge Set uses no documents (18 October 2026, PR #27).**
  Before, such a Topic Module searched all documents.
  The old behaviour is still available with the setting `EMPTY_KNOWLEDGE_SET_SCOPE=all`.
  Why: Innov8AI chose this option.
- **Links in Sources open the documents (22 September 2026).**
  The links now use the address of this deployment.
- **Rule against offers to book appointments (22 August 2026, PR #15).**
  CareLink must not offer or claim to book appointments, set reminders or contact anybody.
  It tells the user who can help instead.
- **Offers to book visits are replaced (19 October 2026, PR #30).**
  CareLink checks each sentence of an answer.
  A sentence that offers to book a visit is replaced with: "You can contact your community health worker or clinic to arrange a visit."
  This works in typed chat and in Audio, in English, French and Spanish.
  Why: a live test on 18 October 2026 still found such offers.
- **Steadier answers to questions with small typos (30 September and 2 October 2026, PR #16 to #19).**
  The search keeps a small minimum number of good text passages.
  It no longer gives weak passages to the AI.
  Why: testing showed that a small typo in a question could change the answer.
- **Shorter chat memory (17 October 2026, PR #23).**
  With each new question, the AI sees the previous question and answer.
  Why: testing showed that in a long chat, an earlier topic could affect the answer to a new question.
- **Optional strict mode (20 August 2026, PR #14).**
  With strict mode, CareLink answers only when a document supports the answer.
  Urgent-care advice is always given.
  Strict mode is off on CareLink. Setting: `CHATQNA_STRICT_GROUNDING`.

### 4.3 Guests and Audio

- **Audio connects on the live website (6 October 2026, PR #21).**
  The browser now gets the correct address of the Audio service.
- **The Audio screen handles errors (6 October 2026, PR #20).**
  When Audio cannot start, the screen goes back to the chat with a short message.
- **Audio no longer reads out the style setting (22 October 2026, PR #31).**
  Each Topic Module has a style setting for tone and length.
  In a test, Audio read this setting out before its answer.
  CareLink now removes such lines before it speaks.
- **Guests can use Audio (17 October 2026, PR #24).**
  A guest chat also uses the Topic Module of the shared link.
- **Guests use only chosen Topic Modules, and only their own chat (18 October 2026, PR #28).**
  The setting `PUBLIC_TWIN_IDS` lists the Topic Modules for guests. On CareLink, this is "General NCD".
  Each guest chat has its own secret key, so other guests cannot open it.
  The browser forgets a guest chat when the tab is closed.

### 4.4 Privacy and security

- **Audio recordings are no longer available at public links (17 October 2026, PR #25).**
  Recording continues, and the files stay on the server.
- **The internal translations address is closed to the internet (18 October 2026, PR #29).**
  Only services inside the server can use it.

### 4.5 Deployment and operations

- **Automatic checks and automatic deploys (9 August 2026, PR #2 to #8).**
  - GitHub checks the code of every branch.
  - Each merge into `asante/1.0` is installed on the existing server. A deploy never creates or replaces a server.
  - Only the services with changed code are built again.
  - GitHub gets short-lived access to AWS, without stored keys.
  - Several services were fixed, so that all of them start.
- **Tool to manage user accounts (19 August 2026, PR #10).**
  `scripts/manage-app-user.sh` creates, changes and disables accounts on the server. It checks a real sign-in after each change.
- **Deploys wait until all services are ready (20 August 2026, PR #11).**
  Outside images have fixed versions, so a deploy does not load unexpected new versions.
- **Overview document of the deployment process (6 September 2026, PR #9).**
  `docs/ci-cd-customer-overview.md` explains the automatic checks and deploys for non-developers.

## Appendix A: All commits

Oldest first. The date is the date of the commit, not of the merge. Merge commits are not listed. "PR" is the pull request that merged the commit. "—" means a direct commit.

| Date | Commit | Author | PR | Title |
|---|---|---|---|---|
| 7 August 2026 | `82881a6ce` | Vitaly Pronto | #2 | ci: add GitHub Actions CI and resync component lockfiles |
| 7 August 2026 | `a4065edc8` | Vitaly Pronto | #2 | deploy: in-place SSM redeploy path, replacing instance-replacement deploys |
| 7 August 2026 | `b14d6f11c` | Vitaly Pronto | #2 | docs: CI/CD plan; untrack tfplan and ignore plan artifacts |
| 7 August 2026 | `95115b399` | Vitaly Pronto | #2 | infra: GitHub OIDC deploy role as a separate Terraform stack |
| 7 August 2026 | `0625300b5` | Vitaly Pronto | #2 | ci: deploy workflow — auto on asante/1.0, manual dispatch from any branch |
| 7 August 2026 | `4dec1a403` | Vitaly Pronto | #2 | style: format document-repository and promote its format check to blocking |
| 7 August 2026 | `68b8c1dc9` | Vitaly Pronto | #2 | style: format shared/lib and promote its format check to blocking |
| 9 August 2026 | `2a51f1c64` | Vitaly Pronto | #3 | fix(oidc): trust immutable ID-based GitHub subject claims |
| 9 August 2026 | `c446c5e88` | Vitaly Pronto | #3 | fix(deploy): SSM preamble must be POSIX sh, not bash |
| 9 August 2026 | `2b76e6042` | Vitaly Pronto | #4 | fix(swarm): long-running services must restart on clean exit, not just failure |
| 9 August 2026 | `5aaf4dc5c` | Vitaly Pronto | #4 | perf(deploy): rebuild only images whose own sources changed |
| 9 August 2026 | `b001002ce` | Vitaly Pronto | #4 | fix(swarm): restore max_attempts — condition:any does allow it |
| 9 August 2026 | `37989f290` | Vitaly Pronto | #5 | fix(opea): repair reranker and dataprep component registration |
| 9 August 2026 | `628ab33b0` | Vitaly Pronto | #6 | fix(dataprep): register the ArangoDB component before the upstream import |
| 9 August 2026 | `89409e099` | Vitaly Pronto | #6 | fix(dataprep): pin import order against isort auto-fix |
| 9 August 2026 | `48c116a67` | Vitaly Pronto | #6 | fix(deploy): build the six images compose references but the playbook never built |
| 9 August 2026 | `973cb6325` | Vitaly Pronto | #6 | fix(terraform): stop a new AMI silently replacing the GPU instance; record 600GB volume |
| 9 August 2026 | `b5294c51c` | Vitaly Pronto | #7 | fix(terraform): correct the AMI-upgrade note; restore the vLLM context length |
| 9 August 2026 | `930cbc929` | Vitaly Pronto | #7 | fix(deploy): emit the service-account credential http-service needs to boot |
| 9 August 2026 | `260381456` | Vitaly Pronto | #7 | fix(deploy): make the CI deploy able to pass at all |
| 9 August 2026 | `38f0e5c17` | Vitaly Pronto | #8 | docs: record the 2026-08-09 deploy work, the DNS incident and two must-not-regress values |
| 9 August 2026 | `472ea56a5` | Vitaly Pronto | #8 | Potential fix for pull request finding |
| 12 August 2026 | `65a819fd0` | Vitaly Pronto | #9 | Added ci-cd document overview |
| 17 August 2026 | `20b0b808d` | Vitaly Pronto | #10 | Add a fast, verified path for creating application users |
| 19 August 2026 | `20701f487` | Vitaly Pronto | #11 | Wait for Swarm convergence instead of failing the deploy at 90 seconds |
| 19 August 2026 | `5e529e671` | Raul Lopez | #12 | fix(frontend-v2): point dev proxy at asante.innov8ai.com |
| 19 August 2026 | `90d620362` | Raul Lopez | #12 | feat(frontend-v2): rebrand IEEE -> Health Navigator 1.0, Twin -> Topic Module |
| 20 August 2026 | `4ae563db6` | Raul Lopez | #13 | feat(frontend-v2): render assistant chat replies as markdown |
| 20 August 2026 | `a6ea6eab4` | Vitaly Pronto | #14 | Add strict grounding mode to contain answers to the document repository |
| 22 August 2026 | `a08e0e16e` | Vitaly Pronto | #15 | Make containment actually fire, and stop offering appointments |
| 22 August 2026 | `a6de26965` | Vitaly Pronto | #15 | Fix issues found reviewing the containment/capability changes |
| 8 September 2026 | `67db508af` | Vitaly Pronto | — | Rename the chat "% match" badge to "% retrieval relevance" |
| 19 September 2026 | `7ef13ebe5` | Vitaly Pronto | — | Send the Twin's Knowledge Set to ChatQnA with each turn |
| 19 September 2026 | `c4215a79b` | Vitaly Pronto | — | Scope ChatQnA retrieval to the Twin's Knowledge Set |
| 22 September 2026 | `808904f5a` | Vitaly Pronto | — | Point chat "Sources" links at this deployment |
| 30 September 2026 | `5575e6eca` | Vitaly Pronto | #16 | Stabilise the reranker threshold cut: min_n floor, no top-N fallback |
| 30 September 2026 | `4f86a178c` | Vitaly Pronto | #17 | Review follow-ups for the reranker threshold floor |
| 30 September 2026 | `b76d2ff37` | Vitaly Pronto | #18 | Raise the reranker floor to 4 (Step A) |
| 30 September 2026 | `1029e4ca3` | Vitaly Pronto | #18 | Make the no-request-override test discriminating |
| 30 September 2026 | `5900b47dc` | Vitaly Pronto | #18 | Name the floor default once and keep the wiring tests discriminating |
| 30 September 2026 | `2549e96f1` | Vitaly Pronto | #18 | Read RERANKING_MIN_N as an integer honestly, and fix the floor docstring |
| 30 September 2026 | `a05a05592` | Vitaly Pronto | #18 | Parse every numeric reranker env safely; slice unknown strategies by the resolved top_n |
| 30 September 2026 | `01b7418de` | Vitaly Pronto | #18 | Let the code default be the only default for RERANKING_MIN_N; test the parser directly |
| 1 October 2026 | `09aa10ca9` | Vitaly Pronto | #19 | Return the reranker floor to 3; the stage table was not the lever |
| 2 October 2026 | `d1f48d993` | Vitaly Pronto | #19 | Stop restating the floor's value outside DEFAULT_RERANKING_MIN_N |
| 6 October 2026 | `70aeb1f1d` | Vitaly Pronto | #20 | Say "Audio" and "User" in the UI, and drop the phone icons |
| 6 October 2026 | `364c215cc` | Vitaly Pronto | #20 | Stop the audio screen sticking on "Listening…" |
| 6 October 2026 | `27900cf4a` | Vitaly Pronto | #21 | Hand the browser the real voice WebSocket URL, not localhost |
| 15 October 2026 | `f0281399f` | Vitaly Pronto | #22 | Hide WhatsApp in the UI until the channel is connected |
| 15 October 2026 | `95191ffbb` | Vitaly Pronto | #22 | Hide WhatsApp consistently and keep the analytics totals right |
| 16 October 2026 | `37ff5dd5f` | Vitaly Pronto | #23 | Keep only the last question and answer as chat history |
| 16 October 2026 | `36d5d4ce6` | Vitaly Pronto | #24 | Let guests use Audio and chat with the module from their link |
| 17 October 2026 | `3b0ab363c` | Vitaly Pronto | #25 | Stop serving Audio recordings at public links |
| 17 October 2026 | `0895b06b4` | Vitaly Pronto | #26 | Turn off the unused WhatsApp service |
| 18 October 2026 | `888723d19` | Vitaly Pronto | #27 | Stop Topic Modules without a Knowledge Set from searching all documents |
| 18 October 2026 | `83f2f3bdb` | Vitaly Pronto | #28 | Let guests use only the Topic Modules chosen for them |
| 18 October 2026 | `a28590c97` | Vitaly Pronto | #28 | Keep each guest chat to its own guest and browser tab |
| 18 October 2026 | `6cff91105` | Vitaly Pronto | #29 | Refuse the internal translations route from outside the server |
| 18 October 2026 | `827e94a69` | Vitaly Pronto | #28 | Give guests a separate chat secret and check them before uploads |
| 18 October 2026 | `5ad6f3cb9` | Vitaly Pronto | #28 | Reload the module picker's list after a sign-in or sign-out |
| 19 October 2026 | `76dc67cf5` | Vitaly Pronto | #30 | Replace offers to book appointments in answers, in chat and Audio |
| 22 October 2026 | `61b588fce` | Vitaly Pronto | #31 | Stop Audio from reading out the module's style setting |

## Appendix B: Settings added or changed

The value of each setting lives in one place. This table says where.

| Setting | What it does | Where the default lives |
|---|---|---|
| `CHATQNA_STRICT_GROUNDING` | Turns strict mode on or off | `docker-compose.yaml`, `genieai_chatqna.py` |
| `CHATQNA_STRICT_REFUSAL` | Answer text when strict mode refuses | `genieai_chatqna.py` |
| `CHATQNA_STRICT_MIN_SCORE` | Lowest score that counts as support in strict mode | `genieai_chatqna.py` |
| `CHATQNA_NO_CAPABILITY_CLAIMS` | Adds the rule against offers of appointments | `docker-compose.yaml`, `genieai_chatqna.py` |
| `RERANKING_MIN_N` | Minimum number of good text passages | `DEFAULT_RERANKING_MIN_N` in `genieai_tei_reranker.py` |
| `PUBLIC_API_URL` | Address for links in Sources | `docker-compose.yaml` |
| `CHAT_SESSION_HISTORY_MESSAGE_LIMIT` | How many earlier chat messages the AI sees | `chat-session-service.js`; CareLink value in `deploy/ansible/group_vars/all.yml` |
| `EMPTY_KNOWLEDGE_SET_SCOPE` | What a Topic Module without a Knowledge Set searches | `knowledge-set-scope.js` |
| `PUBLIC_TWIN_IDS` | Topic Modules that guests may use | `deploy/ansible/group_vars/all.yml` |
| `VOICE_BRIDGE_WS_URL` | Audio address for the browser | `deploy/ansible/templates/env.j2` |
| `WHATSAPP_UI_ENABLED` | Shows or hides WhatsApp in the screens | `components/genie-ai-frontend-v2/src/lib/features.ts` |

## Appendix C: Code included, function disabled

| Function | Status |
|---|---|
| WhatsApp channel | The code is included. The function is disabled on CareLink: the screens hide it (`WHATSAPP_UI_ENABLED`, PR #22), and `whatsapp-service` runs with 0 replicas in `docker-compose.yaml` (PR #26). |
