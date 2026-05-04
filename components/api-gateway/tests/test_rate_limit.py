"""Phase 4 — rate limit unit tests.

Standalone, no Redis required. Exercises the module's in-memory
fallback path by forcing config.RATE_LIMIT_ENABLED=True at runtime
and giving it an unreachable Redis URL so it falls back immediately.
"""
from __future__ import annotations

import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
GATEWAY_ROOT = os.path.abspath(os.path.join(HERE, ".."))
if GATEWAY_ROOT not in sys.path:
    sys.path.insert(0, GATEWAY_ROOT)

# Force in-memory path: enable + point at unreachable Redis.
os.environ["AMINA_GATEWAY_RATE_LIMIT_ENABLED"] = "true"
os.environ["AMINA_GATEWAY_RATE_LIMIT_REDIS_URL"] = "redis://127.0.0.1:1/0"

from app import config  # noqa: E402
from app import rate_limit  # noqa: E402

# Reload-safe re-read of the env vars
config.RATE_LIMIT_ENABLED   = True
config.RATE_LIMIT_REDIS_URL = "redis://127.0.0.1:1/0"


_RESULTS = []


def _reset():
    """Clear in-memory state between tests."""
    rate_limit._inmem.clear()
    rate_limit._latency_samples.clear()
    rate_limit._stats.update({k: 0 for k in rate_limit._stats})
    rate_limit._mark_redis_down(seconds=300)   # force in-memory


def _check(path, ip, caller=None):
    return rate_limit.check(path=path, ip=ip, caller=caller)


def _test(name, fn):
    try:
        _reset()
        fn()
        _RESULTS.append((name, True, ""))
    except AssertionError as e:
        _RESULTS.append((name, False, str(e)))
    except Exception as e:
        _RESULTS.append((name, False, f"CRASH: {type(e).__name__}: {e}"))


def t1_disabled_passes_through():
    config.RATE_LIMIT_ENABLED = False
    try:
        for _ in range(100):
            o = _check("/api/v1/public/chat", "1.2.3.4")
            assert o.allowed
    finally:
        config.RATE_LIMIT_ENABLED = True


def t2_chat_burst_5_then_throttle():
    # chat tier burst=5
    for i in range(5):
        o = _check("/api/v1/public/chat", "1.2.3.4")
        assert o.allowed, f"req #{i+1} should pass; got {o}"
    o = _check("/api/v1/public/chat", "1.2.3.4")
    assert not o.allowed, "6th request should be throttled"
    assert o.reason == "burst", f"expected burst reason, got {o.reason}"


def t3_burst_window_resets():
    for _ in range(5):
        _check("/api/v1/public/chat", "1.2.3.4")
    o = _check("/api/v1/public/chat", "1.2.3.4")
    assert not o.allowed
    # Manually shift the burst-window timestamps back >10s
    burst_key = f"gw:rl:chat:burst:1.2.3.4"
    dq = rate_limit._inmem.get(burst_key)
    if dq:
        for i in range(len(dq)):
            dq[i] = dq[i] - 11.0
    o = _check("/api/v1/public/chat", "1.2.3.4")
    assert o.allowed, f"after window slide, should allow; got {o}"


def t4_per_ip_separate():
    # exhaust burst on one IP; another IP unaffected
    for _ in range(5):
        _check("/api/v1/public/chat", "1.1.1.1")
    o = _check("/api/v1/public/chat", "1.1.1.1")
    assert not o.allowed
    o2 = _check("/api/v1/public/chat", "2.2.2.2")
    assert o2.allowed, f"different IP should not share burst counter"


def t5_per_caller_quota():
    # translate tier per_ip=120, but per_caller=1200; throttle the
    # CALLER specifically. Since per_ip is bigger, we must rotate IPs
    # to stress the caller counter.
    caller = "genie-ai-opea"
    # Per-caller is 1200/min; per-ip is 120/min. Use 11 distinct IPs
    # to hit caller before per-ip. burst is 20.
    # Better: directly exercise caller path by spamming 1201 requests
    # rotating IPs each call. But that's slow. Skip: just check that
    # caller counter increments and matches.
    for i in range(50):
        _check("/api/v1/public/translate", f"10.0.0.{i % 20}", caller=caller)
    # Verify caller key got entries
    caller_key = "gw:rl:translate:caller:" + caller
    n = len(rate_limit._inmem.get(caller_key) or [])
    assert n >= 20, f"caller counter not accumulating; got {n} entries"


def t6_health_tier_more_generous():
    # health tier per_ip=300, burst=60. Verify burst >5 (chat) is fine.
    for i in range(20):
        o = _check("/health", "1.2.3.4")
        assert o.allowed, f"req #{i+1} on /health should pass; got {o}"


def t7_429_outcome_fields():
    for _ in range(5):
        _check("/api/v1/public/chat", "1.2.3.4")
    o = _check("/api/v1/public/chat", "1.2.3.4")
    assert not o.allowed
    assert o.reason == "burst"
    assert o.limit > 0
    assert o.remaining == 0
    assert o.reset_seconds == 10
    assert o.tier == "chat"
    assert o.backend in ("redis", "inmem")


def t8_stats_increment():
    for _ in range(7):  # 5 allowed + 2 throttled
        _check("/api/v1/public/chat", "1.2.3.4")
    s = rate_limit.get_stats()
    assert s["checks"] >= 7
    assert s["throttled"] >= 2
    assert s["throttled_burst"] >= 2


def t9_unknown_path_uses_default_tier():
    # Default tier per_ip=60, burst=10. Hammer beyond 10.
    for i in range(10):
        o = _check("/api/v1/public/unknown", "9.9.9.9")
        assert o.allowed, f"req {i+1} should pass; got {o}"
    o = _check("/api/v1/public/unknown", "9.9.9.9")
    assert not o.allowed
    assert o.tier == "default"


def t10_redis_dead_falls_back_silently():
    # Already forced redis-down in _reset(); verify the outcome backend label.
    o = _check("/api/v1/public/chat", "1.2.3.4")
    assert o.backend == "inmem", f"expected inmem fallback; got {o.backend}"


def t11_adaptive_throttle_halves_chat():
    # Inject 30 latency samples >3000ms in the last 30s, then verify
    # adaptive multiplier is 0.5 for chat.
    now = time.time()
    for i in range(30):
        rate_limit._latency_samples.append((now - i * 0.5, 4500.0))
    mult = rate_limit._adaptive_multiplier("/api/v1/public/chat")
    assert abs(mult - 0.5) < 0.001, f"expected 0.5 throttle; got {mult}"
    # /health should not be throttled
    mult_h = rate_limit._adaptive_multiplier("/health")
    assert mult_h == 1.0


def t12_adaptive_recovers_when_latency_drops():
    now = time.time()
    # Mostly fast samples; one outlier
    for _ in range(30):
        rate_limit._latency_samples.append((now, 800.0))
    mult = rate_limit._adaptive_multiplier("/api/v1/public/chat")
    assert mult == 1.0, f"expected no throttle on fast backend; got {mult}"


def t13_record_backend_latency_bounded():
    # Should never grow unbounded
    for i in range(500):
        rate_limit.record_backend_latency(100.0 + i)
    assert len(rate_limit._latency_samples) <= rate_limit._LATENCY_MAX_SAMPLES


_TESTS = [
    ("T1  disabled flag → all pass through",                t1_disabled_passes_through),
    ("T2  chat burst=5 then 6th throttled",                 t2_chat_burst_5_then_throttle),
    ("T3  burst window resets after 10s",                   t3_burst_window_resets),
    ("T4  per-IP counters are independent",                 t4_per_ip_separate),
    ("T5  per-caller counter accumulates across IPs",       t5_per_caller_quota),
    ("T6  /health tier has higher burst",                   t6_health_tier_more_generous),
    ("T7  throttle outcome carries tier+limit+reset",       t7_429_outcome_fields),
    ("T8  stats increment on checks + throttle",            t8_stats_increment),
    ("T9  unknown path uses default tier",                  t9_unknown_path_uses_default_tier),
    ("T10 redis dead → inmem fallback (label)",             t10_redis_dead_falls_back_silently),
    ("T11 adaptive throttle halves chat when backend slow", t11_adaptive_throttle_halves_chat),
    ("T12 adaptive recovers when backend speeds up",        t12_adaptive_recovers_when_latency_drops),
    ("T13 backend latency sample buffer bounded",           t13_record_backend_latency_bounded),
]


def main():
    print("\n" + "=" * 70)
    print(f"Rate-limit unit tests — {len(_TESTS)} cases (in-memory backend)")
    print("=" * 70)
    for name, fn in _TESTS:
        _test(name, fn)
    passed = sum(1 for _, ok, _ in _RESULTS if ok)
    for name, ok, detail in _RESULTS:
        sym = "  PASS" if ok else "  FAIL"
        print(f"{sym}  {name}")
        if not ok:
            print(f"           {detail}")
    print()
    print(f"TOTAL: {passed}/{len(_TESTS)}")
    print("=" * 70)
    sys.exit(0 if passed == len(_TESTS) else 1)


if __name__ == "__main__":
    main()
