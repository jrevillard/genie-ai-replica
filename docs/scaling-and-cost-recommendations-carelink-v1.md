# CareLink V1: Scaling and cost recommendations

**Budgetary quote for The Gambia**

- **For:** the Challenge deliverable "Scaling & Cost Recommendations"
- **Prepared by:** Code Above Lab, for Innov8AI
- **Date:** 27 October 2026
- **Status:** Draft v1 for review by Innov8AI
- **Scope:** The Gambia only. English only.

## 1. About this document

### 1.1 Purpose

This document recommends how CareLink can move from a prototype to a pilot, and then, if the evidence supports it, to a national rollout in The Gambia.
For each stage, it gives:

- the work to do,
- the infrastructure that is needed,
- the monthly running cost,
- the one-time build effort.

It also shows how the three operational concerns of ITU and IEEE are handled before any public-service pilot.

### 1.2 What this document is, and is not

This is a **budgetary quote**. It is a planning figure, not a fixed-price offer.

- **Accuracy:** about plus or minus 30 percent.
- **Currency:** US dollars, without taxes.
- **Prices:** AWS on-demand list prices for the region us-east-1, as recorded in the project's AWS documents (May to July 2026), and the AWS public price list for the extra services. Prices must be checked again when the formal quote is made.
- **Valid for:** 90 days from the date above.
- **Not included:** staff time of the Ministry of Health and WHO, fees of third parties, taxes.

### 1.3 Scope

This estimate covers deployment in **The Gambia**, in **English**.

Additional language capabilities and deployment in other countries are outside the scope of the present Gambia budgetary estimates and would require separate planning and resources.

### 1.4 Related documents in this branch

- `docs/testing-documentation-carelink-v1.md`: findings from testing, and how they were addressed.
- `docs/changelog-asante-1.0.md`: the list of all changes.
- `docs/aws-dev-deployment-plan.md`, `docs/aws-orchestration-decision.md`, `docs/deployment-options.md`: the AWS designs and the prices used here.

## 2. Words used in this document

| Word | Meaning |
|---|---|
| Registered users | People with an account, or who have been given access. |
| Monthly active users | Registered users who use CareLink at least once in a month. |
| Simultaneous users | People who use CareLink at the same moment. This number decides the size of the servers. |
| Topic Module | A CareLink assistant for one topic, for example hypertension. |
| Knowledge Set | The documents that belong to one Topic Module. |
| GPU server | A server with a graphics processor. CareLink needs it to run the AI models. |
| Pilot | A limited use of CareLink by real users, to learn. It is not a national rollout. |
| Gate | A decision point between two stages. It needs evidence. |
| Person-week | The work of one person for one week. |
| Build effort | The work to build and change the solution, once. |
| Running cost | The monthly cost of the infrastructure. |

## 3. Summary

### 3.1 The path

CareLink moves in four steps. Each step needs the result of the step before.

**Scope → Implement and learn → Evaluate readiness → Scale**

A national rollout is a possible future phase. It does not follow automatically from a pilot. Stage 3 starts only if Gate 2 shows the evidence that is listed in section 8.

### 3.2 The three stages

| | Stage 1: Evaluate and scope | Stage 2: Implement and learn | Stage 3: National rollout (conditional) |
|---|---|---|---|
| Registered users (scenario) | 10 | 100 | 1,000 |
| Monthly active users (scenario) | 5 | 50 | 500 |
| Simultaneous users, peak (scenario) | 1 | 10 | 100 |
| Time | about 6 weeks | about 5 months | about 3 to 4 months, after Gate 2 |
| What happens | Assess the three concerns, run a load test, define the first users and the pilot | Remediate the three concerns, then run the pilot in learning cycles | Scale the platform for national use |
| Running cost per month | about $1,720 (or about $570 with a daily stop schedule) | about $1,840 to $1,910 | about $3,830 to $3,900 (about $2,620 to $2,690 with 1-year reserved GPU servers) |
| Build effort (one time) | 2.5 to 3 person-weeks | 14 to 17 person-weeks | 5 to 7 person-weeks |
| Support effort per month | not needed | 4 to 6 person-days | 8 to 12 person-days |

The user numbers are **scenario assumptions**, not forecasts of adoption. Section 5 explains them.

### 3.3 Running cost per user

Running cost per registered user per month, infrastructure only:

| Stage | On-demand | With 1-year reserved GPU servers |
|---|---|---|
| Stage 1 (10 users) | about $172 | not recommended yet |
| Stage 2 (100 users) | about $19 | not recommended yet |
| Stage 3 (1,000 users) | about $3.9 | about $2.7 |

The cost per user falls fast with scale, because the GPU server is the main cost and it is shared.

## 4. Starting point

CareLink V1 runs today on **one GPU server** on AWS (type g6e.2xlarge: 1 GPU with 48 GB, 8 processor cores, 64 GB of memory). It runs about 30 services:

- the web app, the backend, the login, the document processing and the search,
- the chat model, the translation model, the embedding and the ranking models,
- speech-to-text and text-to-speech for Audio,
- the databases.

The current running cost is about $1,720 per month, with the server always on. With a daily stop schedule (about 220 hours per month), it is about $570. The site is then down outside these hours.

The design has these properties:

- One server is one point of failure. If it stops, CareLink stops until it restarts.
- The database ArangoDB has no managed version on AWS. It stays on the server, on a disk with backups.
- V1 has not been tested with many users at the same time. Stage 1 includes a load test.

## 5. Assumptions

| Assumption | Value | Note |
|---|---|---|
| Registered users | 10, then 100, then 1,000 | Scenario steps, not a forecast. |
| Monthly active users | 50 percent of registered users | One consistent assumption for all stages. |
| Simultaneous users at the peak | 10 percent of registered users | 1, then 10, then 100. |
| Share of Audio | 20 percent of simultaneous sessions | Audio uses the GPU more than typed chat. |
| Language | English only | No translation load. |
| Country | The Gambia | One region of deployment on AWS. |
| Availability in the pilot and the rollout | Server always on | A daily stop schedule is only for test environments. |
| Team | The team that built CareLink V1 does the work | No time is needed to learn the code. This is why the build effort is low. |
| GPU capacity | To be measured | See below. |

**GPU capacity.** V1 has not been load-tested at these levels. Stage 1 measures how many simultaneous chat and Audio sessions one GPU server handles with good response times.

- Stage 2 assumes that the current server is enough for up to 10 simultaneous users.
- Stage 3 assumes that two GPU servers serve about 100 simultaneous users. One carries the load, and the second adds capacity and a backup.
- If the load test or the pilot shows a different number, the rule is simple: each extra GPU server adds about $1,637 per month on-demand, or about $1,031 with a 1-year reservation.

## 6. The stages in detail

### 6.1 Stage 1: Evaluate and scope

**Goal:** understand exactly what is needed for a safe pilot, and plan it.

**Work:**

- **Security and data protection:** review how users sign in, how secrets are kept, and how personal data is stored, logged and deleted. List the changes that are needed.
- **Monitoring, traceability and quality assurance:** list what is missing to follow an answer from the question to the documents, and to measure quality over time.
- **Document ingestion and extensibility:** review the steps from a new document to a searchable document, and the limits of the search and of long chats.
- **Load test:** measure how many simultaneous chat and Audio sessions one GPU server handles.
- **First users and workflow:** with the Ministry of Health, choose the first user group and the workflow. Part 2B of the testing documentation shows why this matters.
- **Pilot plan and formal quote:** write the plan, the success criteria for Gate 2, and the formal quote for Stage 2.

**Infrastructure:** the current server. No change.

**Running cost per month:**

| Item | Always on | Daily stop schedule |
|---|---|---|
| GPU server g6e.2xlarge | about $1,637 | about $493 |
| Load balancer | about $18 | about $18 |
| Disks (650 GB) | about $52 | about $52 |
| Domain, certificate, storage, transfer | about $10 | about $10 |
| **Total** | **about $1,720** | **about $570** |

**Build effort:** 2.5 to 3 person-weeks.

**Result at Gate 1:** the scope and the plan for Stage 2, agreed with the Ministry of Health, WHO, ITU and IEEE.

### 6.2 Stage 2: Implement and learn

**Goal:** remove the barriers for a public-service pilot, then learn from real use in repeated cycles.

**Work in two parts:**

1. **Remediation (about 10 to 12 weeks).** The three concerns of ITU and IEEE are closed before the pilot opens to users of the public service. Section 7 lists the work packages.
2. **Pilot in learning cycles (about 3 cycles, 3 weeks each).** Each cycle has the same steps: beta learning, pilot, learning, adjustments. The pilot grows from 10 to 100 registered users.

**Infrastructure:** the same GPU server, with the databases moved to managed services, and the added services for security and monitoring.

**Running cost per month:**

| Item | Cost |
|---|---|
| Stage 1 environment, always on | about $1,720 |
| Managed database (RDS db.t4g.small) and cache (ElastiCache cache.t4g.micro) | about $38 |
| Secrets management (AWS Secrets Manager) | about $8 |
| Web application firewall (AWS WAF) | about $10 to $20 |
| Logs, metrics and alarms (CloudWatch) | about $20 to $55 |
| Backups and snapshots | about $15 to $40 |
| Small server for monitoring and traces | about $30 |
| **Total, always on** | **about $1,840 to $1,910** |

**Optional:** a separate test environment (staging) with a daily stop schedule, about $570 per month. It keeps pilot users from being testers. We recommend it.

**Build effort:**

| Work | Person-weeks |
|---|---|
| Work package S: security and data protection | 3 to 4 |
| Work package M: monitoring, traceability and quality assurance | 3 to 4 |
| Work package D: document ingestion and extensibility | 3 to 4 |
| Learning cycles (3 cycles, 1 person-week each) | 3 |
| Project management, testing and documentation (about 15 percent) | 2 |
| **Total** | **14 to 17** |

**Support effort:** 4 to 6 person-days per month during the pilot.

**Result at Gate 2:** the evidence in section 8.

### 6.3 Stage 3: National rollout (conditional)

**Condition:** Gate 2 shows the evidence in section 8. Without it, Stage 3 does not start.

**Goal:** serve about 1,000 registered users in The Gambia, with about 100 at the same moment, in English.

**Work:**

- Split the platform into an application tier (managed containers on AWS ECS) and an AI tier (GPU servers). The design is in `docs/aws-orchestration-decision.md`.
- Add a second GPU server for capacity and as a backup.
- Make the database and the cache resilient across two zones.
- Set up regular backups of ArangoDB and test the restore. ArangoDB stays on the server, so recovery is from a backup, not automatic.
- Run the load test again at the target size, and tune the system.
- Write the runbooks for operations, and train the team that runs CareLink.
- Repeat the security checks of Stage 2 on the new design.

**Running cost per month:**

| Item | On-demand | With 1-year reserved GPU servers |
|---|---|---|
| Application tier and one GPU server, from the AWS design | about $2,040 | about $2,040 |
| Larger disk (650 GB instead of 250 GB) | about $32 | about $32 |
| Second GPU server | about $1,637 | about $1,637 |
| Resilient database and cache (two zones) | about $38 | about $38 |
| Security and monitoring services from Stage 2 | about $85 to $155 | about $85 to $155 |
| 1-year reservation of two GPU servers | not applicable | about minus $1,212 |
| **Total** | **about $3,830 to $3,900** | **about $2,620 to $2,690** |

**Build effort:** 5 to 7 person-weeks.

**Support effort:** 8 to 12 person-days per month.

## 7. ITU's three operational concerns

ITU and IEEE state that three concerns must be resolved before CareLink is recommended for a public-service pilot. Stage 1 assesses and scopes them. Stage 2 budgets, plans and delivers their remediation before the pilot opens.

ITU suggests that migration to GENIE 2.0 is the most efficient way to address them. ITU also accepts another way, shared for review. This estimate follows the other way: the work is done in the current V1 code base. A migration to GENIE 2.0 is not included. It can be estimated after Stage 1 has scoped the work.

| Concern | Stage 1 (assess and scope) | Stage 2 (work package) | Evidence at Gate 2 |
|---|---|---|---|
| 1. Security and data protection: weaknesses in sign-in, handling of secrets, handling of personal data | Review of sign-in, secrets, personal data, public addresses and the rights of each service | **Work package S**, 3 to 4 person-weeks: stronger sign-in and the end of old sign-in sessions; all secrets in a secrets service, with rotation; a list of the personal data CareLink holds, with retention, deletion and minimal logging; closing of public addresses and files that need no sign-in; review of the rights of each service; encryption and backups; an independent security test | The test report, with no open finding of high severity. The data list and the retention rules. |
| 2. Monitoring, traceability and quality assurance: not enough observation to evaluate answers, investigate problems and support the pilot assessment | List of what to record for each answer, and what to show | **Work package M**, 3 to 4 person-weeks: a request code on every log line; for each answer, a record of the question, the passages used, their scores, the instructions version, the model and the response time (with personal data protected); dashboards and alerts; the 12 test sets of Part 2A as an automatic regression set, run on every release; a monthly quality report | The dashboards in use for at least 4 weeks. One regression report per release. |
| 3. Document ingestion and extensibility: a rigid ingestion pipeline; limits for future tuning (for example, context for passages, loss of context in long chats) | Review of the ingestion steps, the labels and the search settings | **Work package D**, 3 to 4 person-weeks: automatic ingestion after an upload, with a visible status; settings per document for labels and passage size; re-ingestion and versions of documents; passages that carry their document context; better memory for long chats than the previous question and answer; regression tests | A new document goes from upload to searchable without manual steps. Long-chat test cases pass. |

## 8. Gates

| Gate | When | Decision | Evidence |
|---|---|---|---|
| Gate 1 | End of Stage 1 | Start Stage 2? | The scope and plan are agreed with the Ministry of Health, WHO, ITU and IEEE. The load test is done. The formal quote for Stage 2 is approved. |
| Gate 2 | End of Stage 2 | Is CareLink ready to scale? Start Stage 3? | The three concerns are remediated, with the evidence in section 7. The pilot learning is documented, with its cycles. The load test and the pilot show that the capacity and the cost match the Stage 3 assumptions. The Ministry of Health and WHO agree to a national rollout. |

Stage 3 is a potential future phase. It starts only after Gate 2.

## 9. Recommendations

1. **Choose the first users and workflow with the Ministry of Health first.** The stakeholder sessions (Part 2B) show that the first use must be clear before the system is built around it.
2. **Close ITU's three concerns before any public-service pilot.** They are the main work of Stage 2.
3. **Keep one GPU server until the load test says otherwise.** Add a server by the rule in section 5.
4. **Commit to 1-year reserved GPU servers only after Gate 1.** The saving is about $606 per server per month, but the commitment is for 12 months.
5. **Add a test environment (staging) in Stage 2.** It costs about $570 per month with a daily stop schedule.
6. **Set up content governance.** Name the reviewers at the Ministry of Health and WHO. Version each change of a Knowledge Set. Run the test sets again after each content change.
7. **Automate the test sets of Part 2A as a regression set.** Track the retrieval relevance and the share of answers without documents each month.
8. **Keep CareLink in its information role.** The answers must not offer to book visits or act for the user. The check in the code (see the testing documentation, finding 4.3) stays in place.
9. **Optional: better Audio quality in English.** Hosted speech services are available. As recorded in `docs/deployment-options.md`, speech-to-text costs about $0.46 per audio hour, and text-to-speech about $0.12 to $0.30 per 1,000 characters. These costs are not included above.

## Appendix A: Prices used

| Item | Price | Source |
|---|---|---|
| GPU server g6e.2xlarge, on-demand | $2.242 per hour (about $1,637 per month at 730 hours) | `docs/deployment-options.md` |
| GPU server g6e.2xlarge, 1-year reserved | about $1.413 per hour (about $1,031 per month) | `docs/deployment-options.md` |
| Daily stop schedule | about 220 hours per month | `docs/aws-dev-deployment-plan.md` |
| Load balancer | about $18 per month | `docs/aws-dev-deployment-plan.md` |
| Disk, gp3 | about $0.08 per GB per month (650 GB: about $52) | AWS price list |
| RDS db.t4g.small | about $25 per month | `docs/aws-dev-deployment-plan.md` |
| ElastiCache cache.t4g.micro | about $13 per month | `docs/aws-dev-deployment-plan.md` |
| Application tier on ECS plus one GPU server, always on | about $2,040 per month | `docs/aws-orchestration-decision.md` |
| Secrets, firewall, logs, backups, small server | about $83 to $153 per month in total | AWS price list, estimated for this document |

## Appendix B: How the totals are made

| Total | Calculation |
|---|---|
| Stage 1, always on | $1,637 + $18 + $52 + $10 = about $1,720 |
| Stage 1, daily stop schedule | $493 + $18 + $52 + $10 = about $570 |
| Stage 2 | $1,720 + $38 + ($83 to $153) = about $1,840 to $1,910 |
| Stage 3, on-demand | $2,040 + $32 + $1,637 + $38 + ($83 to $153) = about $3,830 to $3,900 |
| Stage 3, reserved GPU servers | the Stage 3 total minus 2 × $606 = about $2,620 to $2,690 |
| Build effort, Stage 2 | (3 to 4) + (3 to 4) + (3 to 4) + 3 = 12 to 15, plus about 15 percent = 14 to 17 person-weeks |
| Build effort, all stages | 2.5 to 3, plus 14 to 17, plus 5 to 7 = 22 to 27 person-weeks |

The one-time build cost in US dollars is the build effort multiplied by the price per person-week. The price per person-week is stated in the formal quote.
