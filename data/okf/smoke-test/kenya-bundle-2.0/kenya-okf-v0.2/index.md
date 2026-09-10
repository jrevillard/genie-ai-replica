---
description: >-
  Master index for Kenya public service delivery frameworks, digital portals,
  one-stop service centres, and the governing ministry. OKF v0.2 compliant
  knowledge bundle for RAG chatbots serving citizens and government workers.
labels:
  - 'd:public-administration'
  - 'g:kenya'
okf_version: '0.2'
sources:
  - id: huduma-official
    resource: https://www.hudumakenya.go.ke/
    title: Huduma Kenya Service Delivery Programme
  - id: ecitizen-portal
    resource: https://www.ecitizen.go.ke/
    title: eCitizen Portal
  - id: mps-official
    resource: https://mps.go.ke/
    title: State Department for Public Service
status: stable
tags:
  - index
  - public-services
  - kenya
title: Kenya Government Services Knowledge Base
type: index
generated:
  by: agent/grok
  at: 2026-08-30T03:30:00Z
---

# Kenya Government Services Knowledge Base

This knowledge base covers national public service delivery in Kenya: the
eCitizen digital portal, Huduma one-stop service centres, the Ministry of
Public Service and Human Capital Development, and a structured directory of
services. It is designed for retrieval-augmented generation (RAG) chatbots
that answer questions from citizens and government workers about available
services, eligibility, required documents, payment methods, processing times,
and how to obtain services.

## Contents

- [Service Directory](concepts/service-directory.md) — Canonical catalogue of
  public services grouped by category, with eligibility, documents, fees, and
  delivery channels.
- [eCitizen Digital Services & Payments](concepts/ecitizen-digital-payments.md) —
  National digital portal, account registration, payment channels (M-Pesa
  222222, cards, banks), refunds, tracking, and support.
- [Huduma Service Centres](concepts/huduma-kenya.md) — Physical one-stop
  centres (approx. 57–59 nationwide), services offered, appointment booking,
  operating hours (including extended 7am–7pm centres), and escalation paths.
- [Ministry of Public Service and Human Capital Development](concepts/ministry-of-public-service.md) —
  Governing ministry, mandate, directorates, relationship to Huduma Kenya
  Secretariat, and service delivery standards.

## How to use this bundle (RAG guidance)

1. Start with the **Service Directory** for “which service / which office /
   what documents” questions.
2. Route digital-application and payment questions to **eCitizen Digital
   Services & Payments**.
3. Route physical-visit, biometrics, collection, and multi-service questions
   to **Huduma Service Centres**.
4. Route policy, standards, workforce, escalation, and oversight questions to
   the **Ministry** concept.
5. Follow markdown links between concepts; they encode the authoritative
   relationships (ownership, delivery channel, escalation).

## Maintenance

Concepts are reviewed before publication. Broken links and stale concepts are
flagged by conformance validation. Prefer official sources
([Huduma Kenya](https://www.hudumakenya.go.ke/),
[eCitizen](https://www.ecitizen.go.ke/),
[MPS](https://mps.go.ke/)) when updating fees, locations, or processing times.
Fees and processing times change; always advise citizens to confirm on the
live portal.