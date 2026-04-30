# Redis AOF Repair — 2026-04-30

**Date:** 2026-04-30
**Environment:** dev / staging — local Docker only. **Production Redis was not touched.**
**Severity:** 🟡 Low — cache / ephemeral store only; no system-of-record data was at risk.
**Incident type:** Redis AOF incremental file corruption.
**Repair tool:** `redis-check-aof --fix`.

---

## 1. Incident summary

The `amina-redis` container (the backend's session / cache / rate-limit
Redis, bind-mounted at `haystack-stack/data/redis/`) entered a
restart-loop with the following error in its startup log:

```
Bad file format reading the append only file appendonly.aof.1.incr.aof:
make a backup of your AOF file, then use ./redis-check-aof --fix <filename.manifest>
```

The base RDB (`appendonly.aof.1.base.rdb`) reported `keys loaded: 0`,
so the entire post-bootstrap state lived in the corrupt incremental
AOF. The container would never finish startup until the AOF was
repaired or removed.

## 2. Repair performed

1. `docker stop amina-redis` (cleanly stopped the restart-looping container).
2. **Backed up** the corrupt incremental AOF file in-place — preserved as
   `haystack-stack/data/redis/appendonlydir/appendonly.aof.1.incr.aof.bak`.
3. Ran `redis-check-aof --fix` against the manifest in a one-shot
   `redis:7.4.8` container bound to the same `/data` volume.
4. `docker start amina-redis`.

The backup file is intentionally still on disk so the corrupt tail
remains forensically available.

## 3. Recovery result

| Probe | Expected | Observed |
|---|---|---|
| `docker restart amina-redis` | clean cycle | succeeded first try |
| `redis-cli PING` | `PONG` | `PONG` |
| `redis-cli DBSIZE` | non-zero | **347 keys** |
| `docker inspect ... .State.Health.Status` | `healthy` | `healthy` |
| `docker inspect ... .RestartCount` | `0` | `0` |
| `GET /api/v1/caregiver/privacy/version` | `HTTP 200`, `required_flag:false` | ✅ `HTTP 200`, `required_flag:false` |
| `GET /docs` | `HTTP 200` | ✅ `HTTP 200` |
| Frontend at `http://localhost:5174` | reachable | ✅ reachable |
| `_phase7_rollback_proof.py` | 20 / 20 PASS | ✅ **20 / 20 PASS** |

## 4. Data-loss accounting

| Field | Value |
|---|---|
| Repaired file | `appendonly.aof.1.incr.aof` |
| Size before | **30,623,960 bytes** |
| `ok_up_to` (last clean offset) | **5,632,599 bytes** (line 48,976) |
| Truncated | **24,991,361 bytes** — approximately **81 %** of the AOF tail |
| Backup preserved | `appendonly.aof.1.incr.aof.bak` (full 30 MB original) |

The truncated tail represents Redis writes between the last
clean operation (offset 5,632,599) and the corruption point.
**These writes are not recoverable** through `redis-check-aof`. If
specific keys must be reconstructed, the `.bak` file can be inspected
manually with a different tool — the truncated bytes are still
on disk.

## 5. Impact

- Redis in this stack is a **cache / ephemeral session / rate-limit
  store**. It is not a system of record.
- **ArcadeDB was not affected** — caregiver consent records, vertices,
  and edges are persisted there and untouched.
- **Phase 7 caregiver privacy enforcement work was not materially
  damaged.** The 8 gated routes, the 403 contract, the rollback
  command, and the warn-only middleware all continue to function;
  the rollback proof was re-run after the repair and passed 20 / 20.

## 6. Worst-case lost Redis data (best-effort enumeration)

Inferred from the key-prefix distribution observed in the recovered
347 keys (the lost ~25 MB tail almost certainly contained more of the
same prefixes):

- Cached translation pairs — `translate:en:ma:*`
- Care / supply ledger snapshots — `care:supply:*`, `care:dualpath:*`
- Aggregated stats — `stats:*`
- Conversation chunks — `dchat:*`
- Bantaba / scout community state — `community:*`, `scout_application:*`
- Vitals safety-consensus cache — `vitals:safety_consensus:*`
- Rate-limit counters — rebuild automatically on first use

None of the above are durable systems of record — they are all
either cache lines, telemetry counters, or working state that a
new caregiver session will repopulate.

## 7. Operational caveats

- **Keep `appendonly.aof.1.incr.aof.bak` for approximately 7 days.**
  If nothing surfaces as missing during that window, the backup can
  be deleted. If something does surface, the byte-level copy is
  preserved for forensics.
- **Treat any Redis-backed wizard / session data from before the
  repair as unreliable.** A caregiver mid-flight through the v2
  registration wizard at the moment of corruption may need to
  restart the wizard. The ArcadeDB-anchored `CaregiverVertex` /
  `CaregiverConsentRecord` rows are not affected; only the
  Redis-side `cg_registration:<rid>` working state may be missing.
- **Expect cold-cache behavior until Redis repopulates.** First-hit
  latency on translation, care-supply-ledger, and stats endpoints
  will be elevated for a short window; this is normal post-repair
  behavior, not a bug.

## 8. Phase 7 production note

This incident **does not change the Phase 7 production gate.**

- The repair was on the **dev / staging** Redis only.
- Production Redis was not touched.
- The Phase 7 production enforcement gate remains
  [docs/compliance/CAREGIVER_PRIVACY_ENFORCEMENT_READINESS.md §5](CAREGIVER_PRIVACY_ENFORCEMENT_READINESS.md):
  the **production stale-population audit** (`caregiver_privacy_stale_audit.py`)
  must return GREEN, or YELLOW with the planned 14-day soak already
  running, before `AMINA_CAREGIVER_PRIVACY_REQUIRED=true` is flipped
  in production.
- Do **not** flip production `AMINA_CAREGIVER_PRIVACY_REQUIRED=true`
  on the basis of this dev-side recovery. The dev-side sample stale
  rate (82.35 % RED) is synthetic and is not authoritative.
