---
description: >-
  Kenya’s national digital government portal (eCitizen): account registration,
  service application flow, supported payment channels (M-Pesa 222222, cards,
  banks), refunds, tracking, convenience fees, and support contacts.
sources:
  - id: ecitizen-help
    resource: https://accounts.ecitizen.go.ke/en/help-and-support
    title: eCitizen Help & Support
  - id: ecitizen-portal
    resource: https://www.ecitizen.go.ke/
    title: eCitizen Portal
  - id: ecitizen-paybill
    resource: https://paybillke.com/paybill/ecitizen
    title: eCitizen M-Pesa Paybill reference
tags:
  - payments
  - digital-services
  - ecitizen
title: eCitizen Digital Services & Payments
type: topic
status: stable
generated:
  by: agent/grok
  at: 2026-08-30T03:30:00Z
---

# eCitizen Digital Services & Payments

eCitizen (ecitizen.go.ke) is Kenya’s official unified digital portal for
Government-to-Citizen (G2C) services. Citizens, residents, and foreigners can
create an account, discover and apply for services from multiple ministries,
departments, and agencies, pay online, track status, and download receipts or
documents. The portal is overseen by the Directorate of eCitizen under the
Ministry of Interior and National Administration and is tightly integrated with
physical delivery through [Huduma Service Centres](huduma-kenya.md).

The [Service Directory](service-directory.md) lists the major service families
that accept digital application and payment through the portal.

## Who can use eCitizen

- Kenyan citizens (full access to citizen services).
- Residents and foreigners (access to the subset of services open to non-
  citizens, e.g. visas, certain permits).

Registration requires a valid national ID (or Alien ID / passport details as
applicable), mobile number, and email for OTP verification.

## Account creation (high level)

1. Visit www.ecitizen.go.ke (or accounts.ecitizen.go.ke).
2. Choose Register and select Citizen / Foreigner / Resident.
3. Provide ID details, contact information, and complete verification.
4. Log in and navigate to the desired ministry / department service catalogue.

USSD shortcut (where available): `*222*222#` for limited status and
notification functions.

## Typical application + payment flow

1. Log in and select the service (e.g. Passport Application under Directorate
   of Immigration Services).
2. Complete the online form and upload any required scans.
3. Submit the application; the system generates a payment invoice / reference.
4. Choose a payment method and settle the fee (plus any convenience fee).
5. Download / print the application form, payment receipts, and any appointment
   or acknowledgement documents.
6. Complete any mandatory in-person step (biometrics, document verification,
   collection) — often at an immigration office or a Huduma Centre.
7. Track status from the eCitizen dashboard; receive SMS/email notifications.

## Payment channels

Supported methods (availability can vary by service and gateway version):

| Channel              | How it works                                      | Notes |
|----------------------|---------------------------------------------------|-------|
| M-Pesa               | Paybill **222222**; Account = eCitizen invoice / reference number. STK Push (Express) is also offered on many flows. | Dominant channel. Instant confirmation via SMS. |
| Airtel Money         | Available on the payment gateway                  |       |
| Debit / Credit cards | Visa / Mastercard on the payment provider page    | Portal does not store card data. Useful for diaspora. |
| Bank transfer / deposit | Selected banks (KCB, Equity, and others listed on the gateway); Pesalink, RTGS | Institutional or larger payments; cash deposit options exist at some bank branches. |
| Other mobile / agent | E-agent, PostaPay, various bank mobile apps and USSD | Gateway lists current options at checkout. |

**M-Pesa steps (manual Paybill)**:
1. M-Pesa → Lipa na M-Pesa → Pay Bill.
2. Business Number: `222222`.
3. Account: the exact reference / invoice number from eCitizen.
4. Amount: the exact amount shown (including any convenience fee).
5. Enter PIN and confirm. Wait for both M-Pesa and eCitizen confirmation before
   retrying.

A convenience fee (commonly cited around KES 50 on some services) may be added
to the base service fee; the total payable is shown at checkout.

## Refunds

When an application is rejected or cancelled before processing, the fee is
normally refunded to the original payment channel using the payment reference.
Citizens do not need to supply separate bank details for standard refund
routing. For delayed or missing refunds, contact eCitizen support with the
application and payment references.

## Tracking and support

- Status tracking: eCitizen dashboard after login.
- Support contacts (from official help pages):
  - Phone: +254 207 903 260 (24/7 cited on help pages)
  - Email: support@ecitizen.go.ke
  - Physical: any Huduma Centre nationwide for assisted resolution
- Always retain the application reference and payment confirmation SMS/receipt.

## Integration notes for service delivery

- Many services are “apply & pay online, complete biometrics / collect offline”.
  The hand-off points are documented in the individual service entries in the
  [Service Directory](service-directory.md) and in the physical access guidance
  of [Huduma Service Centres](huduma-kenya.md).
- Payment gateway maintenance windows are announced by the Directorate; during
  downtime, new payments are unavailable even if applications can still be
  drafted.

## Relationship to other concepts

- Canonical list of services that accept digital payment:
  [Service Directory](service-directory.md).
- Physical one-stop completion and collection:
  [Huduma Service Centres](huduma-kenya.md).
- Oversight of broader public-service delivery standards:
  [Ministry of Public Service and Human Capital Development](ministry-of-public-service.md).