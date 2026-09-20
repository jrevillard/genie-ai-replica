---
title: "Mobile (genie_ai_mobile)"
description: "Flutter client docs: UI inventory, architecture, deployment, end-user auth, and chat pipeline."
weight: 100
section: "mobile"
---

## Documents in this section

1. [UI Component Inventory (mobile)](/docs/mobile/ui-component-inventory-mobile/) — annotated map of every Dart file under `lib/`
2. [Mobile Architecture](/docs/mobile/mobile-architecture/) — layers, Riverpod state, security features, OIDC + SSE wiring
3. [Mobile Deployment Guide](/docs/mobile/mobile-deployment-guide/) — flavor onboarding, Android signing, iOS provisioning, App Links, store submission
4. [User Authentication](/docs/mobile/user-authentication/) — OIDC PKCE login flow, transparent token refresh, lifecycle validation, logout
5. [Chat Pipeline](/docs/mobile/chat-pipeline/) — SSE event taxonomy, feedback dialog, Quick Help overlay, PDF export, conversation management

## Quick links

| If you are… | Start with… |
|--------------|-------------|
| A new contributor to the mobile app | [UI Component Inventory](/docs/mobile/ui-component-inventory-mobile/) → [Mobile Architecture](/docs/mobile/mobile-architecture/) |
| Shipping a new institutional deployment | [Mobile Deployment Guide](/docs/mobile/mobile-deployment-guide/) |
| Debugging auth problems | [User Authentication](/docs/mobile/user-authentication/) → [Mobile Deployment Guide §3 (scheme coherence)](/docs/mobile/mobile-deployment-guide/#step-3-scheme-coherence-rule) |
| Implementing or extending the chat UX | [Chat Pipeline](/docs/mobile/chat-pipeline/) → [Mobile Architecture §5 (SSE)](/docs/mobile/mobile-architecture/#5-networking-and-sse) |
