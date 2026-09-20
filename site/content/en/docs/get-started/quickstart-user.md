---
title: "Quickstart: User — chat in 10 minutes"
weight: 2
description: "Sign in to GENIE.AI, ask a question, read the sources, switch language, give feedback, and manage your conversation history."
mode: tutorial
persona: user
owner: docs-stewards
last_reviewed: 2026-09-19
---

## Goal

In about 10 minutes you will have **signed in to your organization's GENIE.AI
assistant, asked a real question, inspected the sources behind the answer,
switched the chat to your preferred language, and submitted feedback on the
response**.

You only need a browser — GENIE.AI runs entirely in the cloud, there is nothing
to install.

## Prerequisites

- The **chat URL** your organization gave you (for example
  `https://genie.example.gov`).
- A valid **SSO account**. GENIE.AI delegates authentication to
  [Keycloak](https://www.keycloak.org/), so the same username and password you
  use for other internal tools will work — including brokered identity providers
  (Microsoft Entra ID, Google Workspace, Okta) if your administrator has wired
  them up.
- A modern browser with **cookies enabled** and JavaScript turned on
  (Chrome, Firefox, Edge, or Safari, current version).
- Pop-ups **allowed** for the chat URL and the Keycloak URL (the sign-in page
  opens in a redirect you must allow on first visit).

## Step 1 — Open the chat and sign in

1. Open the chat URL in your browser. The first time you visit, a splash
   screen shows for a few seconds, then the app loads.
2. You are redirected to your organization's **Keycloak** login page. Enter
   your corporate credentials (or pick the federated identity provider your
   admin enabled — Google, Microsoft, Okta, etc.).
3. After successful authentication, you are redirected back to the chat. The
   user icon in the top-right corner is now active, indicating you are signed
   in.
4. If your account has the `admin` role, the **Administration** icon (grid)
   appears in the navbar. Regular users do not see this icon.

**Verify** — type a single character in the chat box and delete it. The
placeholder text *"Type your query here..."* reappears. You are now signed in.

> **Sign-in loop?** If you sign in successfully but the page bounces back to
> the login screen, your browser is blocking third-party cookies. Either allow
> cookies for both the chat URL *and* the Keycloak URL, or ask your admin to
> enable Keycloak's same-site cookie configuration.

## Step 2 — Ask your first question

The chat area takes up the main panel of the screen. Above it is the response
area, below it the input row.

1. Click the input box at the bottom of the screen. The placeholder reads
   *"Type your query here..."*.
2. Type your question in your own language. Examples:
   - *"How do I apply for a building permit?"*
   - *"What documents do I need to renew my national ID?"*
   - *"Tell me about the affordable housing program."*
3. Send your message in either of two equivalent ways:
   - Press <kbd>Enter</kbd> inside the box.
   - Click the **Send** button on the right.
4. While the assistant thinks, a small spinner with the label *"Thinking..."*
   appears. As soon as tokens stream back, the answer renders in a bot message
   bubble. The current time appears under the bubble.

**Verify** — the bubble contains a full sentence (or a polite refusal such as
*"I cannot answer"*). A timestamp appears under it.

> **Tip — multi-line questions.** Press <kbd>Shift</kbd>+<kbd>Enter</kbd> to
> insert a line break without sending. The input box has four rows; long
> questions scroll inside it.

## Step 3 — Read the sources behind the answer

GENIE.AI grounds every answer in documents from the organization's knowledge
base. Each bot message carries two transparency signals directly under the
text:

- **Confidence** — a percentage shown next to a brain icon, e.g.
  *Confidence: 78%*. The score is the mean of the reranker scores for the
  passages used; higher = more strongly supported by the documents.
- **Grounded vs. AI-generated** — if the answer is fully grounded in library
  documents you see the confidence chip. If the assistant chose not to use
  any document, you see a sparkle icon with the label
  *"AI-generated — not based on library documents"*. Both are honest
  signals; neither means the answer is wrong.

For the full list of source passages, open the **right sidebar** by clicking
the chevron at the screen edge (or use the toggle). The section *"Related
Documents"* shows the top-N documents that informed the answer, with:

- **Title** and **Document Name** — the source file the chunk came from.
- **URL** — the clickable address if the source is an external link.
- **Labels** — taxonomy tags the retriever matched (e.g. *Taxes*, *Identity*).
- **Confidence** — the per-document score, on the same 0–100% scale.

Click any card to open the source. You can collapse the panel with the
*Collapse sidebar* button at its top.

> **Why this matters.** *"Confidence: 24%"* or an *AI-generated* flag tells you
> to double-check the answer before acting on it. *"Confidence: 92%"* with
> three matching documents tells you the answer is well supported.

## Step 4 — Switch language

The interface and the answers can both be in your language.

1. The **language selector** lives in the top-right navbar (on mobile it sits
   next to the hamburger button).
2. Click it and choose your language from the dropdown. Supported locales
   out of the box include English, French, Spanish, Arabic, Bengali, German,
   Indonesian, Swahili, Mandarin, Thai, Portuguese, Russian — your deployment
   may expose a subset (your admin controls this via the
   `VUE_APP_AVAILABLE_LOCALES` config).
3. The whole UI re-renders immediately — buttons, labels, and menus — and the
   placeholder changes from *"Type your query here..."* to the equivalent
   in your locale.
4. Answers are translated on the fly. If the assistant cannot translate a
   passage (rare technical terms, names), the original wording is preserved in
   parentheses.

**Verify** — the placeholder text appears in the language you selected; the
brand name in the navbar still reads *"GENIE.AI"*.

> **Locale not in the list?** Contact your admin. They can add a locale by
> extending `VUE_APP_AVAILABLE_LOCALES` and shipping the corresponding
> translation file. The system already ships 14 locales; expanding is a
> configuration change, not a release.
>
> See [Restrict active locales](/docs/configure/locale-whitelist/) for the canonical deployer reference.

## Step 5 — Manage your conversation history

Your conversations live in the **left sidebar** under the second tab,
*"Saved Chats"* (the History icon).

The Saved Chats tab has four sub-tabs at the top: **All Chats**, **Folders**,
**Starred**, and **Archived**. Inside each:

- Click a conversation title to **reopen** it — the chat history scrolls back
  and you can continue the conversation.
- Hover a row to reveal action icons: **Star**, **Rename**, **Move to folder**,
  **Archive**, and **Delete**.
- Use the search box at the top to filter by title.
- Folders let you group related conversations. Click **+ Create Folder** to
  add one, then drag conversations into it (or use the *Move Chat* action).

The first tab, **Knowledge Areas**, is the browsable catalog of services your
admin has published (e.g. *Taxes*, *Identity*, *Business Registration*).
Picking a service there adds it as *Query Context* — the assistant will then
prefer documents in that area. Click the ✕ next to a context chip to remove
it.

> **Want to start fresh?** Click the **+** button (top-left of the input
> area) to start a new conversation. If you have unsaved messages, GENIE.AI
> prompts you to save them first.

**Verify** — start a new chat, send one message, then save it with the
*Save Chat* icon (the floppy disk next to the +). Title the chat, pick a
folder, and reopen it from the *All Chats* sub-tab.

## Step 6 — Give feedback on the answer

Your feedback is the single most useful signal for improving the assistant.
Each bot message has a small **Feedback** button underneath.

1. Click **Feedback** below the answer.
2. A dialog opens with two ways to rate the answer:
   - **Thumbs up** (positive) or **thumbs down** (negative), each with a
     human-icon picker for the colour tone.
   - A **1–5 rating scale**: *1 Useless*, *2 Slightly Helpful*,
     *3 Moderately Helpful*, *4 Very Helpful*, *5 Life Changing*.
3. Optionally type a one-line reason in the *Additional comments...* box
   (e.g. *"Answer is out of date"*, *"Wrong department cited"*).
4. Click **Submit**. A confirmation toast appears: *"Thank you for your
   feedback!"*.

**Verify** — the dialog closes; the rating and comment are saved against the
specific bot message. Admins see aggregated feedback in the *Analytics*
dashboard; nothing is shared with other users.

> **Why thumbs AND a rating scale?** Thumbs are fast. The 1–5 scale is more
> diagnostic — a thumbs-down *"Slightly Helpful"* tells operators the answer
> was on-topic but weak, not wrong.

## Step 7 (optional) — Bring your own document

Some deployments let users upload their own files (PDFs, Word documents,
images, links) so the assistant can answer against *your* material in
addition to the shared knowledge base.

1. In the chat area, click the **paperclip / upload** icon (if enabled by your
   admin).
2. Pick a file from your computer. The file is scanned (ClamAV) and queued
   for ingestion.
3. Wait until the file's status flips from *Pending* to *Ingested*. This can
   take a minute for short files, several minutes for large PDFs — the
   ingestion log (visible in *Admin → Document Repository*) shows progress.
4. Once ingested, ask a question that references the document. The assistant
   will cite it in *Related Documents*.

If your admin has not enabled user uploads, the upload icon is hidden.

> **Privacy.** Uploaded files are stored in your organization's ArangoDB and
> are visible to admins for moderation and to other authorized users only
> when the admin explicitly shares the file with a knowledge area. Files are
> scanned for malware before they enter the pipeline.

## Keyboard shortcuts

GENIE.AI follows common chat-app conventions so the keyboard does the heavy
lifting once you learn them.

| Shortcut | Action |
|---|---|
| <kbd>Enter</kbd> (in the input box) | Send the message |
| <kbd>Shift</kbd>+<kbd>Enter</kbd> (in the input box) | Insert a line break |
| <kbd>Esc</kbd> (with a modal open) | Close the dialog (login, feedback, save, etc.) |
| <kbd>Tab</kbd> | Move focus through buttons, links, and input fields |
| <kbd>Shift</kbd>+<kbd>Tab</kbd> | Move focus backwards |
| Click the hamburger icon | Toggle the left sidebar |
| Click the right-edge chevron | Toggle the *Info & Resources* sidebar |

Screen-reader users: every interactive element exposes an `aria-label` — the
hamburger is *"Toggle sidebar"*, the user icon is *"User profile"*, the logout
icon is *"Log out"*, and so on. The chat window itself is a polite live region
(`aria-live="polite"`), so new bot messages are announced without stealing
focus.

## Troubleshooting

| Symptom | Likely cause | What to try |
|---|---|---|
| Splash screen never goes away | The browser could not load `/config/splash.png` (slow network or blocked asset) | Refresh; the app falls back to a placeholder and proceeds automatically |
| Login loop — you sign in and bounce back | Cookies for the chat URL or Keycloak URL are blocked | Allow cookies for both domains in your browser; disable any extensions that strip cookies |
| The language selector is greyed out or missing | Your admin pinned a single locale for your realm, or restricted `VUE_APP_AVAILABLE_LOCALES` | Contact your admin |
| You see *"AI-generated — not based on library documents"* on every answer | No document in the knowledge base matches your query, or all matches had very low confidence | Try a broader question; if a known topic still shows the flag, ask your admin whether the relevant files are ingested |
| Answer is *"I cannot answer"* but the document exists | The file is still *Pending* / *Ingesting*, or its ingestion failed | Open *Info & Resources* in the right sidebar → the linked document should appear; otherwise ask your admin to check the ingestion log |
| A message has *Confidence: 18%* | The retriever matched something, but the reranker judged it only weakly relevant | Treat the answer as a hint, not a fact; ask a more specific question or add a Knowledge Area as query context |
| Feedback dialog opens but **Submit** is disabled | You picked neither a thumb nor a 1–5 rating | Pick at least one — comments alone are not enough to submit |
| *"Your session has expired. Please log in again."* | Your Keycloak token (default lifetime: 15 minutes of inactivity, 30 minutes absolute) has timed out | Sign in again; your unsent draft in the input box is preserved |
| You do not see *Administration* in the navbar | Your account is not in the `admin` role | Ask your admin to grant the role in Keycloak |
| Upload icon missing | Your deployment has not enabled user uploads | Ask your admin to enable user uploads on the document-repository service |
| Chat history is empty after signing in from a new device | Conversations are stored per-account and per-deployment | New device = empty history; previous conversations are accessible on the original device |

## FAQ

**Where does my data live?** Your chat history and uploaded files are stored
in your organization's GENIE.AI deployment — ArangoDB for conversations,
document-repository for files. Nothing is sent to GENIE.AI upstream servers
or to the language-model provider beyond the query text needed to generate
the answer. See the [architecture overview](/docs/architecture/architecture/)
for the data flow.

**Who can see my questions?** The system operators (your organization's
admins) can read conversation logs and feedback for the purpose of
moderation, debugging, and improvement. Other end users **cannot** see your
conversations. Anonymous, aggregated metrics (counts of questions per day,
satisfaction scores) appear in the analytics dashboard.

**Is the answer always right?** No. GENIE.AI grounds answers in your
documents and shows the confidence score for each one, but the LLM can still
make mistakes — especially on questions that fall outside the knowledge base.
Treat a *low confidence* or *AI-generated* flag as a reason to verify before
acting. The feedback you submit helps the operators find and fix bad answers.

**Can I delete a conversation?** Yes. Hover any conversation in the *Saved
Chats* tab and click the trash icon. Confirm in the dialog. Deletion is
immediate and irreversible — the conversation and its feedback are removed
from the database (GDPR-compliant).

**Can I export a chat?** Click the *Export Chat* icon (a document icon next
to the save button). Choose a filename and click **Export**. The chat is
written to a PDF in your browser's download folder.

**Does the chat cost anything?** GENIE.AI is sovereign software licensed
under Apache 2.0 — there is no per-user fee to your organization. Your
deployment's compute and storage costs are the only costs involved.

**What about my language?** The chat UI is translated into 14 locales out of
the box. The assistant answers in your selected language and translates
documents on the fly. If a term has no clean translation, the original is
kept in parentheses.

**Where is the mobile app?** A Flutter mobile client is available — see the
[Mobile app](/docs/mobile/) section. The web app also adapts to phones and
tablets; the navbar collapses into a hamburger menu below 768 px.

## Related

- [Welcome — one-pager](/docs/get-started/welcome/) — the 30-second version.
- [Concepts in 5 minutes](/docs/get-started/concepts/) — the query →
  embedding → retriever → reranker → LLM mental model.
- [Glossary](/docs/get-started/glossary/) — *RAG*, *embedding*, *reranker*,
  *BM25*, *OPEA*, and the rest of the alphabet soup.
- [FAQ](/docs/get-started/faq/) — the 12 questions deployers ask first.
- [Where to next?](/docs/get-started/where-to-next/) — paths for each persona.
- [Knowledge base — content guidance](/docs/knowledge-base/content-guidance/)
  — what the documents your assistant reads look like.
- [Architecture overview](/docs/architecture/architecture/) — the system map
  behind the chat screen.
- [Privacy & data handling](/docs/operate/security-hardening/) — what is stored,
  where, and for how long.
- [Report a problem with these docs](/docs/contribute/how-to-mr/) — spotted a
  typo or a UI label that has drifted? Open an issue or MR.