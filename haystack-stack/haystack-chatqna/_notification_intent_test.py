"""
Sanity test -- NotificationIntentDetector
Run:  python _notification_intent_test.py
"""
import sys, os
sys.path.insert(0, ".")
os.environ["PYTHONUTF8"] = "1"

PASS = 0
FAIL = 0

def check(label, condition, detail=""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  [PASS] {label}")
    else:
        FAIL += 1
        print(f"  [FAIL] {label}  -- {detail}")


from src.nlp.notification_intent import NotificationIntentDetector, get_detector

d = NotificationIntentDetector()


# ============================================================
# 1. QUICK REJECTS
# ============================================================
print("\n=== 1. Quick rejects ===")

r = d.should_suggest(
    user_messages=["hi", "ok"],
    agent_response="Hello",
    tools_used=[],
    followup=None,
    latest_message="ok",
)
check("Too few messages -> skip", r["suggest"] is False)
check("Reason is too_few", "too_few" in r["reason"])

r2 = d.should_suggest(
    user_messages=["a" * 20] * 5,
    agent_response="Here is your plan",
    tools_used=[],
    followup=None,
    latest_message="thanks",
    already_asked=True,
)
check("Already asked -> skip", r2["suggest"] is False)

r3 = d.should_suggest(
    user_messages=["a" * 20] * 5,
    agent_response="Call 199 NOW",
    tools_used=[],
    followup=None,
    latest_message="help",
    triage_level="EMERGENCY",
)
check("Emergency -> skip", r3["suggest"] is False)


# ============================================================
# 2. EXPLICIT INTENT
# ============================================================
print("\n=== 2. Explicit intent ===")

r = d.should_suggest(
    user_messages=["I have diabetes", "what should I eat", "can you remind me about my diet"],
    agent_response="Here is a diet plan for diabetes",
    tools_used=[],
    followup=None,
    latest_message="can you remind me about my diet",
)
check("Remind me -> suggest", r["suggest"] is True)
check("Score high", r["score"] >= 0.9)

r2 = d.should_suggest(
    user_messages=["hi how are you", "send me notifications please", "thanks"],
    agent_response="I can help with notifications",
    tools_used=[],
    followup=None,
    latest_message="send me notifications please",
)
check("Send me notifications -> suggest", r2["suggest"] is True)

r3 = d.should_suggest(
    user_messages=["my blood pressure is high", "what medicine", "text me reminders"],
    agent_response="Take your medicine daily",
    tools_used=[],
    followup=None,
    latest_message="text me reminders",
)
check("Text me reminders -> suggest", r3["suggest"] is True)


# ============================================================
# 3. TOPIC ANALYSIS — chronic condition
# ============================================================
print("\n=== 3. Topic analysis ===")

r = d.should_suggest(
    user_messages=[
        "I have diabetes and hypertension",
        "What diet should I follow",
        "How often should I check my blood sugar",
        "Thank you",
    ],
    agent_response="For diabetes management, check your blood sugar levels daily. Take metformin as prescribed.",
    tools_used=["generate_care_plan"],
    followup={"date": "2026-05-02", "type": "checkup"},
    latest_message="Thank you",
)
check("Chronic + care plan + followup -> suggest", r["suggest"] is True)
check("Score >= 0.5", r["score"] >= 0.5)
check("Has chronic signal", "chronic_condition" in r["signals"])

r2 = d.should_suggest(
    user_messages=[
        "what is malaria",
        "how do you get it",
        "ok thanks",
    ],
    agent_response="Malaria is spread by mosquitoes.",
    tools_used=["search_knowledge"],
    followup=None,
    latest_message="ok thanks",
)
check("Info-only query -> skip", r2["suggest"] is False)
check("Quick query anti-signal", r2["score"] < 0.5, f"score={r2['score']}")


# ============================================================
# 4. TOOL SIGNALS
# ============================================================
print("\n=== 4. Tool signals ===")

r = d.should_suggest(
    user_messages=["plan my diet", "for diabetes", "include local foods"],
    agent_response="Here is your weekly diet plan for diabetes...",
    tools_used=["generate_care_plan", "get_diet_advice"],
    followup=None,
    latest_message="include local foods",
)
check("Diet + care plan tools -> suggest", r["suggest"] is True)
check("High signal tools detected", any("high_signal" in s for s in r["signals"]))

r2 = d.should_suggest(
    user_messages=["check my vitals", "record bp 130/85", "whats the trend"],
    agent_response="Your blood pressure has been stable",
    tools_used=["record_vitals", "vitals_trend"],
    followup=None,
    latest_message="whats the trend",
)
check("Vitals tools -> suggest", r2["suggest"] is True)


# ============================================================
# 5. ANTI-SIGNALS
# ============================================================
print("\n=== 5. Anti-signals ===")

r = d.should_suggest(
    user_messages=[
        "this doesnt work at all",
        "wrong information again",
        "this is useless",
    ],
    agent_response="I apologize for any confusion",
    tools_used=[],
    followup=None,
    latest_message="this is useless",
)
check("Frustrated user -> skip", r["suggest"] is False)
check("Frustration signal", "frustration_detected" in r["signals"])

r2 = d.should_suggest(
    user_messages=[
        "what is the dosage of paracetamol",
        "for a child",
        "ok thanks",
    ],
    agent_response="For children, paracetamol dosage is...",
    tools_used=[],
    followup=None,
    latest_message="ok thanks",
)
check("Quick Q&A -> skip", r2["suggest"] is False)


# ============================================================
# 6. GOODBYE DETECTION (genuine vs casual)
# ============================================================
print("\n=== 6. Goodbye detection ===")

r = d.should_suggest(
    user_messages=[
        "I have diabetes", "plan my meals", "what about snacks",
        "and exercise", "thank you for the help",
    ],
    agent_response="Here is your complete plan with meals and exercise",
    tools_used=["generate_care_plan"],
    followup={"date": "2026-05-02"},
    latest_message="goodbye",
)
check("Genuine goodbye with substance -> suggest", r["suggest"] is True)

r2 = d.should_suggest(
    user_messages=["what is moringa good for", "ok", "thanks"],
    agent_response="Moringa is a nutritious plant",
    tools_used=[],
    followup=None,
    latest_message="thanks",
)
check("Casual thanks without substance -> skip", r2["suggest"] is False)


# ============================================================
# 7. CAREGIVER CONTEXT
# ============================================================
print("\n=== 7. Caregiver context ===")

r = d.should_suggest(
    user_messages=[
        "I am taking care of my mother",
        "she has diabetes and hypertension",
        "what should I monitor",
        "how often should I check her vitals",
    ],
    agent_response="Monitor blood sugar daily, check blood pressure twice a week",
    tools_used=["check_vitals"],
    followup=None,
    latest_message="how often should I check her vitals",
    user_role="caregiver",
)
check("Caregiver with chronic patient -> suggest", r["suggest"] is True)
check("Caregiver signal present", "caregiver_context" in r["signals"])


# ============================================================
# 8. MEDICATION DISCUSSION
# ============================================================
print("\n=== 8. Medication discussion ===")

r = d.should_suggest(
    user_messages=[
        "when should I take metformin",
        "what about amlodipine",
        "do they interact",
        "ok I will take them as you said",
    ],
    agent_response="Take metformin with meals, amlodipine in the morning. No known interaction.",
    tools_used=["medication_check"],
    followup=None,
    latest_message="ok I will take them as you said",
)
check("Medication management -> suggest", r["suggest"] is True)
check("Medication signal", "medication_discussed" in r["signals"])


# ============================================================
# 9. SINGLETON
# ============================================================
print("\n=== 9. Singleton ===")

s1 = get_detector()
s2 = get_detector()
check("get_detector returns same instance", s1 is s2)


# ============================================================
# 10. THE KEY CASE — "thanks" should NOT trigger alone
# ============================================================
print("\n=== 10. The 'thanks' problem ===")

r = d.should_suggest(
    user_messages=[
        "what foods help with energy",
        "anything else",
        "ok thanks",
    ],
    agent_response="Eat moringa and groundnut stew for energy",
    tools_used=[],
    followup=None,
    latest_message="ok thanks",
)
check("Casual 'thanks' after info query -> skip", r["suggest"] is False)

r2 = d.should_suggest(
    user_messages=[
        "hello",
        "I just wanted to ask something",
        "whats the time to take medicine",
        "ok thank you",
    ],
    agent_response="Take your medicine in the morning after eating",
    tools_used=[],
    followup=None,
    latest_message="ok thank you",
)
check("Simple 4-message chat -> skip", r2["suggest"] is False, f"score={r2['score']}")


# ============================================================
# SUMMARY
# ============================================================
print(f"\n{'='*60}")
print(f"  RESULTS:  {PASS} passed,  {FAIL} failed")
print(f"{'='*60}")
sys.exit(1 if FAIL > 0 else 0)
