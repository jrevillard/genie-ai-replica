"""
Classifier boundary test. Lives inside the container file system so
docker exec picks it up, and keeps complex f-strings out of the shell layer.
"""
from __future__ import annotations
import sys
from src.services import model_health

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

for m in ['amina','base','gemini','groq','mistral']:
    model_health.reset(m)

tests = [
    ('HTTP 401',              401, 'TOKEN'),
    ('HTTP 403',              403, 'TOKEN'),
    ('HTTP 402',              402, 'BILLING'),
    ('HTTP 400',              400, 'BAD'),
    ('HTTP 500',              500, 'DOWN'),
    ('HTTP 502',              502, 'DOWN'),
    ('HTTP 429',              429, 'DOWN'),
    ('invalid_api_key msg',   'invalid_api_key — your key has been revoked', 'TOKEN'),
    ('ETIMEDOUT msg',         'read timed out waiting for upstream',          'DOWN'),
    ('context_length msg',    'context_length_exceeded',                      'BAD'),
    ('billing msg',           'payment required: insufficient quota',         'BILLING'),
    ('OK signal',             200,                                            'OK'),
]

print(f"{'signal':<40}  {'expect':<8}  got")
print("-" * 80)
failed = 0
for name, sig, expect in tests:
    got = model_health.classify_error(sig)
    mark = "PASS" if got['kind'] == expect else "FAIL"
    if got['kind'] != expect:
        failed += 1
    print(f"{name:<40}  {expect:<8}  {got['kind']:<8} ({got['reason']}) {mark}")

print()
print("--- persistence check: only DOWN should trip the breaker ---")
for kind in ['TOKEN', 'BILLING', 'BAD', 'DOWN']:
    model_health.reset('amina')
    model_health.report_failure('amina', f'test_{kind.lower()}', kind)
    snap = model_health.snapshot('amina')
    tripped = not snap['live']
    expected = (kind == 'DOWN')
    mark = "PASS" if tripped == expected else "FAIL"
    if tripped != expected:
        failed += 1
    print(f"kind={kind:<8}  tripped_breaker={tripped}  expected={expected}  {mark}")

print()
print(f"FAILED: {failed}") if failed else print("ALL PASS")
sys.exit(1 if failed else 0)
