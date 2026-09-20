---
title: User Profile
description: The 8-tab profile form, what each tab captures, the search-backed country dropdown, and the backend routes that load, save, reset, and delete the data.
weight: 9
mode: reference
audience: developer, user
last_reviewed: 2026-09-18
persona: developer
owner: "docs-stewards"
---

> **For frontend developers extending the form, and for operators
> supporting GDPR delete/reset requests.** The user profile page is a
> vertical, 8-tab form (Personal Identification → Civil Registration →
> Address & Residency → Identity Documents → Health Info → Employment
> Info → Education Records → Financial Info) backed by `PUT /api/me` for
> saves and two destructive endpoints (`POST /api/me/reset-data`,
> `POST /api/me/delete`) for compliance workflows.

This page documents what each tab captures, the component layout, the
search-backed country dropdown, and the backend surface.

## Prerequisites

- A Keycloak access token with the `genie-app` client (the same one used
  by the chat — see [Auth Flow](/docs/frontend/auth-flow/)).
- The `userProfileService` configured on the backend (default `true`
  in `ROUTE_CONFIGS`). Mounted at `/api/me` per
  [`components/gov-chat-backend/index.js:471`](https://gitlab.com/un/itu/genie-ai/-/blob/main/components/gov-chat-backend/index.js#L471).
- The Vuex `currentUser` getter populated (the form is gated on this
  via `v-if="!isLoading && isAuthenticated && currentUser"` in
  `App.vue`).

## Tab inventory

The 8 tabs are declared as a single static array in
[`components/gov-chat-frontend/src/components/UserProfileComponent.vue:403-411`](https://gitlab.com/un/itu/genie-ai/-/blob/main/components/gov-chat-frontend/src/components/UserProfileComponent.vue#L403):

```javascript
tabs: [
  { key: 'personalIdentification' },
  { key: 'civilRegistration' },
  { key: 'addressResidency' },
  { key: 'identityDocuments' },
  { key: 'healthInfo' },
  { key: 'employmentInfo' },
  { key: 'educationRecords' },
  { key: 'financialInfo' }
]
```

| # | Tab | Captured fields | Backend field path |
|---|-----|-----------------|---------------------|
| 1 | **Personal Identification** | `fullName`, `dob`, `gender`, `nationality`, `profileIcon` | `formData.personalIdentification.*` |
| 2 | **Civil Registration** | `birthCert`, `citizenship`, `immigration` | `formData.civilRegistration.*` |
| 3 | **Address & Residency** | `currentAddress`, `postalCode`, `country` (with `residencyStatus`) | `formData.addressResidency.*` |
| 4 | **Identity Documents** | `idCard`, `passport`, `driversLicense` | `formData.identityDocuments.*` |
| 5 | **Health Info** | `bloodType`, `organDonor` | `formData.healthInfo.*` |
| 6 | **Employment Info** | `employer`, `position`, `employmentStatus` | `formData.employmentInfo.*` |
| 7 | **Education Records** | `institution`, `degree`, `graduationYear`, `fieldOfStudy` | `formData.educationRecords.*` |
| 8 | **Financial Info** | `bankName`, `iban`, `taxId` | `formData.financialInfo.*` |

Tab labels come from i18n keys `tabs.tab1` … `tabs.tab8` (see the
`profileTabs` computed at `UserProfileComponent.vue:493`). The first tab
is always active on mount (`activeTab: 0`).

## Form pattern: DS primitives

Every input on every tab is one of four `Ds*` design-system primitives:

| Primitive | Used for |
|-----------|----------|
| `DsInput` | Free-text (`fullName`, `currentAddress`, `bankName`, …), dates (`dob`), and numbers (`graduationYear`). |
| `DsSelect` | Enumerated values with a fixed, short list (`gender`, `bloodType`, `employmentStatus`). |
| `DsCombobox` | Long lists (employment sectors, degree types) — searchable but bounded. |
| `SearchableCountryDropdown` | The two country fields (`nationality`, `addressResidency.country`) — see below. |

The `DsTabs` wrapper handles keyboard navigation (←/→ to move between
tabs, Home/End to jump to ends) and ARIA labelling automatically; no
custom tab JS is in the component.

### The `SearchableCountryDropdown`

The country fields are special. The `restcountries` API exposes ~250
countries, so a plain `<select>` would be unusable; a
`<DsCombobox>` is used but with extra behaviour:

- **Typeahead** — the user types "El Sal" and the dropdown narrows to
  "El Salvador" only.
- **Flag emoji** — shown next to each country name (🇸🇻 El Salvador).
- **Persisted selection** — when switching to a different tab and back,
  the country picker re-applies its current value via
  `manuallySetCountryName(name)`. The re-application is done by the
  parent component's `activeTab` watcher (see
  `UserProfileComponent.vue:520-544`), not by the dropdown itself.

The dropdown is in
[`components/gov-chat-frontend/src/components/SearchableCountryDropdown.vue`](https://gitlab.com/un/itu/genie-ai/-/blob/main/components/gov-chat-frontend/src/components/SearchableCountryDropdown.vue).

## Profile icon (Personal Identification tab)

The first tab carries a 60×60 avatar with a colour palette
(`UserProfileComponent.vue:480-488`):

```javascript
colorOptions: [
  '#4E97D1', // Blue
  '#2ECC71', // Green
  '#E74C3C', // Red
  '#F39C12', // Orange
  '#9B59B6', // Purple
  '#1ABC9C', // Teal
  '#34495E', // Dark Blue
  '#D35400'  // Burnt Orange
]
```

Click the avatar to open the picker; selecting a swatch writes the hex
into `formData.personalIdentification.profileIcon` and the next render
uses it as the avatar fill. The picker's locale is governed by the same
`currentLocale` that drives the rest of the UI — switching to French
re-labels "Profile icon" to "Photo de profil".

## Backend surface

All endpoints live under `/api/me` and require a Keycloak JWT (the
`keycloakAuth` flag in `ROUTE_CONFIGS`).

| Method | Path | Behaviour | Source |
|--------|------|-----------|--------|
| `GET` | `/api/me` | Fetch the current user's profile (including all 8 tabs). | [`user-routes.js:67`](https://gitlab.com/un/itu/genie-ai/-/blob/main/components/gov-chat-backend/routes/user-routes.js#L67) |
| `GET` | `/api/me/context` | Convenience endpoint for the chat service — selected fields only (e.g. `language`, `country`, `labels`). | [`user-routes.js:99`](https://gitlab.com/un/itu/genie-ai/-/blob/main/components/gov-chat-backend/routes/user-routes.js#L99) |
| `PUT` | `/api/me` | Replace the profile. Accepts `multipart/form-data` (so a future avatar upload works). | [`user-routes.js:241`](https://gitlab.com/un/itu/genie-ai/-/blob/main/components/gov-chat-backend/routes/user-routes.js#L241) |
| `POST` | `/api/me/reset-data` | GDPR **data reset** — wipes the profile data but keeps the account. | [`user-routes.js:144`](https://gitlab.com/un/itu/genie-ai/-/blob/main/components/gov-chat-backend/routes/user-routes.js#L144) |
| `POST` | `/api/me/delete` | GDPR **account deletion** — deletes the account and all associated data (ArangoDB `users`, chat history, feedback). | [`user-routes.js:184`](https://gitlab.com/un/itu/genie-ai/-/blob/main/components/gov-chat-backend/routes/user-routes.js#L184) |

### `PUT /api/me` payload shape

```json
{
  "personalIdentification": {
    "fullName": "Jane Doe",
    "dob": "1990-04-12",
    "gender": "female",
    "nationality": "El Salvador",
    "profileIcon": "#4E97D1"
  },
  "civilRegistration": {
    "birthCert": "1234567",
    "citizenship": "El Salvador",
    "immigration": ""
  },
  "addressResidency": {
    "currentAddress": "1 Calle Principal, San Salvador",
    "postalCode": "1101",
    "country": "El Salvador",
    "residencyStatus": "resident"
  },
  "identityDocuments": {
    "idCard": "01234567-8",
    "passport": "P1234567",
    "driversLicense": ""
  },
  "healthInfo": {
    "bloodType": "O+",
    "organDonor": false
  },
  "employmentInfo": {
    "employer": "Acme Corp",
    "position": "Engineer",
    "employmentStatus": "employed"
  },
  "educationRecords": {
    "institution": "Universidad de El Salvador",
    "degree": "bachelor",
    "graduationYear": 2015,
    "fieldOfStudy": "Computer Science"
  },
  "financialInfo": {
    "bankName": "Banco Agrícola",
    "iban": "AG123456789012345678",
    "taxId": "1234-567890-123-4"
  }
}
```

The endpoint uses `upload.any()` middleware to accept
`multipart/form-data` — this is forward-compatible with avatar uploads
and avoids forcing JSON. Pass JSON as `Content-Type: application/json` if
no file is attached; pass `multipart/form-data` if an avatar upload is
attached.

## Privacy surface

The first paragraph under the heading reads:

```text
{{ translate('privacyInfo') }}
<a href="#" class="privacy-link">{{ translate('privacyPolicyLink') }}</a>
```

The link target is a placeholder `#` — replace it with the deployed
privacy-policy URL when your deployment has one. The
`privacyInfo` translation key carries the long-form notice ("Your data
is stored locally and only used to personalize your experience…").

## Reset and delete from the UI

The destructive flows are **not** inside `UserProfileComponent.vue` —
they live in the **Settings** page (see [Settings Page](/docs/frontend/settings-page/))
because GDPR-style destructive actions are typically grouped under
"Account Management", not "Profile".

| Action | Where in the UI | Endpoint |
|--------|-----------------|----------|
| Reset profile data | Settings → Account Management → **Reset my data** | `POST /api/me/reset-data` |
| Delete account | Settings → Account Management → **Delete my account** | `POST /api/me/delete` |

Both open a `ConfirmDialog` with a simple confirm/cancel prompt (no typed-confirmation — the Confirm button is enabled as soon as the dialog opens).

## Loading and error states

The component uses three DS primitives to render load/error states:

| State | Primitive | When |
|-------|-----------|------|
| Loading | `DsSpinner overlay` | During the initial `GET /api/me` fetch. |
| Error | `DsStateDisplay type="error"` | When the fetch fails; shows a "Retry" button calling `fetchUserData` again. |
| Loaded | `DsTabs` + the 8-tab form | Default state. |

The same pattern is used in the Settings page — see
[Settings Page](/docs/frontend/settings-page/) for the matching layout.

## Verifying it works

```bash
ADMIN_TOKEN=...   # or any user JWT

# 1. Fetch current profile
curl -sk -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://<NGINX_PUBLIC_DOMAIN>/api/me | jq .

# 2. Update one tab (just the address)
curl -sk -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"addressResidency":{"currentAddress":"New address","postalCode":"1102","country":"El Salvador","residencyStatus":"resident"}}' \
  https://<NGINX_PUBLIC_DOMAIN>/api/me

# 3. Confirm the change
curl -sk -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://<NGINX_PUBLIC_DOMAIN>/api/me | jq .addressResidency
```

The 4th tab (`identityDocuments`) is rendered for **all** users
unconditionally. There is no under-18 visibility check — the `/api/me`
endpoint does not filter `identityDocuments` by `dob`, and
`user-routes.js` / `user-profile-service.js` contain no age-based logic.

## Failure modes and troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Country picker is empty | The frontend cannot reach `restcountries.com` | The dropdown has no local cache — it fetches `restcountries` on every page load. Verify the network reachability in the browser DevTools Network tab. |
| Save fails with 413 (payload too large) | The avatar upload is too big | The PUT uses `upload.any()`; the default `express.json` 100 KB limit applies. Either compress the avatar or change the limit in the deployment's Nginx (`client_max_body_size 20m`). |
| After save, the form silently reverts | The PUT succeeded but the response is not re-hydrated into `formData` | Check the save handler — it should re-assign `this.formData = response.data`. If the response is missing fields, the backend treated the request as a partial update (the current implementation is **replace**, not merge). |
| Tab 1 shows but tabs 2–8 are blank | The `DsTabs` `v-model` is set to a number, but the tabs are referenced as `tab.value` (a number) — mismatch | Verify the watcher at `UserProfileComponent.vue:520` is firing; the bug typically presents as the active tab not visually updating. |

## Related

- [Auth Flow](/docs/frontend/auth-flow/) — the JWT used to call
  `/api/me/*`.
- [Settings Page](/docs/frontend/settings-page/) — the GDPR
  reset/delete flows are surfaced there.
- [Backend API Contracts → `/api/me`](/docs/backend/api-contracts-backend/#me-profile-and-gdpr) —
  the full request/response shapes.