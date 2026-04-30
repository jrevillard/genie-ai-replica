"""Phase 5.5 setup — mint synthetic JWTs + 1 consent record for header matrix."""
import jwt
from src.config import settings
from src.services import caregiver_privacy_consent as cpc

secret = settings.JWT_SECRET
print(f"jwt_secret_loaded={bool(secret)}")

CG_STALE   = "cg-phase55-stale"
CG_CURRENT = "cg-phase55-current"

tok_stale   = jwt.encode({"sub": CG_STALE,   "role": "caregiver"}, secret, algorithm="HS256")
tok_current = jwt.encode({"sub": CG_CURRENT, "role": "caregiver"}, secret, algorithm="HS256")
tok_patient = jwt.encode({"sub": "p-phase55", "role": "patient"},   secret, algorithm="HS256")
tok_admin   = jwt.encode({"sub": "admin",     "role": "admin"},     secret, algorithm="HS256")

payload = {
    "notice_version": cpc.CAREGIVER_PRIVACY_NOTICE_VERSION,
    "consent_checkboxes": {cb_id: True for cb_id in cpc.EXPECTED_CHECKBOX_IDS},
    "digital_signature": "Phase 5.5 Synthetic",
    "method": "test",
    "scroll_completed": True,
}
row = cpc.record_consent(caregiver_id=CG_CURRENT, role="vhw", payload=payload)
print(f"synthetic_record_status={row.get('_status')}")
print(f"synthetic_record_id={row.get('record_id')}")

with open("/tmp/p55_tok_stale",   "w") as f: f.write(tok_stale)
with open("/tmp/p55_tok_current", "w") as f: f.write(tok_current)
with open("/tmp/p55_tok_patient", "w") as f: f.write(tok_patient)
with open("/tmp/p55_tok_admin",   "w") as f: f.write(tok_admin)
print("tokens_written=true")
