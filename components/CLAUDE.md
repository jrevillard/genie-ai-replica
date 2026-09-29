# Components — Cross-Component Conventions

> Audience: anyone working under `components/` (backend, document-repository,
> frontend, shared/lib). For overall repo conventions, see the root
> `CLAUDE.md` (and the `AGENTS.md` symlink).

## Cross-component imports (`shared/lib` ↔ `shared-lib`)

`components/shared/lib/` is the **single source of truth** for helpers reused
across components. Every component that needs them follows the same import
contract so that **Jest unit tests** and the **Docker runtime image** both
resolve the same files.

### The three paths must agree

The same helpers exist under three names depending on context:

| Context | Path | Resolves to |
|---|---|---|
| Source tree (Jest) | `components/shared/lib/X.js` | real filesystem |
| Docker runtime image | `/app/shared-lib/X.js` | Dockerfile `COPY shared/lib ./shared-lib` (drops `/lib/` segment) |
| Within a component (Jest) | `<component>/shared-lib/X.js` | **does not exist** — resolved via `jest.moduleNameMapper` |

`./shared/lib/X.js` (with `/lib/`) and `./shared-lib/X.js` (without `/lib/`)
are **different** strings and different **different** files. Mixing them up
is how a broken runtime path slips past a green test suite.

### Required pattern

**For shared helpers, prefer the barrel import:**

```js
// components/gov-chat-backend/tracing.js
const { parsePositiveInt, logger } = require('../shared-lib');
//           ^ barrel — barrel re-exports what tracing needs
```

Note the `shared-lib` spelling, without the `/lib/` segment. Jest's
`moduleNameMapper` makes both resolve, but only `shared-lib` exists in
the image — see the ESLint guard below.

The barrel at `components/shared/lib/index.js` is the **single source of
truth** for which helpers components consume. Adding a new helper to a
component requires also adding it to the barrel's exports (otherwise the
component gets MODULE_NOT_FOUND at runtime).

### When deep imports are unavoidable

Only when a helper is too heavyweight to barrel-import (e.g. it pulls heavy
transitive deps at module-load time). In that case:

```js
// components/gov-chat-backend/tracing.js
const { parsePositiveInt } = require('./shared-lib/validation-utils');
//                 ^ Docker-resolved path
```

must be paired with a Jest `moduleNameMapper` entry in the component's
`package.json`:

```json
"jest": {
{
  "moduleNameMapper": {
    "^./shared-lib/validation-utils$": "<rootDir>/../shared/lib/validation-utils.js",
    "^./shared-lib$": "<rootDir>/../shared/lib/index.js"
  }
}
```

**Without the moduleNameMapper, Jest resolves the deep import to the real
filesystem (`components/gov-chat-backend/shared-lib/` — does not exist) and
fails.** Without the matching `Dockerfile` COPY rename, the runtime
container fails with `MODULE_NOT_FOUND`. Both must be in place together.

### ESLint guard

`local/no-runtime-unresolvable-shared-path`
(`components/shared/eslint-rules/`) fails on a `require('…/shared/lib…')`
in shipped code. That spelling resolves under Jest — `moduleNameMapper`
rewrites `shared-lib/…` back to `../shared/lib/…` — and then vanishes in
the image, where the Dockerfile's `COPY shared/lib ./shared-lib` has
dropped the `/lib/` segment. The asymmetry is the hazard: a green unit
suite proves the source tree, nothing proves the image.

The rule is scoped to the path, not the depth — `shared-lib/deep/thing`
resolves fine at runtime and is allowed. Test files are exempt, because
under Jest the source tree is what resolves, so
`require('../../shared/lib/…')` in a spec is correct and deliberate.

It is a local rule rather than `no-restricted-imports` because that core
rule reads ESM `import` declarations only — the repo is CommonJS
throughout, so every form of it stays silent on `require()`. See Pitfall
3.

### Process: when changing the import path contract

Any change to:
- A component's `Dockerfile` `COPY shared/lib ...` line, or
- `components/shared/lib/index.js` (the barrel), or
- A consumer's `require(...)` path

**must** be paired with:

1. Re-run the affected component's Jest test suite (`npm test` from that
   component dir).
2. Rebuild the affected image (`docker compose build <service>`).
3. If the change touched `Dockerfile` COPY paths, verify the container
   actually starts (`docker compose up -d <service>` then
   `docker ps --filter name=...`).

Unit tests alone do not catch Docker COPY-rename mismatches — they resolve
to source tree paths. CI's `lint` + `test` + `scan` stages run on a
different image than runtime, so they also do not catch this.

## Known pitfalls (found in live verification 2026-09-14)

### Pitfall 1: tracing.js deep imports (PRD-shipped bug)

`components/gov-chat-backend/tracing.js:59,62` and
`components/document-repository/src/tracing.js:45,48` historically used
`require('../shared/lib/boolean-env')` and similar. **These crash at runtime
in Docker** (Docker drops `/lib/` from the path) but **pass in Jest**
(Jest sees the source tree). Backend + document-repository crash-loop on
startup until the path is changed to `./shared-lib/X` (Docker-resolved) AND
the component's `jest.moduleNameMapper` is updated.

The umbrella branch `feat/admin-logs-victorialogs/prd` shipped this bug
despite 45/45 stories marked done — live runtime validation was skipped.

### Pitfall 2: `components/shared/lib/index.js` missing re-exports

Adding a new helper to `shared/lib/` (e.g. `boolean-env.js`) does **not**
automatically make it consumable via the barrel. The barrel
(`shared/lib/index.js`) must explicitly re-export it:

```js
const validationUtils = require('./validation-utils');
module.exports.parsePositiveInt = validationUtils.parsePositiveInt;
```

Otherwise consumers using the barrel get `undefined.parsePositiveInt`
and a TypeError at first use.

### Pitfall 3: `no-restricted-imports` cannot guard CommonJS

The old guard was `no-restricted-imports` with
`patterns.group: ['**/shared/lib/**']`. The earlier diagnosis blamed the
glob; the real cause is the rule. `no-restricted-imports` inspects ESM
`import` declarations — this repo is CommonJS throughout, so **no**
configuration of it fires on a `require()`. Verified on ESLint 10: the
same glob that flags `import x from '../shared/lib/logger.js'` is silent
on `require('../shared/lib/logger')`, and so are `paths:` and a literal
`'shared/lib/'` pattern. ESLint 10 ships no `no-restricted-require`.

While inert it still read as protection, which is the worse failure: a
developer could see the rule in `eslint-rules-base.js` and conclude the
deep-import class of bug was covered. It is now a local rule that
inspects `CallExpression[callee.name='require']` directly.

## Adding a new helper to `shared/lib/`

1. Add the file under `components/shared/lib/<helper>.js`.
2. **Re-export it from `components/shared/lib/index.js`** (Pitfall 2 above).
3. From the consumer component, import via the barrel:
   `require('../shared-lib')` — preferred. The `/lib/` spelling is what
   the ESLint guard above rejects.
4. Re-run the consumer's Jest tests.
6. Rebuild the consumer image (`docker compose build <service>`).
7. Restart the consumer container (`docker compose up -d <service>`).
8. Verify the container stays up (no `MODULE_NOT_FOUND` crash loop).