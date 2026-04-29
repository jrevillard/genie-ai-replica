#!/usr/bin/env python3
"""
AMINA Caregiver Model — Training Data Generator
================================================

Generates synthetic training data for the caregiver-specific AMINA model.

Unlike the patient-facing model (empathetic, simplified, asks one question),
the caregiver model is trained to:
  1. Conduct structured clinical intake interviews
     (asking focused questions until it has enough current context)
  2. Synthesize patient DB history + caregiver live observations into
     structured clinical briefings
  3. Answer follow-up questions concisely in clinical language
  4. Never ask clarifying questions after a report is generated
  5. Name red flags directly without softening

Output files:
  caregiver_sft_interviews.jsonl   — multi-turn interview → report conversations
  caregiver_sft_followups.jsonl    — follow-up Q&A after a report
  caregiver_dpo_preferences.jsonl  — clinical vs patient-style response pairs

Usage:
  python generate_caregiver_data.py --output training_data/ --count 3000
"""

import json
import random
import argparse
from datetime import datetime, timedelta
from typing import List, Dict

# ── System prompt ─────────────────────────────────────────────────────────────

CAREGIVER_SYSTEM = """You are AMINA, an AI health-intelligence assistant providing clinical briefings to caregivers.

Your role:
- Conduct structured clinical intake interviews with caregivers to gather current patient status
- Synthesize patient medical history with caregiver's live observations into clinical briefings
- Provide clear, direct, data-grounded answers in professional clinical language
- Name red flags explicitly — never soften serious concerns

Rules:
- Ask ONE focused question at a time during intake (or 2 closely related sub-questions)
- Do NOT generate the report until you have gathered enough current information
- Once you have enough context, generate the full clinical briefing automatically
- After generating a report, answer follow-up questions concisely — do NOT ask more intake questions
- Never treat the caregiver as a patient
- Clinical language throughout — not simplified village-level language"""

# ── Patient profiles ──────────────────────────────────────────────────────────

PATIENTS = [
    {
        "name": "Ousman Ceesay", "age": 62, "gender": "male",
        "conditions": ["Type 2 Diabetes", "Hypertension"],
        "medications": ["Metformin 1000mg twice daily", "Amlodipine 5mg once daily"],
        "last_bp": "148/94 mmHg", "last_glucose": "9.2 mmol/L",
        "triage_history": ["SELF_CARE", "CHW_VISIT", "FACILITY", "CHW_VISIT"],
        "key_concerns": ["persistent high BP", "missed doses on weekends", "ankle swelling"],
        "last_consult_summary": "Patient reported fatigue and ankle swelling. BP elevated. Advised dietary sodium reduction and medication compliance.",
    },
    {
        "name": "Fatou Jallow", "age": 45, "gender": "female",
        "conditions": ["Type 2 Diabetes", "Peripheral Neuropathy"],
        "medications": ["Metformin 500mg twice daily", "Gabapentin 300mg at night"],
        "last_bp": "132/86 mmHg", "last_glucose": "11.4 mmol/L",
        "triage_history": ["CHW_VISIT", "CHW_VISIT", "FACILITY"],
        "key_concerns": ["foot tingling worsening", "HbA1c 8.2%", "dietary non-adherence"],
        "last_consult_summary": "Foot tingling and numbness reported. HbA1c elevated at 8.2%. Referred for podiatry review.",
    },
    {
        "name": "Lamin Sanneh", "age": 71, "gender": "male",
        "conditions": ["COPD", "Hypertension", "Heart Failure"],
        "medications": ["Salbutamol inhaler", "Furosemide 40mg", "Lisinopril 10mg"],
        "last_bp": "162/98 mmHg", "last_glucose": None,
        "triage_history": ["FACILITY", "EMERGENCY", "FACILITY", "CHW_VISIT"],
        "key_concerns": ["recent emergency visit for dyspnoea", "fluid retention", "poor inhaler technique"],
        "last_consult_summary": "Emergency visit for acute dyspnoea. Fluid retention noted. Furosemide dose reviewed. Follow-up in 2 weeks.",
    },
    {
        "name": "Mariama Touray", "age": 55, "gender": "female",
        "conditions": ["Hypertension", "Obesity", "Depression"],
        "medications": ["Hydrochlorothiazide 25mg", "Sertraline 50mg"],
        "last_bp": "155/96 mmHg", "last_glucose": None,
        "triage_history": ["SELF_CARE", "CHW_VISIT", "CHW_VISIT"],
        "key_concerns": ["medication side effects", "low mood affecting adherence", "weight management"],
        "last_consult_summary": "BP uncontrolled. Low mood and fatigue reported. Sertraline started. Advised walking 20 min daily.",
    },
    {
        "name": "Ebrima Bojang", "age": 38, "gender": "male",
        "conditions": ["Asthma", "Allergic Rhinitis"],
        "medications": ["Beclomethasone inhaler", "Salbutamol PRN", "Loratadine 10mg"],
        "last_bp": "118/74 mmHg", "last_glucose": None,
        "triage_history": ["SELF_CARE", "CHW_VISIT", "SELF_CARE"],
        "key_concerns": ["nocturnal wheeze increasing", "inhaler technique poor", "dust exposure at work"],
        "last_consult_summary": "Nocturnal wheeze reported. Inhaler technique reviewed. Advised dust mask at work.",
    },
    {
        "name": "Adama Bah", "age": 67, "gender": "male",
        "conditions": ["Type 2 Diabetes", "CKD Stage 3", "Hypertension"],
        "medications": ["Insulin Glargine 20 units nightly", "Amlodipine 10mg", "Atorvastatin 40mg"],
        "last_bp": "158/102 mmHg", "last_glucose": "14.1 mmol/L",
        "triage_history": ["FACILITY", "FACILITY", "EMERGENCY"],
        "key_concerns": ["CKD progression", "hyperglycaemia", "recent emergency admission"],
        "last_consult_summary": "Emergency admission for hyperosmolar state. Insulin regimen adjusted. Nephrology referral pending.",
    },
    {
        "name": "Sainabou Jammeh", "age": 29, "gender": "female",
        "conditions": ["Gestational Diabetes", "Iron Deficiency Anaemia"],
        "medications": ["Insulin Aspart", "Ferrous Sulphate 200mg twice daily", "Folic Acid 5mg"],
        "last_bp": "122/78 mmHg", "last_glucose": "7.8 mmol/L",
        "triage_history": ["CHW_VISIT", "FACILITY", "CHW_VISIT"],
        "key_concerns": ["glucose control in third trimester", "anaemia symptoms", "fetal monitoring"],
        "last_consult_summary": "34 weeks gestation. Glucose borderline. Anaemia improving with iron. Weekly monitoring plan in place.",
    },
    {
        "name": "Bakary Camara", "age": 52, "gender": "male",
        "conditions": ["HIV on ART", "Hypertension"],
        "medications": ["TDF/3TC/DTG", "Amlodipine 5mg"],
        "last_bp": "138/88 mmHg", "last_glucose": None,
        "triage_history": ["SELF_CARE", "CHW_VISIT", "SELF_CARE"],
        "key_concerns": ["ART adherence", "drug-drug interactions", "stigma affecting compliance"],
        "last_consult_summary": "ART adherence 90%. BP controlled. Counselled on drug interactions. Viral load suppressed.",
    },
]

CAREGIVER_NAMES = [
    "Sarah Mendy", "Isatou Dibba", "Omar Jallow", "Ndey Fatty",
    "Binta Ceesay", "Modou Saho", "Awa Touray", "Lamin Drammeh",
]

# ── Question bank (per information gap) ──────────────────────────────────────

QUESTIONS = {
    "medication_adherence": [
        "Is {name} currently taking {med} as prescribed — are there any missed doses recently?",
        "How has {name}'s medication adherence been? Any days where doses were skipped?",
        "Is {name} still taking all prescribed medications regularly, particularly {med}?",
        "Have there been any issues with {name} taking their medications on time?",
    ],
    "current_symptoms": [
        "Have you noticed any new or worsening symptoms in {name} recently — pain, breathlessness, swelling, or fatigue?",
        "What symptoms has {name} been experiencing over the past week?",
        "Has {name} reported feeling any differently lately — any discomfort, dizziness, or changes?",
        "Are there any physical symptoms you've observed in {name} that concern you?",
    ],
    "behavioral_changes": [
        "Have you noticed any changes in {name}'s sleep, appetite, or daily activity levels?",
        "How is {name}'s mood and energy been — any noticeable changes in behaviour?",
        "Has {name}'s appetite or ability to carry out daily tasks changed recently?",
        "Are there any changes in {name}'s sleep pattern or general mood you've observed?",
    ],
    "recent_events": [
        "Has {name} had any recent health events — emergency visits, falls, or infections?",
        "Were there any missed appointments or changes in {name}'s routine recently?",
        "Has anything significant happened to {name}'s health in the last 2–3 weeks?",
        "Has {name} been exposed to anything that might have affected their health — illness in the household, stress, dietary changes?",
    ],
    "caregiver_concern": [
        "What's your main concern about {name} right now — what would you like me to focus on?",
        "Is there a specific aspect of {name}'s health you're most worried about?",
        "What prompted you to check in about {name} today — is something in particular on your mind?",
    ],
    "functional_status": [
        "How is {name} managing daily activities — is there any decline in independence or mobility?",
        "Can {name} carry out their usual activities without difficulty, or have you noticed limitations?",
        "Is {name} able to care for themselves, or are there tasks they're struggling with?",
    ],
}

# ── Answer bank ───────────────────────────────────────────────────────────────

ANSWERS = {
    "medication_adherence_good": [
        "Yes, {name} is taking all medications regularly. No missed doses.",
        "He's been consistent with his medications.",
        "She takes everything as prescribed, I make sure of it.",
        "Medications are being taken on time.",
    ],
    "medication_adherence_partial": [
        "Mostly yes, but {name} sometimes skips the evening dose.",
        "He takes the morning one but forgets the night dose sometimes.",
        "She's been about 80% — misses doses on weekends.",
        "Not always — {name} complains about side effects and sometimes skips.",
    ],
    "medication_adherence_poor": [
        "{name} hasn't been taking medications regularly — says they make him feel worse.",
        "She stopped the {med} about a week ago without telling the doctor.",
        "He only takes medication when he feels bad, not daily.",
        "Medications are being skipped — {name} says they cause nausea.",
    ],
    "symptoms_stable": [
        "No new symptoms. {name} seems stable overall.",
        "Nothing new to report — he's been managing well.",
        "She's fine, no complaints lately.",
        "Everything seems okay — no new symptoms.",
    ],
    "symptoms_mild": [
        "{name} has been tired more than usual and has a mild headache.",
        "Some ankle swelling at the end of the day but nothing severe.",
        "He's been feeling a bit dizzy in the mornings.",
        "She complained of fatigue and reduced appetite this week.",
    ],
    "symptoms_concerning": [
        "{name} has been having chest tightness and shortness of breath.",
        "The ankle swelling has gotten worse and {name} can barely walk.",
        "He had a near-fainting episode yesterday morning.",
        "She's been having very high blood sugar readings — over 15 — and feels confused.",
    ],
    "behavior_stable": [
        "Sleep and appetite are normal. {name} is active as usual.",
        "No changes in behaviour or routine.",
        "He's in good spirits and eating well.",
    ],
    "behavior_changed": [
        "{name} has been sleeping a lot more and has lost interest in activities.",
        "She's barely eating and seems withdrawn.",
        "His mood has been low and he's been staying in bed more.",
        "Very irritable lately and not sleeping well.",
    ],
    "no_events": [
        "No recent health events. Everything has been routine.",
        "No hospital visits or emergencies.",
        "Nothing unusual happened recently.",
    ],
    "recent_event": [
        "{name} had to go to the health post 3 days ago for {concern}.",
        "There was a scare last week — {name} fainted briefly but recovered.",
        "We missed the last appointment because {name} wasn't feeling well enough to go.",
        "{name} had a fall at home 5 days ago but no serious injury.",
    ],
    "concern_general": [
        "I'm worried about {concern} — it doesn't seem to be improving.",
        "The main thing is {concern}. It keeps getting worse.",
        "I'm most concerned about whether {name}'s medications are working for {concern}.",
    ],
    "functional_good": [
        "{name} is managing well independently.",
        "He can do everything himself — no help needed.",
        "She's quite active and independent.",
    ],
    "functional_declined": [
        "{name} needs help with bathing and dressing now.",
        "He can't walk far without getting tired.",
        "She's struggling with stairs and needs someone nearby.",
    ],
}

# ── Report template builder ───────────────────────────────────────────────────

def build_report(patient: Dict, answers: Dict) -> str:
    name = patient["name"].split()[0]
    full_name = patient["name"]
    conditions = ", ".join(patient["conditions"])
    meds = ", ".join(patient["medications"])
    triage_hist = patient["triage_history"]
    facility_count = triage_hist.count("FACILITY")
    emergency_count = triage_hist.count("EMERGENCY")
    concerns = patient["key_concerns"]

    # Build dynamic sections
    med_status = answers.get("medication_adherence", "adherence status unknown")
    symptom_status = answers.get("current_symptoms", "no new symptoms reported")
    behavior = answers.get("behavioral_changes", "no changes noted")
    recent = answers.get("recent_events", "no recent events")
    cg_concern = answers.get("caregiver_concern", patient["key_concerns"][0])
    functional = answers.get("functional_status", "managing independently")

    # Risk assessment
    is_high_risk = emergency_count > 0 or facility_count >= 2
    risk_line = (
        f"⚠ HIGH RISK: {emergency_count} emergency visit(s) and {facility_count} facility visit(s) in recent history."
        if is_high_risk else f"Risk level is moderate based on consultation history ({facility_count} facility visit(s))."
    )

    return f"""---
**Clinical Briefing — {full_name}**

**Current Status**
{full_name} is a {patient['age']}-year-old {patient['gender']} with {conditions}. Based on your observations and the consultation history, {name} appears {'stable' if 'stable' in symptom_status.lower() or 'no new' in symptom_status.lower() else 'to require monitoring'}. {symptom_status.capitalize() if not symptom_status[0].isupper() else symptom_status}. {risk_line}

**Key Concerns**
- {concerns[0].capitalize()}
- {concerns[1].capitalize() if len(concerns) > 1 else 'Ongoing monitoring required'}
- {concerns[2].capitalize() if len(concerns) > 2 else 'Caregiver concern: ' + str(cg_concern)}

**Medication Status**
Prescribed: {meds}. Caregiver reports: {med_status}. {'Missed doses are clinically significant and should be addressed urgently.' if 'skip' in med_status.lower() or 'missed' in med_status.lower() or 'not taking' in med_status.lower() else 'Adherence appears satisfactory — continue monitoring.'}

**Symptom Trends**
Across recent consultations: {patient['last_consult_summary']} Current observation: {symptom_status}. {'This represents a worsening trend and warrants prompt reassessment.' if 'worse' in symptom_status.lower() or 'chest' in symptom_status.lower() or 'faint' in symptom_status.lower() else 'Symptoms appear stable but continued monitoring is advised.'}

**Behavioural & Lifestyle Signals**
{behavior.capitalize() if not behavior[0].isupper() else behavior}. Recent events: {recent}. Functional status: {functional}.

**Recommended Actions**
1. {'Urgently contact the patient's physician regarding ' + concerns[0] if is_high_risk else 'Schedule a follow-up consultation to review ' + concerns[0]}
2. {'Address medication non-adherence directly — discuss barriers with ' + name if 'skip' in med_status.lower() or 'not taking' in med_status.lower() else 'Reinforce medication adherence and confirm no side effects'}
3. Monitor {patient['last_bp'] and 'blood pressure' or 'vitals'} {'and glucose' if 'Diabetes' in conditions else ''} at least twice weekly
4. {'Seek emergency care immediately if symptoms worsen — specifically dyspnoea, chest pain, or confusion' if is_high_risk else 'Contact the health post if any new or worsening symptoms arise'}
5. {f'Follow up on {concerns[-1]}' if len(concerns) > 2 else 'Document observations and share with the treating clinician at the next visit'}
---

Feel free to ask if you need more detail on any of these points."""


# ── Conversation builder ──────────────────────────────────────────────────────

def build_interview_conversation(patient: Dict, caregiver_name: str, scenario: str) -> Dict:
    """Build a complete multi-turn interview → report conversation."""
    name = patient["name"].split()[0]
    med = patient["medications"][0].split()[0]
    concern = patient["key_concerns"][0]

    # Randomise how many questions before report (3-5)
    num_questions = random.randint(3, 5)
    dims = ["medication_adherence", "current_symptoms", "behavioral_changes",
            "recent_events", "caregiver_concern", "functional_status"]
    random.shuffle(dims)
    selected_dims = dims[:num_questions]

    # Opening caregiver message
    openers = [
        f"Can you give me an update on {name}?",
        f"I need a clinical update on {patient['name']}.",
        f"How is {name} doing based on their history?",
        f"Give me insights on {name}'s current health status.",
        f"I want a briefing on {patient['name']} — can you help?",
        f"What can you tell me about {name}'s condition right now?",
        f"I'm checking in on {name} — any concerns I should know about?",
    ]

    messages = [{"role": "system", "content": CAREGIVER_SYSTEM}]
    messages.append({"role": "user", "content": random.choice(openers)})

    gathered_answers = {}

    for i, dim in enumerate(selected_dims):
        # AMINA asks question
        q_template = random.choice(QUESTIONS[dim])
        question = q_template.format(name=name, med=med, concern=concern)

        # For last question, transition note
        if i == num_questions - 1:
            question += " Once you've shared that, I'll put together a full briefing for you."

        messages.append({"role": "assistant", "content": question})

        # Caregiver answers
        if dim == "medication_adherence":
            adherence_type = random.choice(["good", "partial", "poor"])
            ans_pool = ANSWERS[f"medication_adherence_{adherence_type}"]
            ans = random.choice(ans_pool).format(name=name, med=med)
            gathered_answers["medication_adherence"] = ans
        elif dim == "current_symptoms":
            sym_type = random.choice(["stable", "mild", "concerning"])
            ans = random.choice(ANSWERS[f"symptoms_{sym_type}"]).format(name=name)
            gathered_answers["current_symptoms"] = ans
        elif dim == "behavioral_changes":
            beh_type = random.choice(["stable", "changed"])
            ans = random.choice(ANSWERS[f"behavior_{beh_type}"]).format(name=name)
            gathered_answers["behavioral_changes"] = ans
        elif dim == "recent_events":
            evt_type = random.choice(["no_events", "recent_event"])
            ans = random.choice(ANSWERS[evt_type]).format(name=name, concern=concern)
            gathered_answers["recent_events"] = ans
        elif dim == "caregiver_concern":
            ans = random.choice(ANSWERS["concern_general"]).format(name=name, concern=concern)
            gathered_answers["caregiver_concern"] = ans
        elif dim == "functional_status":
            func_type = random.choice(["functional_good", "functional_declined"])
            ans = random.choice(ANSWERS[func_type]).format(name=name)
            gathered_answers["functional_status"] = ans

        messages.append({"role": "user", "content": ans})

    # AMINA generates the report
    report = build_report(patient, gathered_answers)
    messages.append({"role": "assistant", "content": f"Thank you for that update. Here is the full clinical briefing:\n\n{report}"})

    return {
        "messages": messages,
        "metadata": {
            "type": "caregiver_interview",
            "patient": patient["name"],
            "caregiver": caregiver_name,
            "conditions": patient["conditions"],
            "turns": len([m for m in messages if m["role"] == "user"]),
            "scenario": scenario,
            "generated_at": datetime.now().isoformat(),
        }
    }


def build_followup_conversation(patient: Dict, caregiver_name: str) -> Dict:
    """Build a post-report follow-up Q&A conversation."""
    name = patient["name"].split()[0]
    concern = random.choice(patient["key_concerns"])

    followup_qs = [
        f"Should I take {name} to the hospital today?",
        f"What signs should make me call emergency services for {name}?",
        f"How often should I check {name}'s blood pressure at home?",
        f"What should {name} eat to help with {concern}?",
        f"Is {concern} likely to worsen if we don't act now?",
        f"What's the single most important thing I can do for {name} this week?",
        f"Can {concern} be managed at home or does it need a clinic visit?",
    ]

    followup_answers = {
        f"Should I take {name} to the hospital today?":
            f"Based on what you've described, {'yes — the symptoms warrant same-day assessment. Do not delay.' if random.random() > 0.5 else 'not urgently, but schedule a clinic visit within 48–72 hours. Monitor for worsening.'}",
        f"What signs should make me call emergency services for {name}?":
            f"Call emergency services immediately if {name} develops: chest pain or tightness, sudden difficulty breathing, loss of consciousness or confusion, severe headache with vomiting, or inability to move a limb.",
        f"How often should I check {name}'s blood pressure at home?":
            f"With {name}'s history, aim for twice daily readings — morning before medication and evening. Record results and bring them to the next appointment.",
        f"What's the single most important thing I can do for {name} this week?":
            f"The most impactful action is ensuring {concern} is addressed — specifically, {'book a clinic appointment within 3 days' if 'FACILITY' in patient['triage_history'] else 'enforce medication adherence and monitor vitals daily'}.",
    }

    q = random.choice(followup_qs)
    a = followup_answers.get(q,
        f"Based on {name}'s history with {', '.join(patient['conditions'])}, {concern} should be monitored closely. "
        f"If it worsens in the next 24 hours, escalate to the health post. Otherwise, maintain current management and review at the next scheduled visit."
    )

    report = build_report(patient, {
        "medication_adherence": "adherence has been variable",
        "current_symptoms": "some ongoing symptoms related to " + concern,
        "behavioral_changes": "no significant changes",
        "recent_events": "no recent emergency events",
        "caregiver_concern": concern,
        "functional_status": "managing with some support",
    })

    messages = [
        {"role": "system",    "content": CAREGIVER_SYSTEM},
        {"role": "user",      "content": f"Give me an update on {patient['name']}."},
        {"role": "assistant", "content": "I'll need a few quick updates. Is " + name + " currently taking all medications as prescribed?"},
        {"role": "user",      "content": "Yes, mostly. Some missed doses on weekends."},
        {"role": "assistant", "content": "Noted. Any new or worsening symptoms — swelling, pain, breathlessness?"},
        {"role": "user",      "content": f"Some {concern} concerns. Otherwise stable."},
        {"role": "assistant", "content": f"Thank you. Here is the briefing:\n\n{report}"},
        {"role": "user",      "content": q},
        {"role": "assistant", "content": a},
    ]

    return {
        "messages": messages,
        "metadata": {
            "type": "caregiver_followup",
            "patient": patient["name"],
            "caregiver": caregiver_name,
            "conditions": patient["conditions"],
            "generated_at": datetime.now().isoformat(),
        }
    }


def build_dpo_pair(patient: Dict, caregiver_name: str) -> Dict:
    """
    Build a DPO preference pair.
    Chosen = clinical, direct, data-grounded response.
    Rejected = patient-style response (wrong role, asks questions back, over-simplified).
    """
    name = patient["name"].split()[0]
    concern = random.choice(patient["key_concerns"])

    prompt_types = [
        f"Give me an update on {name}.",
        f"Is {name} at risk right now?",
        f"What should I watch for with {name} this week?",
        f"How serious is {concern} for {name}?",
        f"What are {name}'s biggest health risks based on their history?",
    ]
    prompt = random.choice(prompt_types)

    # Chosen: clinical, professional, data-grounded
    chosen_responses = [
        f"Based on {patient['name']}'s history — {', '.join(patient['conditions'])} — the primary concern is {concern}. "
        f"Recent consultations show {patient['last_consult_summary'].lower()} "
        f"To give you an accurate current briefing, can you confirm whether {name} is still taking {patient['medications'][0].split()[0]} regularly?",

        f"From the consultation history, {patient['name']} has {len(patient['triage_history'])} recorded visits, "
        f"including {patient['triage_history'].count('FACILITY')} facility referrals. "
        f"The main clinical flags are: {'; '.join(patient['key_concerns'][:2])}. "
        f"What is {name}'s current medication adherence status?",

        f"I can see {patient['name']}'s history includes {', '.join(patient['conditions'])}. "
        f"Current vitals on record: BP {patient['last_bp'] or 'not recorded'}"
        + (f", Glucose {patient['last_glucose']}" if patient['last_glucose'] else "") + ". "
        f"To complete the briefing, has {name} had any new symptoms or events since the last consultation?",
    ]

    # Rejected: wrong role (treating caregiver as patient), asks multiple questions, simplified
    rejected_responses = [
        f"I understand you are worried. Don't panic! How are YOU feeling today? Are you getting enough rest? "
        f"Remember to take care of yourself too. Can you tell me more about the patient?",

        f"Salaam aleikum! I want to help. Can you tell me — what are the latest readings? "
        f"And what medicine are you taking? Also, are you eating well? One step at a time.",

        f"That's great that you're checking in. To help {name}, you should: 1) make sure they drink water, "
        f"2) rest well, 3) avoid stress. Is {name} eating properly? How many times a day?",

        f"I hear you. Let's take this slowly. First — are you the patient or the caregiver? "
        f"Can you describe all your symptoms in detail? What is your age and weight?",

        f"Good question! There are many things to consider. How is the patient feeling? "
        f"Are they happy? Sad? Do they exercise? Do they eat vegetables? "
        f"Tell me everything and I will try to help as best I can.",
    ]

    messages_prefix = [
        {"role": "system", "content": CAREGIVER_SYSTEM},
        {"role": "user",   "content": prompt},
    ]

    return {
        "prompt": messages_prefix,
        "chosen": [{"role": "assistant", "content": random.choice(chosen_responses)}],
        "rejected": [{"role": "assistant", "content": random.choice(rejected_responses)}],
        "metadata": {
            "type": "caregiver_dpo",
            "patient": patient["name"],
            "prompt_type": prompt,
            "generated_at": datetime.now().isoformat(),
        }
    }


# ── Main generator ────────────────────────────────────────────────────────────

def generate(output_dir: str, count: int):
    import os
    os.makedirs(output_dir, exist_ok=True)

    interviews = []
    followups  = []
    dpo_pairs  = []

    scenarios = ["routine_checkin", "symptom_concern", "medication_review",
                 "post_emergency", "new_caregiver", "urgent_concern"]

    print(f"Generating {count} caregiver training examples...")

    for i in range(count):
        patient   = random.choice(PATIENTS)
        caregiver = random.choice(CAREGIVER_NAMES)
        scenario  = random.choice(scenarios)

        # 50% interviews, 30% follow-ups, 20% DPO
        roll = random.random()
        if roll < 0.50:
            interviews.append(build_interview_conversation(patient, caregiver, scenario))
        elif roll < 0.80:
            followups.append(build_followup_conversation(patient, caregiver))
        else:
            dpo_pairs.append(build_dpo_pair(patient, caregiver))

        if (i + 1) % 500 == 0:
            print(f"  {i + 1}/{count} generated...")

    # Write SFT data
    sft_path = os.path.join(output_dir, "caregiver_sft_interviews.jsonl")
    with open(sft_path, "w") as f:
        for ex in interviews:
            f.write(json.dumps(ex) + "\n")
    print(f"SFT interviews   : {len(interviews):>5}  →  {sft_path}")

    followup_path = os.path.join(output_dir, "caregiver_sft_followups.jsonl")
    with open(followup_path, "w") as f:
        for ex in followups:
            f.write(json.dumps(ex) + "\n")
    print(f"SFT follow-ups   : {len(followups):>5}  →  {followup_path}")

    # Write DPO data
    dpo_path = os.path.join(output_dir, "caregiver_dpo_preferences.jsonl")
    with open(dpo_path, "w") as f:
        for ex in dpo_pairs:
            f.write(json.dumps(ex) + "\n")
    print(f"DPO preferences  : {len(dpo_pairs):>5}  →  {dpo_path}")

    # Metadata
    meta = {
        "generated_at": datetime.now().isoformat(),
        "total_examples": len(interviews) + len(followups) + len(dpo_pairs),
        "stats": {
            "sft_interviews": len(interviews),
            "sft_followups":  len(followups),
            "dpo_pairs":      len(dpo_pairs),
        },
        "model_target": "amina-caregiver-v1",
        "base_model":   "mistralai/Mistral-7B-Instruct-v0.3",
        "system_prompt": CAREGIVER_SYSTEM,
        "categories": ["clinical_intake_interview", "report_generation",
                        "followup_qa", "role_alignment", "risk_assessment"],
        "patients": [p["name"] for p in PATIENTS],
    }
    with open(os.path.join(output_dir, "caregiver_metadata.json"), "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\nTotal examples   : {meta['total_examples']}")
    print(f"Metadata saved   : {os.path.join(output_dir, 'caregiver_metadata.json')}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AMINA Caregiver Training Data Generator")
    parser.add_argument("--output", default="training_data/", help="Output directory")
    parser.add_argument("--count",  type=int, default=3000, help="Number of examples to generate")
    args = parser.parse_args()
    generate(args.output, args.count)
