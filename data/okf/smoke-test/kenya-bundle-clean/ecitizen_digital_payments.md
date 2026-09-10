---
type: service
title: "eCitizen Digital Payments"
description: "How citizens pay for government services digitally through the national portal, including supported payment channels and refund routing."
status: stable
tags: [payments, digital-services]
labels: [t:smoke, d:digital-government]
---

# eCitizen Digital Payments

The national portal lets citizens apply and pay for government services
online. Payment is collected at the point of application submission, and the
receipt reference is attached to the application record.

## Payment Channels

1. **Mobile money** — the dominant channel; the citizen approves a push
   prompt on their handset and the portal confirms settlement.
2. **Debit and credit cards** — card details are entered on the payment
   provider's page; the portal never stores card data.
3. **Bank transfer** — for institutional applicants; settlement is matched to
   the application by the payment reference.

## Refunds

When an application is rejected before processing, the fee is refunded to the
original payment channel. Refund routing follows the payment reference, so
citizens do not need to provide account details separately.

## Integration Notes

The service directory entry ([Service Directory](./service_directory.md)) is
the canonical list of services that accept digital payment through the portal.
