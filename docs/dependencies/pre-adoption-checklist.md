# Pre-adoption dependency checklist

Every dependency a story introduces is cleared through this checklist BEFORE
it is accepted. It exists because a licence question discovered after a
deployment is a public-sector procurement problem, not a code problem.

The checklist is reusable: a later story that introduces a dependency runs the
same four gates and records its evidence in the same shape. The procedure
below is the whole contract; the tooling is `scripts/dependencies/verify-dependency-licenses.py`.

## When it applies

A story introduces a dependency when it adds a package to a requirements file,
a lock file, a package manifest, or an image. Bumping a version of a package
already in the tree re-runs the licence gate (the licence can change between
versions) but not the defaults audit unless the new version changes the
package's behaviour.

## The four gates

1. **Exact-version licence verification (V07a).** Every pinned
   `name==version` must have a licence identified FOR THAT EXACT VERSION,
   with the source of the identification recorded. An unidentified licence
   (`NOASSERTION`, `UNKNOWN`, empty) counts as UNVERIFIED and BLOCKS. The
   two accepted sources, in order of preference:
   - the SPDX expression the publisher declares for that version;
   - the licence file read out of the artifact of that exact version (the
     sha256 of that file is the record).
   A coarse classifier ("BSD License", which does not say which variant) is
   not an identification: the package stays unverified until somebody reads
   the artifact.

2. **Defaults audit (NFR-2).** For every package: does it send telemetry by
   default, and does it export data to a cloud service by default? A package
   that does either by default cannot be adopted silently - the answer names
   the knob that turns it off, or the story states why the default is
   acceptable in a sovereign deployment.

3. **Release channel.** The release channel of the exact version is recorded.
   Anything that is not a stable release (a `0.x` line, a beta, a
   pre-release) carries an explicit operational-risk acceptance: what the
   risk is, why it is accepted, and what would make it revisited.

4. **Compatibility with the licence the product ships under.** The
   dependencies this product ships must be compatible with the licence the
   product itself ships under. A copyleft dependency in a product that
   claims a permissive licence is a redistribution question - it needs a
   decision, not a note.

## The tooling

```bash
# 1. Resolve the licences of every exact pin and write the evidence file.
python3 scripts/dependencies/verify-dependency-licenses.py \
    --fetch <component>/requirements.txt \
    --out docs/dependencies/<component>-dependency-evidence.json

# 2. Fill in the human verdicts the fetch leaves empty: "defaults"
#    (telemetry + cloud export), "status" (the release channel) and
#    "risk_acceptance" (for anything that is not a stable release).

# 3. Check the evidence against the pin set - offline, no network.
python3 scripts/dependencies/verify-dependency-licenses.py \
    --verify <component>/requirements.txt \
    docs/dependencies/<component>-dependency-evidence.json
```

The verify step fails when a pin has no evidence row, when the evidence
audits a different version than the one pinned, when the licence is
unverified, when the licence source is missing, when a defaults verdict is
missing, when a non-stable release carries no risk acceptance, or when an
evidence row survives a package the tree no longer pins.

## How a story uses it

1. Pin the tree (fully, so the audit covers what ships).
2. `--fetch` the evidence.
3. Fill in the verdicts.
4. `--verify` it.
5. Wire the check into the repository gate, so a later bump cannot skip it:
   the config-validator suite asserts the same invariants over the same
   evidence file (see `tests/config-validator/__tests__/agent-service.test.js`
   for the shape of that gate).
6. Disclose the dependencies in `THIRD_PARTY.md`.

A story that introduces a dependency and skips this checklist has not met the
acceptance criteria of the epic it belongs to.
