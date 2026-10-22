# GENIE.AI "HealthBOT" — AWS Dev/Demo Deployment Report

**Environment:** Development / stakeholder demo
**URL:** https://asante.innov8ai.com
**Cloud:** AWS (us-east-1), managed with Terraform
**Date:** 12 July 2026

---

## 1. What was done
- Deployed the **GENIE.AI "HealthBOT"** platform to AWS as a **dev / demo environment**, fully defined in **Terraform** (infrastructure-as-code — reproducible and version-controlled).
- **Sovereign AI:** the language, translation, embedding and search models run **self-hosted on a GPU instance inside the AWS account** — no third-party AI API; data stays in-account.
- Stood up the full platform: secure web application, user authentication, AI chat (retrieval-augmented), **multilingual translation**, knowledge database and API gateway.
- Configured the **public domain, HTTPS/TLS certificate and DNS** for `asante.innov8ai.com`.

## 2. Attention points
- **Two secondary services need a small code fix** — document ingestion ("dataprep") and the reranker. These are **pre-existing application issues, not infrastructure**; the application team applies a minor fix and redeploys with no infrastructure change.
- **Knowledge base is empty** until document ingestion is restored — the assistant currently answers generally but cannot yet cite customer documents.
- **Cost:** the GPU instance runs continuously (~$1,700/month). Optional **auto-stop scheduling** (nights/weekends) reduces this to ~$575/month for demo use.
- **Single-node demo:** sized for demonstration, not production high-availability. A production design (separate application/AI tiers, managed database, redundancy) is documented as the next phase.

## 3. Process of installation
1. **Terraform** provisions all AWS infrastructure — network, GPU compute, load balancer, TLS/DNS, storage, secrets and access roles.
2. The server **auto-configures on first boot** — retrieves the application, builds the service images, deploys ~30 containerized services and downloads the AI models onto dedicated storage.
3. The result is a **repeatable, code-driven deployment** — the same process recreates the environment from scratch.

## 4. Current status
- 🟢 **Live and reachable** at https://asante.innov8ai.com (HTTPS, health checks passing).
- 🟢 **Core platform operational** (~20 services): web UI, login/authentication, AI chat (LLM), **multilingual translation**, search/retrieval, database and gateway.
- 🟡 **Pending:** document ingestion + reranker (see Attention Points), after which the knowledge base can be loaded.
- **Ready to demonstrate the platform now**; full document-grounded Q&A becomes available once the two items above are resolved and content is loaded.

---

# Addendum — 9 August 2026

Sections 1–4 above are the report as issued on 12 July and are unchanged. This
addendum records what has happened since.

## Resolved since the July report
- 🟢 **Document ingestion ("dataprep") and the reranker are fixed.** Both were
  the pre-existing application issues flagged under Attention Points. Document
  ingestion is available, so the knowledge base can now be loaded.
- 🟢 **Voice and language services are now running** — speech-to-text,
  text-to-speech, language identification and the WhatsApp channel. These had
  never started, because the speech voices and the language-identification
  model were not being downloaded to the server. The deployment now fetches
  them automatically.
- 🟢 **Automated deployment pipeline.** Application updates now deploy to the
  existing server from CI, without rebuilding or replacing the machine.

## Open items
- 🔴 **The public web address is intermittently unreachable — action needed
  from the domain owner.** The platform itself is healthy and serving traffic
  normally, but `asante.innov8ai.com` fails to resolve for a significant share
  of users. The domain's DNS is currently delegated to **two different
  configurations at once**, only one of which knows the address; visitors are
  routed to one or the other more or less at random, and those sent to the
  wrong one see the site as down.

  This cannot be corrected from the deployment account — the domain is
  registered elsewhere. It needs the domain owner to point the delegation at a
  single, agreed configuration. Note that both configurations also carry the
  company's main website and **email** records, so the change should be made
  deliberately rather than by simply switching. Until then the platform remains
  fully testable by IP address.
- 🟡 **Knowledge base is still empty.** Ingestion works now; content has not
  yet been loaded.
- 🟡 **Cost is unchanged** (~$1,700/month with the GPU running continuously).
  Note that automatic overnight shutdown was tried and **withdrawn**: on
  restart AWS had no GPU capacity available and the environment was down for
  about two hours. Scheduled shutdown is not recommended for this instance type.
