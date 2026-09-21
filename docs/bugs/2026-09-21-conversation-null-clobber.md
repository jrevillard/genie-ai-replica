# Bug: partial PATCH erases conversation/folder fields with `null`

**Date:** 2026-09-21
**Severity:** High — silent, irreversible data corruption
**Affects:** `components/gov-chat-backend` (all clients); triggered by the Flutter
mobile app (`mobile/genie_ai_mobile`)
**Status:** Fixed in `fix/conversation-null-clobber`

## Symptom

- Tapping the star (or archive) on a conversation in the mobile app made the
  conversation **disappear** from the list.
- Conversations saved in the mobile app did **not** appear in the Vue 3 web app.
- Recoverable only from the database — the record was still present, just
  invisible.

## Root cause — three layers

### Layer 1 — mobile client emits `null` for unset fields (trigger)

`mobile/genie_ai_mobile/openapi_client/lib/model/api_chat_conversations_conversation_id_patch_request.dart`
is an OpenAPI-generated model whose `toJson()` always writes **every** optional
field, using `null` for the ones the caller never set:

```dart
if (this.isArchived != null) {
  json[r'isArchived'] = this.isArchived;
} else {
  json[r'isArchived'] = null;      // emitted even when the caller set nothing
}
```

A star toggle therefore sent:

```json
{ "isStarred": true, "isArchived": null, "title": null, "tags": [], "categoryId": null }
```

### Layer 2 — backend treats `null` as a value to write (the actual defect)

`components/gov-chat-backend/services/chat-history-service.js`, `updateConversation()`
and `updateFolder()`:

```js
for (const field of allowedFields) {
  if (updateData[field] !== undefined) {   // null passes this guard
    filteredData[field] = updateData[field];   // overwrites good data with null
  }
}
```

This is what turns a harmless client quirk into corruption, and it applies to
**any** client, not just mobile.

### Layer 3 — list queries exclude `null` (what makes it invisible)

`getUserConversations()` filters:

```aql
FILTER ${includeArchived} ? true : conversation.isArchived == false
```

In AQL, `null == false` evaluates to **false**, so a conversation whose
`isArchived` was nulled drops out of the user's own list — and out of the web
app's list, since both read the same query.

## Evidence (10.0.0.101, database `genie-ai`)

Corrupted documents carry `isArchived: null` **and** `title: null` — exactly the
fields a star-toggle PATCH would carry as null:

```
17899600189179445  title: null  isArchived: null   ← invisible
17900070347446532  title: null  isArchived: null   ← invisible
17900079728029246  title: "…"   isArchived: false  ← healthy
17815162484540241  title: "…"   isArchived: false  ← healthy
```

Server log timeline, same user (`users/10479590`):

```
16:11:18  PATCH /api/chat/conversations/17900070347446532  200
16:11:38  Found 1 conversations for user users/10479590
16:11:43  PATCH /api/chat/conversations/17899600189179445  200
16:13:05  Found 0 conversations for user users/10479590
```

## Why the web app was unaffected

The Vue client omits unset fields (axios drops `undefined`), so it never sends
`null` — which is why web-created conversations stayed healthy.

## Fix

Reject `null` in both guards, in `updateConversation()` and `updateFolder()`:

```js
if (updateData[field] !== undefined && updateData[field] !== null) {
```

A partial update can no longer erase a field the caller did not intend to set.
Both guards are fixed because folders have the identical defect and the folder
list queries use the same `isArchived == false` filter.

## Data recovery (not automatic)

The fix prevents new corruption but does **not** repair documents already
nulled. Those need a one-off backfill:

```aql
FOR c IN conversations
  FILTER c.isArchived == null
  UPDATE c WITH { isArchived: false } IN conversations
```

`title` values lost this way are **not** recoverable from the document.

## Follow-up (not in this MR)

The generated Dart model should omit null fields rather than emit them. It is an
auto-generated file (`DO NOT MODIFY`), so the fix belongs in the OpenAPI spec /
generator, or the request bodies should be assembled explicitly at the call
sites in `chatbot_component.dart` and `chat_folders_panel.dart`. The backend fix
makes this non-urgent — no client can corrupt data this way any more.
