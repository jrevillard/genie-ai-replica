---
description: >-
  Directory of major public services available through eCitizen and Huduma
  Centres, grouped by category, with eligibility, required documents, typical
  fees, processing times, and delivery channels.
sources:
  - id: huduma-services
    resource: https://www.hudumakenya.go.ke/services-0
    title: Huduma Kenya Services
  - id: ecitizen-help
    resource: https://accounts.ecitizen.go.ke/en/help-and-support
    title: eCitizen Help & Support
  - id: immigration-passport
    resource: https://immigration.ecitizen.go.ke/
    title: Directorate of Immigration Services (eCitizen)
tags:
  - services
  - directory
  - catalogue
title: Service Directory
type: topic
status: stable
generated:
  by: agent/grok
  at: 2026-08-30T03:30:00Z
---

# Service Directory

The national service catalogue groups public services that citizens and
residents can obtain through the eCitizen portal, Huduma Centres, or both.
Each entry records eligibility, required documents, typical fees (subject to
change — always confirm on the live portal), approximate processing time, and
the primary delivery channel(s).

This directory is the recommended entry point for assistants answering
“which office handles X”, “what documents do I need”, or “can I do this
online” questions. Authoritative detail for digital payments lives in
[eCitizen Digital Services & Payments](ecitizen-digital-payments.md); physical
access and appointments live in [Huduma Service Centres](huduma-kenya.md);
policy and escalation ownership live in the
[Ministry of Public Service and Human Capital Development](ministry-of-public-service.md).

## Identity and Civil Registration

### National Identity Card (first-time application)

- **Eligibility**: Kenyan citizen by birth or registration, aged 18 or older.
- **Required documents** (originals + copies):
  - Birth certificate or notification of birth
  - One or both parents’ national ID cards (or death certificates + ID copies
    if deceased; chief’s affidavit if parent ID unavailable)
  - School leaving certificate / KCPE or KCSE certificate (recommended)
  - Two recent passport-size photographs (white background); many centres
    capture digital photos on-site
  - Form 23 (completed at the registration point)
  - Chief’s / assistant chief’s vetting letter confirming identity and
    citizenship (common requirement for first-time applicants)
- **Fees**: Nominal registration fee (historically low; confirm current amount
  at point of service). Replacement of lost/damaged ID is higher (commonly
  cited around KES 1,000).
- **Processing time**: Typically 30–90 days after biometrics; collection at
  the centre of application. Check readiness via Huduma / National
  Registration Bureau channels.
- **Channels**: Primarily physical — Huduma Centres, National Registration
  Bureau offices, or assistant chief’s offices. Biometric capture (photo +
  fingerprints) is mandatory in person. Some preparatory steps or status
  tracking may be available digitally.
- **Notes**: Digital ID activation (Maisha / eCitizen Digital ID) can be done
  via the eCitizen app (self-enrolment with face/fingerprint scan) or assisted
  at a Huduma Centre.

### National ID — replacement / duplicate / change of particulars

- **Eligibility**: Holder of a previously issued national ID.
- **Key documents**: Police abstract (for lost), affidavit, previous ID copy
  if available, supporting documents for name/address change (e.g. marriage
  certificate, divorce decree).
- **Channels**: Huduma Centres and NRB offices.

### Birth Certificate (issuance / late registration / duplicate)

- **Eligibility**: Birth occurred in Kenya or registrant is a Kenyan citizen.
- **Key documents**: Notification of birth / hospital records, parents’ IDs,
  for late registration additional supporting evidence and possibly chief’s
  letter.
- **Channels**: Civil Registration Services via eCitizen (application) +
  Huduma Centres for collection / assisted services. Death certificates follow
  a parallel path.

### Passport (ordinary ePassport)

- **Eligibility**: Kenyan citizen holding a valid national ID (or birth
  certificate for minors).
- **Process overview**:
  1. Create / log in to eCitizen account.
  2. Complete online Form 19 under Directorate of Immigration Services.
  3. Pay the prescribed fee.
  4. Print application form and payment receipts.
  5. Book and attend biometrics appointment (photo, fingerprints) at an
     immigration office (Nyayo House Nairobi, Mombasa, Kisumu, selected
     regional offices, or Kenyan mission abroad).
  6. Track status on eCitizen; collect when notified.
- **Key documents for biometrics** (typical adult first-time / renewal):
  - Printed eCitizen Form 19 (signed/dated)
  - Payment receipts (government + customer copies)
  - Original + copy of national ID
  - Original + copy of birth certificate
  - Recent passport-size photographs (white background; quantity varies by
    centre — often 2–3)
  - Old passport (for renewal/replacement)
  - For lost: police abstract + sworn affidavit
  - For minors: parental consent, parents’ IDs, additional photos
  - Recommender’s ID copy (where required)
- **Fees** (indicative; confirm on portal): Ordinary passport fees commonly
  range from approximately KES 4,550 (smaller booklet) upward depending on
  number of pages / series; express options attract higher fees. East African
  passport has a lower fee band.
- **Processing time**: Official guidance commonly cites ~10 working days after
  biometric capture for first-time applications and ~5 working days for
  renewals/replacements. Express / priority channels and capacity improvements
  can reduce this (sometimes cited as low as 2–3 days in high-priority cases).
  Abroad applications take longer (weeks).
- **Channels**: Application and payment exclusively via eCitizen; biometrics
  and collection at designated immigration points. Some collection support via
  Huduma Centres for related documents.

## Transport and Licensing (NTSA)

- Driver’s licence application, renewal, duplicate, provisional licence (PDL),
  smart DL biometric capture.
- Vehicle registration, logbook (duplicate, change of ownership), inspection
  certificates, number plates.
- **Channels**: eCitizen / NTSA TIMS portal for applications and payments;
  biometrics and physical submission often at Huduma Centres or NTSA stations.

## Business and Lands

- Business name search and registration, limited company registration
  (Business Registration Service — BRS).
- Land search, title deed verification, land rent / rates payment.
- **Channels**: Heavily digital via eCitizen; assisted service and some
  payments available at Huduma Centres.

## Tax and Social Protection (selected)

- KRA PIN registration, tax compliance certificate (TCC), returns filing
  (via KRA / eCitizen integrations).
- NHIF / Social Health Authority (SHA) and NSSF registration and related
  services.
- **Channels**: Digital portals primary; Huduma Centres for assisted
  registration and queries.

## Security and Clearance

- Police Clearance Certificate (Certificate of Good Conduct) — application,
  fingerprinting, tracking, collection.
- **Channels**: Application often online; fingerprinting and collection at
  selected Huduma Centres (historically concentrated in Nairobi centres such
  as GPO, City Square, Eastleigh, Makadara, Kibra, with expansion).

## Marriage and Civil Status

- Notice of marriage, registrar’s certificate, solemnization, marriage
  certificate issuance.
- **Channels**: Registrar of Marriages via eCitizen + physical attendance
  where required.

## Digital Government Meta-Services

- eCitizen account creation, payment, tracking, and support — see
  [eCitizen Digital Services & Payments](ecitizen-digital-payments.md).
- Appointment booking and multi-service visits — see
  [Huduma Service Centres](huduma-kenya.md).

## Using this directory in a RAG assistant

- Prefer the most specific concept page when the user already knows the
  service family.
- Always disclose that fees, exact document lists, and processing times are
  subject to change and must be confirmed on the live eCitizen portal or at
  the service counter.
- For multi-step journeys (online application → payment → biometrics →
  collection), surface both the digital and physical concepts and the
  hand-off points.