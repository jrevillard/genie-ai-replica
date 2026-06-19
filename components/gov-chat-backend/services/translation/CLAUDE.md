# Translation Cache — Agent Guide

> `AGENTS.md` in this directory is a symlink to this file. Both names resolve
> here so any agent (Claude Code, Codex, etc.) finds the same rules.

This directory implements markdown translation for the chat streaming path
(issue #829) and the post-stream batch path. Translations are cached in Redis
**permanently** (`SET` with no TTL). Getting cache invalidation wrong silently
serves stale/buggy translations — this file exists so that doesn't happen
again.

## Cache key — four invalidation dimensions

`translation:<md5(content)>:<targetLang>:<modelId>:<logicVersion>`
(see `translation-cache-key.js`)

| Dimension | What invalidates | Action needed |
|-----------|------------------|---------------|
| `md5(content)` | Source text changes (different chatqna output, prompt change that changes the EN answer) | **Automatic** — new hash → new key |
| `targetLang` | Different UI language | **Automatic** |
| `modelId` | Switching `VLLM_TRANSLATION_MODEL_ID` (GPU) or the CPU NLLB model | **Automatic** — model id is in the key |
| `logicVersion` (`TRANSLATION_LOGIC_VERSION`) | Translation **logic** change in source code | **Manual — bump the constant** |

## When to bump `TRANSLATION_LOGIC_VERSION`

Bump it (in `translation-cache-key.js`) whenever the translation OUTPUT for the
same `(content, lang, model)` could change. Examples:

- Changes to `text-edges.js` (`splitEdges` — lead/core/trail handling).
- Changes to `markdown-normalize.js` (`normalizeInlineSpacing` — run-in bold fix, script gate).
- Changes to the LLM prompt (`gpu-translate-backend.js` `formatRequest`, or `CHATQNA_*` prompt env vars that affect translation).
- Changes to how text nodes are extracted/replaced in `translation-service.js`.
- Changes to the `stream-boundary.js` separator logic that affects what units reach the translator.

Source-content changes do **not** need a bump (md5 handles those). Only
logic/algorithm changes do.

## The stale-cache gotcha (why this exists)

The cache is permanent. If you fix a translation bug and redeploy, **cached
entries from before the fix are still served** — the fix only applies to cache
MISSES. This produced an confusing symptom during #829: some sections rendered
correctly (cache miss → fresh fix) while others stayed broken (cache hit → stale
pre-fix output), making it look like the fix was intermittently broken.

**Prevention:** bump `TRANSLATION_LOGIC_VERSION` on any logic change. That makes
every key change, forcing fresh translations on the next request — no manual
flush needed.

## Manual cache flush (emergency / one-off)

If stale entries are already cached and you cannot bump the version (or want a
clean slate), flush from the backend container (correct Redis auth via env;
`redis-cli` shell-escapes the password poorly):

```bash
C=$(docker ps --format '{{.Names}}' | grep genieai-el-salvador_backend | head -1)
docker exec "$C" node -e "const Redis=require('ioredis');const r=new Redis({host:process.env.TRANSLATION_CACHE_HOST,port:process.env.TRANSLATION_CACHE_PORT,password:process.env.TRANSLATION_CACHE_PASSWORD});(async()=>{const k=await r.keys('translation:*');console.log('deleting',k.length);if(k.length)await r.del(k);r.disconnect();})().catch(e=>{console.error(e.message);process.exit(1);});"
```

This deletes only `translation:*` keys (not other Redis data). `TRANSLATION_CACHE=on`
enables the cache; the key prefix is always `translation:`.

## Files in this directory

| File | Purpose |
|------|---------|
| `translation-service.js` | Orchestrates: parse → normalize → splitEdges → translate cores → reapply → stringify. Owns the cache. |
| `text-edges.js` | `splitEdges` (lead/core/trail) + `startsWithWordSpacedScript` (CJK/Thai script gate). |
| `markdown-normalize.js` | `normalizeInlineSpacing` — inject space for run-in `**bold**Text`. |
| `translation-cache-key.js` | `translationCacheKey` + `TRANSLATION_LOGIC_VERSION`. |
| `stream-boundary.js` | Streaming unit boundary detection (used by `routes/query-routes.js`). |
| `gpu-translate-backend.js` / `cpu-translate-backend.js` | Translation backends (vLLM / NLLB). |
| `language-maps/` | Per-model language code maps. |
