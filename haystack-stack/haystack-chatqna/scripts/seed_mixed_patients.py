#!/usr/bin/env python3
"""
AMINA — Mixed Patient Data Seeder
===================================
Creates 15 realistic Gambian patients spanning the full clinical spectrum:

  CRITICAL      — acute decompensation, needs emergency escalation
  DECLINING     — deteriorating despite treatment, poor adherence
  UNSTABLE      — erratic readings, on-and-off engagement
  MODERATE      — managed but not controlled, needs closer follow-up
  RECOVERING    — post-acute, improving trajectory
  STABLE_COMPLEX — well-controlled but high-complexity multi-morbidity
  NEW_DIAGNOSIS  — just diagnosed, anxious, starting treatment

Each patient gets 5–8 consultations showing their trajectory over 6 months.
Patients are auto-linked to one of the 8 seeded caregivers.

Usage (inside container):
    python scripts/seed_mixed_patients.py
"""

import json, uuid, hashlib, requests, random
from datetime import datetime, timedelta

# ── Config ─────────────────────────────────────────────────────────────────────
API      = "http://localhost:8000"
ARCADEDB = "http://arcadedb:2480"
DB       = "genie"
AUTH     = ("root", "genieRoot123")

OK   = "\033[92m✔\033[0m"
WARN = "\033[93m⚠\033[0m"
FAIL = "\033[91m✘\033[0m"

# ── ArcadeDB helpers ──────────────────────────────────────────────────────────

def sql(query, params=None):
    payload = {"language": "sql", "command": query}
    if params:
        payload["params"] = params
    r = requests.post(f"{ARCADEDB}/api/v1/command/{DB}", json=payload, auth=AUTH, timeout=10)
    if r.status_code != 200:
        raise Exception(f"ArcadeDB {r.status_code}: {r.text[:300]}")
    return r.json().get("result", [])

def cid():
    return "C" + uuid.uuid4().hex[:8].upper()

def sid(patient_id, n):
    return f"s_{patient_id}_m{n:02d}"

# ── Caregiver IDs (from seed_caregivers.py output) ───────────────────────────

def get_caregiver_ids():
    """Fetch all seeded caregiver IDs from ArcadeDB."""
    rows = sql("SELECT caregiver_id, name, specialization FROM CaregiverVertex WHERE is_directory_visible = true LIMIT 20")
    return rows  # [{caregiver_id, name, specialization}]

# ── Patient definitions ────────────────────────────────────────────────────────

PATIENTS = [
    # ── CRITICAL ─────────────────────────────────────────────────────────────
    {
        "email": "ousman.konateh@aminacare.dev", "password": "Amina2026",
        "name": "Ousman Konateh", "age": 68, "gender": "male",
        "region": "Kanifing", "conditions": ["heart_disease", "hypertension", "diabetes"],
        "language": "english",
        "profile": {
            "medications": [
                {"name": "Furosemide", "dosage": "40mg", "frequency": "Twice daily"},
                {"name": "Ramipril", "dosage": "10mg", "frequency": "Once daily"},
                {"name": "Spironolactone", "dosage": "25mg", "frequency": "Once daily"},
                {"name": "Metformin", "dosage": "500mg", "frequency": "Twice daily"},
                {"name": "Amlodipine", "dosage": "10mg", "frequency": "Once daily"},
            ],
            "last_bp": "178/110", "last_glucose": "14.2",
            "key_facts": [
                "Advanced heart failure (NYHA Class III)", "Dual NCD: diabetes + hypertension",
                "Reports increasing breathlessness at rest", "Missed last 3 cardiology appointments",
                "Low income — cannot always afford Furosemide", "Lives alone, son abroad",
            ],
            "triage_status": "EMERGENCY",
        },
        "caregiver_specialty": "Chronic Disease",
        "consultations": [
            {
                "dago": 160, "triage": "SELF_CARE",
                "summary": "Routine follow-up. BP 148/92 on dual therapy. HF stable. Glucose 9.1 fasting. Advised to restrict salt and fluids.",
                "symptoms": ["mild ankle swelling", "fatigue"],
                "recs": ["Salt restriction <2g/day", "Daily weight monitoring", "Continue all medications"],
                "messages": [
                    {"role":"user","content":"AMINA, I feel okay today. A bit tired."},
                    {"role":"assistant","content":"Good to hear. How are your ankles — any swelling?"},
                    {"role":"user","content":"A little swelling at end of day."},
                    {"role":"assistant","content":"That can happen with heart failure. Are you weighing yourself every morning as we discussed?"},
                    {"role":"user","content":"Sometimes. I forget."},
                    {"role":"assistant","content":"Let's make it a habit — weigh before breakfast, same time. A gain of 2kg in 2 days means the fluid is building up and you need to call me."},
                ]
            },
            {
                "dago": 120, "triage": "CHW_VISIT",
                "summary": "Weight up 3kg in 1 week. Ankle oedema worsening. Ran out of Furosemide 5 days ago. Urgent CHW visit arranged.",
                "symptoms": ["significant ankle oedema", "weight gain 3kg", "shortness of breath on stairs"],
                "recs": ["CHW visit TODAY", "Get Furosemide urgently from health post", "Restrict fluids to 1.5L/day"],
                "messages": [
                    {"role":"user","content":"AMINA my legs are very swollen. I could not buy Furosemide this week."},
                    {"role":"assistant","content":"This is serious. Missing Furosemide causes fluid to build up quickly. How much weight have you gained?"},
                    {"role":"user","content":"About 3 kg since Monday."},
                    {"role":"assistant","content":"3kg in one week is a red flag for heart failure worsening. I am alerting your CHW right now. Please restrict fluids to 1.5 litres today — no salt at all."},
                ]
            },
            {
                "dago": 90, "triage": "FACILITY",
                "summary": "Worsening dyspnoea, orthopnoea (3-pillow). Oxygen saturation 88% on room air. Urgent facility referral made. Possible decompensated heart failure.",
                "symptoms": ["dyspnoea at rest", "orthopnoea", "oxygen saturation 88%", "severe ankle oedema"],
                "recs": ["URGENT facility referral", "Do not delay — go today", "Take all medication list to hospital"],
                "messages": [
                    {"role":"user","content":"I can't breathe properly lying down. I need 3 pillows to sleep."},
                    {"role":"assistant","content":"Orthopnoea — needing pillows to breathe — means your heart is struggling badly. What is your oxygen reading?"},
                    {"role":"user","content":"The CHW measured 88% yesterday."},
                    {"role":"assistant","content":"88% is dangerously low. You need to go to the hospital TODAY. This is a medical emergency. Can someone take you now?"},
                    {"role":"user","content":"My neighbour can take me."},
                    {"role":"assistant","content":"Go now. Tell them you have heart failure with low oxygen. I am marking this as an emergency referral. Take your medication list."},
                ]
            },
            {
                "dago": 70, "triage": "CHW_VISIT",
                "summary": "Discharged after 5-day hospital admission. IV Furosemide given. Now on oral Furosemide 80mg BD. Weight reduced 6kg. O2 96%. Ramipril dose increased to 10mg.",
                "symptoms": ["residual fatigue", "mild ankle oedema", "reduced breathlessness"],
                "recs": ["CHW visit in 3 days", "Daily weight", "Restrict fluids to 1.5L", "No salt"],
                "messages": [
                    {"role":"user","content":"I am home from hospital. They gave me drip for 5 days."},
                    {"role":"assistant","content":"Welcome home. That was a serious episode. How are you breathing now?"},
                    {"role":"user","content":"Better. O2 is 96%. But still tired."},
                    {"role":"assistant","content":"96% is much safer. Fatigue is expected after hospitalisation. The most important thing now is daily weighing — any 2kg rise means call CHW immediately."},
                ]
            },
            {
                "dago": 45, "triage": "FACILITY",
                "summary": "Second decompensation episode in 6 weeks. Patient admitted again. Stopped Spironolactone due to cost. Cardiology referral made. Social support needs documented.",
                "symptoms": ["breathlessness at rest", "3-pillow orthopnoea", "weight gain 4kg in 4 days"],
                "recs": ["Emergency facility — second admission", "Cardiology urgently", "Social worker for medication support"],
                "messages": [
                    {"role":"user","content":"AMINA, I am struggling to breathe again. Worse than before."},
                    {"role":"assistant","content":"How long has this been getting worse?"},
                    {"role":"user","content":"4 days. I stopped the Spironolactone — I couldn't afford it."},
                    {"role":"assistant","content":"Stopping Spironolactone with heart failure can cause rapid fluid buildup. You need to go to hospital again right now. This is the second emergency in 6 weeks — I am flagging for urgent cardiology and social support."},
                ]
            },
            {
                "dago": 14, "triage": "EMERGENCY",
                "summary": "EMERGENCY: Patient collapsed at home. Neighbour called for help. Suspected acute pulmonary oedema. Ambulance dispatched. EMERGENCY triage assigned.",
                "symptoms": ["collapse", "acute dyspnoea", "confusion", "cyanosis reported by neighbour"],
                "recs": ["EMERGENCY — ambulance dispatched", "Do not move patient", "Keep upright if conscious"],
                "messages": [
                    {"role":"user","content":"This is his neighbour. Ousman collapsed. He is struggling to breathe and confused."},
                    {"role":"assistant","content":"This is a medical emergency. Call 1110 for ambulance NOW. Keep him sitting upright — do not lay him flat. Is he conscious?"},
                    {"role":"user","content":"Yes but very confused. Lips look blue."},
                    {"role":"assistant","content":"Blue lips means very low oxygen. Ambulance is being alerted. Keep him sitting. Someone stay with him at all times until ambulance arrives."},
                ]
            },
        ]
    },

    # ── DECLINING / POOR ADHERENCE ────────────────────────────────────────────
    {
        "email": "ndey.fatty@aminacare.dev", "password": "Amina2026",
        "name": "Ndey Fatty", "age": 52, "gender": "female",
        "region": "West Coast", "conditions": ["diabetes", "hypertension"],
        "language": "english",
        "profile": {
            "medications": [
                {"name": "Glibenclamide", "dosage": "5mg", "frequency": "Once daily before breakfast"},
                {"name": "Hydrochlorothiazide", "dosage": "25mg", "frequency": "Once daily morning"},
            ],
            "last_bp": "162/105", "last_glucose": "18.6",
            "key_facts": [
                "Very poor medication adherence — takes tablets 'when she remembers'",
                "Diet: high in rice and sugar, refuses dietary changes",
                "HbA1c last measured at 11.2% — uncontrolled",
                "Tingling in feet — early peripheral neuropathy",
                "Dismisses advice; believes symptoms are from 'tiredness'",
                "Has not attended health facility in 4 months",
            ],
            "triage_status": "FACILITY",
        },
        "caregiver_specialty": "Chronic Disease",
        "consultations": [
            {
                "dago": 175, "triage": "SELF_CARE",
                "summary": "Initial enrolment. New diagnosis of Type 2 diabetes + hypertension. Started on Glibenclamide and HCT. Patient educated on diet and adherence.",
                "symptoms": ["thirst", "frequent urination", "blurred vision"],
                "recs": ["Start Glibenclamide 5mg daily", "Start HCT 25mg daily", "Reduce sugar intake", "Follow-up in 2 weeks"],
                "messages": [
                    {"role":"user","content":"The doctor said my sugar is high. 15.2 fasting."},
                    {"role":"assistant","content":"Yes, 15.2 is significantly elevated — the normal fasting range is below 5.6. The doctor has started you on medication. The most important thing now is taking Glibenclamide every day before breakfast without fail."},
                    {"role":"user","content":"Okay. But I don't want to stop eating rice."},
                    {"role":"assistant","content":"I understand — rice is a staple. The goal isn't to stop rice but to reduce the portion size. Fill half your plate with vegetables first, then add a smaller serving of rice."},
                ]
            },
            {
                "dago": 145, "triage": "CHW_VISIT",
                "summary": "2-month follow-up. Glucose 16.8 — barely changed. Patient admits to forgetting tablets most days. BP 158/102. CHW visit scheduled.",
                "symptoms": ["continued thirst", "fatigue"],
                "recs": ["CHW counselling on adherence", "Alarm reminders for medication", "Weekly glucose check"],
                "messages": [
                    {"role":"user","content":"I checked glucose — 16.8 this morning."},
                    {"role":"assistant","content":"That's still very high — almost the same as 2 months ago. Have you been taking Glibenclamide every day?"},
                    {"role":"user","content":"Not really. I forget sometimes."},
                    {"role":"assistant","content":"Missing tablets is the most likely reason the glucose isn't improving. Can you set a phone alarm for 7am every day? Missing just 3 days a week can make the medication almost useless."},
                ]
            },
            {
                "dago": 110, "triage": "CHW_VISIT",
                "summary": "Tingling in feet reported. Classic early diabetic peripheral neuropathy. Glucose 19.2 — worsening. Second CHW visit. Diet review — eating 3 large rice portions daily.",
                "symptoms": ["foot tingling", "numbness toes", "worsening fatigue"],
                "recs": ["Urgent: foot tingling = nerve damage risk", "Must improve glucose control", "CHW to assist with medication schedule"],
                "messages": [
                    {"role":"user","content":"My feet have been tingling and numb at night. Is this from the diabetes?"},
                    {"role":"assistant","content":"Yes — tingling feet is an early sign that high blood sugar is affecting the nerves. This is called peripheral neuropathy. The good news is it can be stopped from getting worse if we bring the glucose down. What was your reading today?"},
                    {"role":"user","content":"19.2. I know it's bad."},
                    {"role":"assistant","content":"19.2 with foot symptoms means the diabetes is not controlled at all. I have to be direct with you — if this continues, the numbness can lead to wounds that don't heal and serious complications. This needs to change now."},
                ]
            },
            {
                "dago": 70, "triage": "FACILITY",
                "summary": "Small wound on right heel not healing for 3 weeks. Classic diabetic foot. Glucose 21.4. Referred to facility for wound assessment and medication escalation. HbA1c ordered.",
                "symptoms": ["diabetic foot wound", "glucose 21.4", "wound not healing 3 weeks"],
                "recs": ["URGENT facility referral", "Diabetic foot wound protocol", "HbA1c measurement", "Medication escalation needed"],
                "messages": [
                    {"role":"user","content":"I have a small cut on my heel that won't heal. 3 weeks now."},
                    {"role":"assistant","content":"A wound that won't heal with uncontrolled diabetes is a medical emergency. What does it look like — is it swollen, smelling, or discharging?"},
                    {"role":"user","content":"It's red around it. A bit of fluid coming out."},
                    {"role":"assistant","content":"This is a diabetic foot infection — you need to go to the health facility today. Do NOT walk on it if you can avoid it. Diabetic foot infections can progress very quickly. This is the consequence of the glucose staying at 19-21."},
                ]
            },
            {
                "dago": 40, "triage": "FACILITY",
                "summary": "Wound infected — cellulitis spreading. Admitted for IV antibiotics. Glucose 23.1 on admission. Insulin initiated in hospital. Referred to diabetic clinic on discharge.",
                "symptoms": ["spreading cellulitis right foot", "fever 38.4°C", "glucose 23.1"],
                "recs": ["Facility admission", "IV antibiotics", "Insulin started", "Diabetic clinic follow-up"],
                "messages": [
                    {"role":"user","content":"The wound is worse. My foot is hot and swollen and I have fever."},
                    {"role":"assistant","content":"Fever with a spreading foot wound is very serious. You must go to hospital immediately. Do you have someone to take you?"},
                    {"role":"user","content":"My daughter is here."},
                    {"role":"assistant","content":"Go now. Tell the nurses you have diabetes and a foot infection with fever. They may need to start insulin and IV antibiotics. This is urgent."},
                ]
            },
        ]
    },

    # ── UNSTABLE / ERRATIC ────────────────────────────────────────────────────
    {
        "email": "karamo.sanneh@aminacare.dev", "password": "Amina2026",
        "name": "Karamo Sanneh", "age": 44, "gender": "male",
        "region": "North Bank", "conditions": ["hypertension"],
        "language": "english",
        "profile": {
            "medications": [
                {"name": "Amlodipine", "dosage": "10mg", "frequency": "Once daily"},
                {"name": "Lisinopril", "dosage": "20mg", "frequency": "Once daily"},
            ],
            "last_bp": "182/118", "last_glucose": None,
            "key_facts": [
                "Severe resistant hypertension — BP rarely below 160/100",
                "High stress job (lorry driver), works irregular hours",
                "Smokes 10 cigarettes/day, refuses to quit",
                "Alcohol use on weekends, not disclosed fully",
                "Misses medications when travelling for work",
                "Father died of stroke at 51",
                "BP varies wildly: 140/90 one day, 185/120 next",
            ],
            "triage_status": "CHW_VISIT",
        },
        "caregiver_specialty": "Chronic Disease",
        "consultations": [
            {
                "dago": 140, "triage": "CHW_VISIT",
                "summary": "BP 185/118. Patient has been on road for 2 weeks, missed all medication. Restarted Amlodipine. Urgent follow-up in 48h.",
                "symptoms": ["severe headache", "neck stiffness", "high BP 185/118"],
                "recs": ["Restart Amlodipine immediately", "Rest today — no driving", "Check BP in 48 hours"],
                "messages": [
                    {"role":"user","content":"AMINA, terrible headache. I just got back from a 2-week trip. I didn't bring my tablets."},
                    {"role":"assistant","content":"Missing 2 weeks of hypertension medication can cause a dangerous BP spike. Can you measure your BP right now?"},
                    {"role":"user","content":"185/118."},
                    {"role":"assistant","content":"That is a hypertensive urgency level. Do not drive. Rest now, take your Amlodipine immediately, drink water. I need you to check BP again in 2 hours and message me."},
                ]
            },
            {
                "dago": 115, "triage": "SELF_CARE",
                "summary": "BP improved to 148/94 after restarting medication. Patient travelling less this month. Advised on portable pill organiser.",
                "symptoms": ["mild headache"],
                "recs": ["Continue dual therapy", "Pill organiser for travel", "Weekly BP check"],
                "messages": [
                    {"role":"user","content":"BP is 148/94. Better."},
                    {"role":"assistant","content":"Good improvement. Have you been taking both tablets every day?"},
                    {"role":"user","content":"Yes, more regular this week."},
                    {"role":"assistant","content":"148/94 is still above target — we want below 140/90. But the improvement shows the medication is working when you take it. Can you keep a 7-day pill organiser in your truck cab?"},
                ]
            },
            {
                "dago": 85, "triage": "CHW_VISIT",
                "summary": "BP 174/112 again. Patient admitted to heavy alcohol use over weekend. Also smoked more than usual. Medication taken. Stress at work escalating.",
                "symptoms": ["headache", "high BP 174/112", "irritability"],
                "recs": ["Alcohol is raising BP significantly", "Reduce to 2 units max on weekends", "Smoking cessation counselling offered"],
                "messages": [
                    {"role":"user","content":"BP is 174/112 even though I took my tablets."},
                    {"role":"assistant","content":"High BP despite medication often means something is offsetting it. Did you drink alcohol this weekend?"},
                    {"role":"user","content":"A bit. Some palm wine on Saturday and Sunday."},
                    {"role":"assistant","content":"Alcohol raises blood pressure significantly and can cancel out your medication effect. 'A bit' of palm wine on 2 days is likely the main cause today. This needs to stop — with your family history of stroke, this is a serious risk."},
                ]
            },
            {
                "dago": 55, "triage": "FACILITY",
                "summary": "Sudden severe headache, visual disturbance, BP 198/126. Hypertensive emergency. Referred to facility urgently. Third escalation in 5 months.",
                "symptoms": ["thunderclap headache", "blurred vision", "BP 198/126", "nausea"],
                "recs": ["EMERGENCY facility referral", "Hypertensive emergency protocol", "Do not drive"],
                "messages": [
                    {"role":"user","content":"AMINA, worst headache of my life. I can't see properly — things are blurry."},
                    {"role":"assistant","content":"Visual disturbance with a severe headache is a sign of hypertensive emergency — this can cause stroke. What is your BP?"},
                    {"role":"user","content":"198/126."},
                    {"role":"assistant","content":"198/126 with vision changes is a medical emergency. You must go to hospital by ambulance or car NOW — do not drive yourself. Call 1110 or have someone drive you. Tell them hypertensive emergency with visual symptoms."},
                ]
            },
            {
                "dago": 25, "triage": "CHW_VISIT",
                "summary": "Post-hospitalisation. BP controlled at 142/88 on triple therapy (Amlodipine + Lisinopril + HCT added). Patient now takes seriously after hospitalisation scare.",
                "symptoms": ["mild fatigue", "dizziness on standing"],
                "recs": ["Triple therapy initiated", "No alcohol", "Smoking cessation counsellor referred", "Weekly BP"],
                "messages": [
                    {"role":"user","content":"I'm home. They gave me a third tablet — HCT. BP 142/88."},
                    {"role":"assistant","content":"142/88 is much better. The hospital scare was a serious warning. Have you thought about the alcohol and smoking?"},
                    {"role":"user","content":"I have. I'm going to try to stop. I was scared."},
                    {"role":"assistant","content":"That's the right response. Your father died from stroke at 51. You are 44. The good news is — with these three medications AND quitting smoking and alcohol — you can avoid the same outcome."},
                ]
            },
        ]
    },

    # ── RECOVERING ────────────────────────────────────────────────────────────
    {
        "email": "binta.touray@aminacare.dev", "password": "Amina2026",
        "name": "Binta Touray", "age": 38, "gender": "female",
        "region": "Banjul", "conditions": ["respiratory"],
        "language": "english",
        "profile": {
            "medications": [
                {"name": "Salbutamol inhaler", "dosage": "100mcg", "frequency": "2 puffs as needed"},
                {"name": "Beclomethasone inhaler", "dosage": "100mcg", "frequency": "2 puffs twice daily"},
            ],
            "last_bp": "118/76", "last_glucose": None,
            "key_facts": [
                "Moderate persistent asthma, triggered by dust and harmattan",
                "Had severe exacerbation requiring hospitalisation last harmattan season",
                "Now using preventative inhaler (Beclomethasone) — adherent",
                "Teacher — cannot miss school, highly motivated",
                "Trajectory: improving — symptom days reducing",
            ],
            "triage_status": "SELF_CARE",
        },
        "caregiver_specialty": "Paediatric",
        "consultations": [
            {
                "dago": 180, "triage": "FACILITY",
                "summary": "Severe asthma exacerbation during harmattan. Peak flow <40% predicted. Hospital admission for nebulisation and oral steroids. Preventative inhaler prescribed on discharge.",
                "symptoms": ["severe wheezing", "dyspnoea at rest", "peak flow 38%", "cyanosis mild"],
                "recs": ["Hospital admission", "Nebulisation", "Start Beclomethasone 100mcg BD on discharge", "Avoid dusty environments"],
                "messages": [
                    {"role":"user","content":"AMINA I can barely breathe. I've used my inhaler 4 times in 2 hours."},
                    {"role":"assistant","content":"Using reliever inhaler more than 3 times in an hour means your asthma is not controlled. Can you measure your peak flow?"},
                    {"role":"user","content":"38%. My lips are a little blue."},
                    {"role":"assistant","content":"This is a severe asthma attack. You need hospital treatment right now — go immediately, or call for help. Do not wait. Take your inhaler once more on the way but go NOW."},
                ]
            },
            {
                "dago": 140, "triage": "CHW_VISIT",
                "summary": "Post-discharge 6-week check. Using Beclomethasone twice daily as prescribed. Peak flow improved to 72%. Symptom days reduced from daily to 3 per week.",
                "symptoms": ["mild wheeze mornings", "reduced exercise tolerance"],
                "recs": ["Continue preventative inhaler consistently", "Avoid morning dust", "Record symptom diary"],
                "messages": [
                    {"role":"user","content":"Better than last month. Peak flow 72%."},
                    {"role":"assistant","content":"72% is a real improvement from 38% at admission. How many days this week did you have symptoms?"},
                    {"role":"user","content":"About 3 days — mostly in the mornings."},
                    {"role":"assistant","content":"Morning symptoms often mean overnight inflammation. Are you taking the Beclomethasone both morning and night without skipping?"},
                    {"role":"user","content":"Yes, I set an alarm for both."},
                    {"role":"assistant","content":"That discipline is exactly why you are improving. Keep going."},
                ]
            },
            {
                "dago": 90, "triage": "SELF_CARE",
                "summary": "Continuing improvement. Peak flow 84%. Symptom days down to 1 per week. No reliever inhaler use in past 2 weeks. Harmattan season approaching — action plan reviewed.",
                "symptoms": ["occasional morning wheeze"],
                "recs": ["Excellent progress — maintain preventative inhaler", "Wear dust mask during harmattan", "Know when to escalate: >3 puffs reliever in 1 hour"],
                "messages": [
                    {"role":"user","content":"I have been so good! No reliever for 2 weeks. Peak flow 84%."},
                    {"role":"assistant","content":"That is excellent — 84% peak flow with no reliever use in 2 weeks is approaching full control. How are you managing dust at school?"},
                    {"role":"user","content":"I close the classroom windows during morning dust."},
                    {"role":"assistant","content":"Smart adaptation. Harmattan is coming in about 6 weeks — we should review your action plan so you know exactly what to do if symptoms spike."},
                ]
            },
            {
                "dago": 45, "triage": "SELF_CARE",
                "summary": "Harmattan arrived. Patient proactively wearing dust mask and increased Beclomethasone to 2 puffs TDS as discussed in action plan. Peak flow maintained at 80%. No hospital visit needed this year.",
                "symptoms": ["mild dust-triggered wheeze, managed"],
                "recs": ["Continue action plan", "Well done on prevention", "Reduce back to BD when harmattan passes"],
                "messages": [
                    {"role":"user","content":"Harmattan is heavy but I am managing. Wearing the mask, taking extra inhaler as planned. Peak flow 80%."},
                    {"role":"assistant","content":"This is a completely different outcome from last year. You planned ahead and you are executing it perfectly. How do you feel?"},
                    {"role":"user","content":"Good! I taught school all week. Last year I was hospitalised."},
                    {"role":"assistant","content":"That comparison says everything. You have turned a hospitalisation into a well-managed season. This is what good asthma control looks like."},
                ]
            },
        ]
    },

    # ── STROKE RECOVERY ──────────────────────────────────────────────────────
    {
        "email": "dawda.ceesay@aminacare.dev", "password": "Amina2026",
        "name": "Dawda Ceesay", "age": 63, "gender": "male",
        "region": "Lower River", "conditions": ["heart_disease", "hypertension"],
        "language": "english",
        "profile": {
            "medications": [
                {"name": "Aspirin", "dosage": "75mg", "frequency": "Once daily with food"},
                {"name": "Atorvastatin", "dosage": "40mg", "frequency": "Once daily evening"},
                {"name": "Amlodipine", "dosage": "5mg", "frequency": "Once daily"},
                {"name": "Clopidogrel", "dosage": "75mg", "frequency": "Once daily"},
            ],
            "last_bp": "138/86", "last_glucose": "5.8",
            "key_facts": [
                "Ischaemic stroke 4 months ago — left-sided weakness recovering",
                "On dual antiplatelet therapy for 12 months post-stroke",
                "Physical therapy 3x/week — improving hand grip",
                "Lives with family, good support",
                "BP well controlled on Amlodipine",
                "No smoking, no alcohol",
            ],
            "triage_status": "SELF_CARE",
        },
        "caregiver_specialty": "Elderly Care",
        "consultations": [
            {
                "dago": 135, "triage": "FACILITY",
                "summary": "Acute ischaemic stroke. Left-sided weakness, facial droop, slurred speech. Admitted via emergency. CT confirmed. Thrombolysis not given (arrived 6h after onset). Started on aspirin + statin + BP control.",
                "symptoms": ["sudden left arm weakness", "facial droop", "slurred speech", "onset 6 hours prior"],
                "recs": ["Hospital admission", "Aspirin 300mg loading", "Atorvastatin 40mg", "BP monitoring — target <140/90"],
                "messages": [
                    {"role":"user","content":"This is his wife. He suddenly couldn't move his left arm and his face looks drooped. He's confused."},
                    {"role":"assistant","content":"This sounds like a stroke — face drooping and arm weakness are classic signs. How long ago did this start?"},
                    {"role":"user","content":"About 2 hours ago. We were scared to call."},
                    {"role":"assistant","content":"You must go to hospital immediately — stroke treatment is time-critical. Call for transport now. Tell them he has a stroke with face drop and arm weakness. This is an emergency."},
                ]
            },
            {
                "dago": 100, "triage": "CHW_VISIT",
                "summary": "6-week post-stroke review. Left hand grip improving (3/5 strength). Walking with support. BP 146/90 — Amlodipine dose optimised. All medications taken faithfully.",
                "symptoms": ["residual left hand weakness", "mild speech hesitancy"],
                "recs": ["Continue all 4 medications", "Physical therapy 3x/week", "BP target <140/90", "Weekly check"],
                "messages": [
                    {"role":"user","content":"I am walking a little now with support. Hand grip getting better slowly."},
                    {"role":"assistant","content":"Left-sided recovery takes time but it is happening. Are you doing the physiotherapy exercises every day?"},
                    {"role":"user","content":"3 times a week at the clinic and exercises at home."},
                    {"role":"assistant","content":"Excellent. The recovery you have shows the brain is healing. The most important thing to prevent a second stroke is BP control and taking all 4 medications without fail."},
                ]
            },
            {
                "dago": 65, "triage": "SELF_CARE",
                "summary": "3-month post-stroke. Walking independently short distances. Hand grip 4/5. Speech near normal. BP 138/86 — well controlled. Aspirin + Clopidogrel continued.",
                "symptoms": ["mild hand weakness persisting"],
                "recs": ["Continue dual antiplatelet therapy for 12 months total", "Continue BP control", "Light activity encouraged"],
                "messages": [
                    {"role":"user","content":"I walked to the market today by myself. First time since the stroke."},
                    {"role":"assistant","content":"Walking to the market independently at 3 months is a major milestone. How is your hand?"},
                    {"role":"user","content":"4/5 strength now. Still drops things sometimes."},
                    {"role":"assistant","content":"4/5 at 3 months is very good progress. Keep doing the grip exercises — squeezing a ball for 10 minutes twice daily will help the remaining weakness."},
                ]
            },
            {
                "dago": 20, "triage": "SELF_CARE",
                "summary": "4-month review. Near-full functional recovery. Walking normally. Hand grip 5/5 right, 4/5 left. BP consistently 136-142/84-88. Excellent adherence. Neurologist pleased.",
                "symptoms": ["occasional fatigue on exertion"],
                "recs": ["Continue all medications", "Increase walking distance gradually", "Maintain low-salt diet", "Annual stroke review"],
                "messages": [
                    {"role":"user","content":"Neurologist said very good recovery. BP steady at 138/86."},
                    {"role":"assistant","content":"Near-full recovery from an ischaemic stroke in 4 months is a real success. Your commitment to physiotherapy and medication has made this possible."},
                    {"role":"user","content":"I am grateful. I thought I would never walk again."},
                    {"role":"assistant","content":"Your hard work recovered this. The next priority is preventing a second stroke — and you are doing everything right for that. Keep going."},
                ]
            },
        ]
    },

    # ── MENTAL HEALTH + CHRONIC DISEASE ──────────────────────────────────────
    {
        "email": "sira.drammeh@aminacare.dev", "password": "Amina2026",
        "name": "Sira Drammeh", "age": 35, "gender": "female",
        "region": "Kanifing", "conditions": ["hypertension"],
        "language": "english",
        "profile": {
            "medications": [
                {"name": "Amlodipine", "dosage": "5mg", "frequency": "Once daily"},
            ],
            "last_bp": "145/94", "last_glucose": None,
            "key_facts": [
                "Moderate depression complicating hypertension management",
                "Recently widowed — husband died 8 months ago",
                "3 young children, financial strain",
                "Stops medication when 'feeling hopeless'",
                "Community mental health referral accepted",
                "Good days and bad days — engagement variable",
            ],
            "triage_status": "CHW_VISIT",
        },
        "caregiver_specialty": "Mental Health",
        "consultations": [
            {
                "dago": 150, "triage": "CHW_VISIT",
                "summary": "First contact post-bereavement. Patient not taking Amlodipine. BP 158/102. Significant low mood, sleep disturbance, appetite poor. PHQ-9 score 16 (moderate-severe depression). Referred to community MH.",
                "symptoms": ["low mood", "sleep disturbance", "appetite loss", "headache", "BP 158/102"],
                "recs": ["Urgent MH referral", "CHW regular visits", "Restart Amlodipine", "Grief support group"],
                "messages": [
                    {"role":"user","content":"AMINA I don't see the point of anything. Since my husband passed I can't take care of myself."},
                    {"role":"assistant","content":"I am so sorry for your loss. It sounds like you are going through a very difficult time. It is completely understandable to struggle after losing your husband. Can you tell me more about how you have been feeling day to day?"},
                    {"role":"user","content":"I don't sleep. I don't eat properly. The children are managing but I can't."},
                    {"role":"assistant","content":"What you are describing — not sleeping, not eating, feeling like you can't cope — sounds like grief combined with depression. This is a health condition, not weakness, and there is support available. Have you stopped your blood pressure tablets?"},
                    {"role":"user","content":"Yes. I forget and also I don't care."},
                    {"role":"assistant","content":"I hear you. Let's take this one step at a time. Your caregiver will visit you this week. I am also going to connect you with the community mental health support team. You do not have to manage this alone."},
                ]
            },
            {
                "dago": 120, "triage": "CHW_VISIT",
                "summary": "MH counsellor visit twice. Patient slightly better engagement. Still inconsistent with Amlodipine. PHQ-9 score 12 (moderate depression). BP 152/98. Children helping with reminders.",
                "symptoms": ["persistent low mood", "fatigue", "inconsistent medication"],
                "recs": ["MH counsellor continue sessions", "Children to remind about morning tablet", "Simple meal plan support"],
                "messages": [
                    {"role":"user","content":"I saw the counsellor. It helped a little. I am trying."},
                    {"role":"assistant","content":"I am really proud of you for going. What did you talk about?"},
                    {"role":"user","content":"About my husband. About the children. About feeling like a burden."},
                    {"role":"assistant","content":"You are not a burden — you are a mother doing her best in incredibly difficult circumstances. Your children need you here and healthy. Taking your tablet each morning is one small thing you can do for them and for yourself."},
                ]
            },
            {
                "dago": 80, "triage": "SELF_CARE",
                "summary": "Meaningful improvement. PHQ-9 score 8 (mild depression). Taking Amlodipine most days. BP improved to 145/94. Joined women's support group at community centre. Starting to cook again.",
                "symptoms": ["mild fatigue", "occasional low mood"],
                "recs": ["Continue MH sessions", "Continue Amlodipine", "Maintain social connections", "Monthly BP review"],
                "messages": [
                    {"role":"user","content":"I joined the women's group at the community centre. It helps to talk."},
                    {"role":"assistant","content":"That is a big step and a good one. How are you sleeping?"},
                    {"role":"user","content":"Better. 5-6 hours most nights now."},
                    {"role":"assistant","content":"Better sleep is a sign the depression is lifting. And your BP is 145/94 — improved from where you were. You are doing so much better than 3 months ago."},
                ]
            },
            {
                "dago": 30, "triage": "SELF_CARE",
                "summary": "Good progress. PHQ-9 score 5 (minimal depression). BP 138/88 — close to target. Taking medication consistently. Returned to part-time work as seamstress. Full of her own",
                "symptoms": [],
                "recs": ["Maintain current plan", "Continue group support", "3-monthly BP review", "Praise adherence progress"],
                "messages": [
                    {"role":"user","content":"AMINA I started sewing again. I got a small order this week."},
                    {"role":"assistant","content":"That is wonderful news. Returning to your work is such a positive sign. How are you feeling overall?"},
                    {"role":"user","content":"Better. Not happy all the time but I am coping. I take my tablet every morning now."},
                    {"role":"assistant","content":"Every morning tablet means your BP is 138/88 — nearly at target. You have come so far since we first spoke 5 months ago. You did this."},
                ]
            },
        ]
    },

    # ── MATERNAL HEALTH HIGH-RISK ─────────────────────────────────────────────
    {
        "email": "isatou.njie@aminacare.dev", "password": "Amina2026",
        "name": "Isatou Njie", "age": 29, "gender": "female",
        "region": "West Coast", "conditions": ["hypertension"],
        "language": "english",
        "profile": {
            "medications": [
                {"name": "Methyldopa", "dosage": "250mg", "frequency": "Three times daily"},
                {"name": "Folic acid", "dosage": "5mg", "frequency": "Once daily"},
                {"name": "Ferrous sulphate", "dosage": "200mg", "frequency": "Once daily"},
            ],
            "last_bp": "148/96", "last_glucose": "5.4",
            "key_facts": [
                "30 weeks pregnant — gestational hypertension",
                "Previous pregnancy: pre-eclampsia at 34 weeks",
                "On Methyldopa for BP control in pregnancy",
                "Swelling of hands and face noted this week",
                "Urine protein trace-positive last check",
                "Weekly ANC visits at health centre",
                "RISK: pre-eclampsia progression",
            ],
            "triage_status": "FACILITY",
        },
        "caregiver_specialty": "Maternal",
        "consultations": [
            {
                "dago": 100, "triage": "CHW_VISIT",
                "summary": "20-week ANC: BP 128/82, urine clear. Started on low-dose aspirin for pre-eclampsia prevention given previous history. Iron + folic acid supplementation confirmed.",
                "symptoms": [],
                "recs": ["Low-dose aspirin 75mg nightly until 36 weeks", "Continue iron + folic acid", "ANC monthly"],
                "messages": [
                    {"role":"user","content":"AMINA, I am 20 weeks pregnant. My last baby had pre-eclampsia."},
                    {"role":"assistant","content":"Thank you for telling me — this is important to track carefully. With a history of pre-eclampsia, you are higher risk. Has the midwife started you on low-dose aspirin?"},
                    {"role":"user","content":"Yes, 75mg at night."},
                    {"role":"assistant","content":"Good — aspirin from 12-36 weeks significantly reduces the risk of pre-eclampsia recurring. Keep taking it every night without fail."},
                ]
            },
            {
                "dago": 65, "triage": "CHW_VISIT",
                "summary": "26 weeks: BP rising to 138/90. Methyldopa 250mg TDS started. Urine trace protein. Weekly monitoring plan initiated. Patient counselled on warning signs.",
                "symptoms": ["mild headache", "BP 138/90", "trace proteinuria"],
                "recs": ["Start Methyldopa 250mg TDS", "Weekly BP + urine check", "Warn signs: severe headache, visual disturbance, epigastric pain"],
                "messages": [
                    {"role":"user","content":"Midwife says BP is 138/90 and there's a little protein in my urine."},
                    {"role":"assistant","content":"This is gestational hypertension with early proteinuria — it needs close monitoring. The midwife is right to act. How are you feeling — any headaches or visual changes?"},
                    {"role":"user","content":"Mild headache sometimes."},
                    {"role":"assistant","content":"I need you to report immediately if: the headache becomes severe, your vision blurs, or you get pain just below your ribs on the right side. These are warning signs of pre-eclampsia and need emergency care."},
                ]
            },
            {
                "dago": 35, "triage": "FACILITY",
                "summary": "30 weeks: BP 148/96, 2+ proteinuria, hand/face swelling, severe headache overnight. Criteria for pre-eclampsia met. Referred for admission. Magnesium sulphate protocol initiated.",
                "symptoms": ["severe headache", "facial and hand swelling", "BP 148/96", "2+ proteinuria", "visual disturbance mild"],
                "recs": ["URGENT facility admission", "Pre-eclampsia protocol", "Magnesium sulphate seizure prophylaxis", "Fetal monitoring"],
                "messages": [
                    {"role":"user","content":"AMINA my head is pounding and my hands are very swollen. This started last night."},
                    {"role":"assistant","content":"This sounds like pre-eclampsia. What is your BP reading?"},
                    {"role":"user","content":"148/96. My face is puffy too."},
                    {"role":"assistant","content":"Severe headache + swelling + BP above 140/90 with your history is a pre-eclampsia emergency. You need to go to hospital RIGHT NOW. Take everything — they may deliver the baby early if needed. Go immediately."},
                ]
            },
            {
                "dago": 10, "triage": "SELF_CARE",
                "summary": "Admitted at 30 weeks, magnesium sulphate given. Delivered at 32 weeks by C-section — healthy baby girl 1.85kg. Patient recovering. BP normalising post-delivery. Baby in neonatal unit, stable.",
                "symptoms": ["post-operative fatigue", "wound healing well"],
                "recs": ["Continue BP monitoring post-delivery", "Breastfeeding support", "Baby neonatal follow-up", "Post-partum depression screen at 6 weeks"],
                "messages": [
                    {"role":"user","content":"AMINA, the baby came at 32 weeks. She is small but the doctors say she is okay. I am recovering from the C-section."},
                    {"role":"assistant","content":"Congratulations on your daughter! A 32-week baby in neonatal care is scary but 1.85kg is a good weight for 32 weeks. How are you feeling?"},
                    {"role":"user","content":"Tired and worried about her."},
                    {"role":"assistant","content":"Your worry is completely natural. The neonatal team will look after her well. You focus on recovering and if you are able to express milk, even small amounts will help her development. Your BP should normalise over the next few weeks."},
                ]
            },
        ]
    },

    # ── NEW DIAGNOSIS — YOUNG ADULT ───────────────────────────────────────────
    {
        "email": "yusupha.jobarteh@aminacare.dev", "password": "Amina2026",
        "name": "Yusupha Jobarteh", "age": 27, "gender": "male",
        "region": "Kanifing", "conditions": ["diabetes"],
        "language": "english",
        "profile": {
            "medications": [
                {"name": "Metformin", "dosage": "500mg", "frequency": "Twice daily with meals"},
            ],
            "last_bp": "122/78", "last_glucose": "12.4",
            "key_facts": [
                "Newly diagnosed Type 1 diabetes (age 27)",
                "Extremely shocked and in denial at diagnosis",
                "Active lifestyle — plays football twice a week",
                "Fear about insulin injections — avoidant",
                "Currently on Metformin trial — will likely need insulin",
                "Well-educated, IT professional",
            ],
            "triage_status": "CHW_VISIT",
        },
        "caregiver_specialty": "Chronic Disease",
        "consultations": [
            {
                "dago": 90, "triage": "CHW_VISIT",
                "summary": "New diagnosis. Glucose 18.2 at presentation. Type 1 suspected (age, BMI, anti-GAD pending). Started on Metformin as bridge. Patient in shock and denial. Extensive education session.",
                "symptoms": ["extreme thirst", "frequent urination", "weight loss 4kg in 2 months", "fatigue"],
                "recs": ["Start Metformin 500mg BD", "Self-monitoring glucose 3x/day", "Diabetes education", "Anti-GAD antibody test", "Dietitian referral"],
                "messages": [
                    {"role":"user","content":"AMINA the doctor said I have diabetes. I am only 27. I don't understand. I exercise and eat well."},
                    {"role":"assistant","content":"I can hear how shocking this is. Diabetes at 27 is not your fault — Type 1 diabetes is an autoimmune condition where the immune system attacks insulin-producing cells. It has nothing to do with lifestyle or diet."},
                    {"role":"user","content":"But I play football! I'm not fat!"},
                    {"role":"assistant","content":"Exactly — that's why we suspect Type 1, not Type 2. Type 1 affects people of any weight and fitness level. The blood test results will confirm. Right now, Metformin will help while we get the full picture."},
                ]
            },
            {
                "dago": 65, "triage": "CHW_VISIT",
                "summary": "Anti-GAD positive — confirms Type 1 diabetes. Insulin discussed but patient refusing. Glucose 14.6 on Metformin alone — insufficient control. C-peptide very low. Insulin training session offered.",
                "symptoms": ["continued thirst", "mild fatigue", "glucose 14.6"],
                "recs": ["Insulin initiation needed — patient counselling", "Fear normalisation", "Peer support contact arranged (another T1D young adult)"],
                "messages": [
                    {"role":"user","content":"Results came back. They said it is Type 1 for sure. Now they want to give me insulin injections. I am not doing injections."},
                    {"role":"assistant","content":"I understand the fear. Can you tell me what specifically worries you about insulin?"},
                    {"role":"user","content":"The needles. And that it means I am really sick. And I will need it forever."},
                    {"role":"assistant","content":"Those are real concerns and they make sense. The needles are very thin — thinner than a hair. Many people with Type 1 who play sport, travel, have careers use insulin daily and it becomes as routine as brushing teeth. Refusing insulin with Type 1 means your glucose will keep rising and that is what makes you really sick."},
                ]
            },
            {
                "dago": 40, "triage": "CHW_VISIT",
                "summary": "Patient met a young T1D footballer through peer support. Now agreeing to insulin. Basal insulin (Glargine 10 units at bedtime) initiated. Glucose 11.2 after first week.",
                "symptoms": ["mild injection site soreness", "glucose 11.2 improving"],
                "recs": ["Continue Glargine 10u nightly", "Titrate by 2u if fasting glucose >7 for 3 days", "Carry glucose gel for hypoglycaemia", "Monitor before football"],
                "messages": [
                    {"role":"user","content":"I met Baboucarr — the guy you connected me with. He plays football with T1D. It changed my mind. I started the injection."},
                    {"role":"assistant","content":"That is a huge step. How was the first injection?"},
                    {"role":"user","content":"Not bad actually. I barely felt it. Glucose this morning was 11.2."},
                    {"role":"assistant","content":"11.2 is already better than 14-18. You will notice energy improving as glucose comes down. Before football — check your glucose. If below 7, eat a small snack before playing."},
                ]
            },
            {
                "dago": 10, "triage": "SELF_CARE",
                "summary": "1-month insulin review. Fasting glucose 7.4 average. Playing football again. One mild hypo (4.2) after game — managed with glucose gel correctly. Patient confident and engaged.",
                "symptoms": ["well controlled"],
                "recs": ["Continue Glargine, consider adding fast-acting at meals", "HbA1c at 3 months", "Football protocol: check before, eat if <7, recheck after", "Celebrate progress"],
                "messages": [
                    {"role":"user","content":"I played football last week! Checked glucose before — 6.8. Had a small banana. Felt great."},
                    {"role":"assistant","content":"That is exactly the right protocol. You are learning your body beautifully. How do you feel about your diabetes now versus 3 months ago?"},
                    {"role":"user","content":"It's still scary but I feel like I can manage it. I'm not angry anymore."},
                    {"role":"assistant","content":"That shift — from 'why me' to 'I can manage this' — is the most important milestone. Your glucose is improving, you are playing football, you are taking insulin correctly. You are thriving with Type 1."},
                ]
            },
        ]
    },

    # ── ELDERLY MULTI-MORBIDITY STABLE ────────────────────────────────────────
    {
        "email": "haddijatou.camara@aminacare.dev", "password": "Amina2026",
        "name": "Haddijatou Camara", "age": 74, "gender": "female",
        "region": "Upper River", "conditions": ["hypertension", "diabetes", "kidney_disease"],
        "language": "mandinka",
        "profile": {
            "medications": [
                {"name": "Amlodipine", "dosage": "5mg", "frequency": "Once daily"},
                {"name": "Lisinopril", "dosage": "5mg", "frequency": "Once daily"},
                {"name": "Metformin", "dosage": "500mg", "frequency": "Once daily with dinner"},
                {"name": "Atorvastatin", "dosage": "10mg", "frequency": "Once daily evening"},
            ],
            "last_bp": "136/82", "last_glucose": "8.1",
            "key_facts": [
                "Elderly — age 74, multiple comorbidities (HTN + DM + CKD Stage 3)",
                "CKD stage 3 — Metformin dose reduced, no NSAIDs",
                "Well-controlled despite complexity — model adherence",
                "Daughter administers all medications daily",
                "Monthly renal panel and HbA1c quarterly",
                "Mandinka speaker — family translate",
                "BP consistently 130-140/80-90 over 18 months",
            ],
            "triage_status": "SELF_CARE",
        },
        "caregiver_specialty": "Elderly Care",
        "consultations": [
            {
                "dago": 130, "triage": "SELF_CARE",
                "summary": "Quarterly review. BP 136/82, glucose 8.1, creatinine 178 (stable CKD3). HbA1c 7.4% — well within target for her age. All medications tolerated well. Daughter managing perfectly.",
                "symptoms": ["mild fatigue", "occasional joint pain"],
                "recs": ["Continue current regime unchanged", "Quarterly creatinine + HbA1c", "No NSAIDs for joint pain — use paracetamol only"],
                "messages": [
                    {"role":"user","content":"[Daughter] My mother is well. BP 136/82 this morning. Creatinine came back 178."},
                    {"role":"assistant","content":"178 for creatinine is stable compared to last quarter — CKD stage 3 is not progressing. That is very good news. How is she feeling in herself?"},
                    {"role":"user","content":"Good. She complains of knee pain sometimes."},
                    {"role":"assistant","content":"Important: with kidney disease, she must NOT take ibuprofen or diclofenac — these damage kidneys further. Only paracetamol 500mg twice daily for pain. Is the knee limiting her movement?"},
                ]
            },
            {
                "dago": 90, "triage": "SELF_CARE",
                "summary": "BP 138/84, glucose 7.8, creatinine 182 — stable. HbA1c 7.2%. Daughter continues excellent medication administration. Joint pain managed with paracetamol.",
                "symptoms": ["managed knee pain"],
                "recs": ["Stable — maintain current plan", "Paracetamol for pain", "Review in 3 months"],
                "messages": [
                    {"role":"user","content":"[Daughter] Another 3-month check. BP 138/84, glucose 7.8. HbA1c 7.2%."},
                    {"role":"assistant","content":"HbA1c 7.2% at age 74 with CKD is excellent management. You are doing everything right for your mother."},
                    {"role":"user","content":"She is happy. She says AMINA knows her well now."},
                    {"role":"assistant","content":"Tell her she is one of my most consistent patients — 18 months of stable results is a remarkable achievement at her age and complexity."},
                ]
            },
            {
                "dago": 40, "triage": "CHW_VISIT",
                "summary": "Creatinine 212 — mild rise from 182. Review medications. Metformin held temporarily pending renal review. CHW home visit to assess hydration and diet.",
                "symptoms": ["mild nausea", "reduced appetite"],
                "recs": ["Hold Metformin until creatinine confirmed", "Increase water intake", "CHW home visit", "Renal review in 2 weeks"],
                "messages": [
                    {"role":"user","content":"[Daughter] Creatinine 212 this time — higher than before. Doctor said to check with you."},
                    {"role":"assistant","content":"212 is a rise from 182 — this needs careful attention. Has she been eating and drinking normally? Any vomiting or diarrhoea?"},
                    {"role":"user","content":"She has had reduced appetite for 2 weeks. Not drinking much."},
                    {"role":"assistant","content":"Dehydration is the most likely cause — it concentrates the creatinine. We should hold Metformin for now to protect the kidneys. I am arranging a CHW home visit today. Can you ensure she drinks at least 6 glasses of water today?"},
                ]
            },
        ]
    },

    # ── HIV/AIDS STABLE ON ART ────────────────────────────────────────────────
    {
        "email": "aminata.bah@aminacare.dev", "password": "Amina2026",
        "name": "Aminata Bah", "age": 41, "gender": "female",
        "region": "North Bank", "conditions": ["hypertension"],
        "language": "english",
        "profile": {
            "medications": [
                {"name": "TDF/3TC/DTG (Dolutegravir)", "dosage": "300/300/50mg", "frequency": "Once daily"},
                {"name": "Amlodipine", "dosage": "5mg", "frequency": "Once daily"},
            ],
            "last_bp": "134/86", "last_glucose": "5.2",
            "key_facts": [
                "HIV-positive — on 1st-line ART (TDF/3TC/DTG) for 3 years",
                "Viral load undetectable for 2 years",
                "CD4 count 680 (excellent immune reconstitution)",
                "Concurrent hypertension — well controlled",
                "Stigma concern — private about HIV status",
                "Works as seamstress, financially stable",
                "100% adherent to ART — model patient",
            ],
            "triage_status": "SELF_CARE",
        },
        "caregiver_specialty": "HIV/AIDS",
        "consultations": [
            {
                "dago": 140, "triage": "SELF_CARE",
                "summary": "6-month ART review. Viral load undetectable. CD4 680. BP 134/86 on Amlodipine. No opportunistic infections. Patient thriving. Confidentiality reinforced.",
                "symptoms": [],
                "recs": ["Continue TDF/3TC/DTG daily without interruption", "6-monthly viral load", "Continue Amlodipine"],
                "messages": [
                    {"role":"user","content":"AMINA, my viral load is undetectable again. CD4 680."},
                    {"role":"assistant","content":"Undetectable viral load and CD4 of 680 is an excellent result — your immune system has fully recovered. How are you feeling?"},
                    {"role":"user","content":"Very well. No side effects. I never miss a dose."},
                    {"role":"assistant","content":"Your perfect adherence is the reason for these results. Undetectable means you also cannot transmit the virus to others — this is called U=U. You are protecting yourself and others through your discipline."},
                ]
            },
            {
                "dago": 80, "triage": "SELF_CARE",
                "summary": "Annual comprehensive review. Viral load undetectable. CD4 710. Lipid profile normal. Renal function normal (TDF monitoring). BP 136/84. Weight stable. Emotional wellbeing good.",
                "symptoms": [],
                "recs": ["Continue ART unchanged", "Annual lipid + renal panel", "Cervical cancer screening arranged (HIV-positive women higher risk)"],
                "messages": [
                    {"role":"user","content":"All my annual tests are back. The doctor says everything is normal."},
                    {"role":"assistant","content":"Everything normal at your 3-year ART mark is a real achievement. Has the cervical screening been arranged?"},
                    {"role":"user","content":"Yes, next month."},
                    {"role":"assistant","content":"Good. Women on ART should have cervical screening annually given slightly higher risk. Your lipid and renal results show the DTG-based regimen is very well tolerated."},
                ]
            },
            {
                "dago": 20, "triage": "SELF_CARE",
                "summary": "Routine check. Patient reports colleague asking intrusive questions about her medication. Emotional support provided. Stigma navigation discussed. Viral load undetectable. All stable.",
                "symptoms": ["emotional stress from stigma incident"],
                "recs": ["Continue ART", "Stigma coping strategies", "Know your rights — HIV disclosure is voluntary"],
                "messages": [
                    {"role":"user","content":"AMINA, a woman at work saw my tablet and asked what it was for. I panicked."},
                    {"role":"assistant","content":"That is a stressful moment. You are not obligated to disclose your HIV status to anyone — not your employer, not colleagues. How did you handle it?"},
                    {"role":"user","content":"I said it was for blood pressure. She accepted that."},
                    {"role":"assistant","content":"That was a completely valid response — Amlodipine is also for blood pressure, and you do take it. Your privacy is your right. You handled it well."},
                ]
            },
        ]
    },

    # ── MALNUTRITION / CHILD PROXY ────────────────────────────────────────────
    {
        "email": "momodou.ceesay.father@aminacare.dev", "password": "Amina2026",
        "name": "Momodou Ceesay (father — child proxy)", "age": 32, "gender": "male",
        "region": "Central River", "conditions": [],
        "language": "english",
        "profile": {
            "medications": [],
            "last_bp": None, "last_glucose": None,
            "key_facts": [
                "Reporting for son Ebrima Ceesay, age 3",
                "Child: moderate acute malnutrition (MUAC 11.2cm)",
                "On RUTF (Ready-to-Use Therapeutic Food) programme",
                "Father is primary carer — mother working away",
                "Consistent RUTF feeding, improving MUAC",
                "Rural area — 2 hours from health facility",
                "Child completing 8-week therapeutic feeding",
            ],
            "triage_status": "CHW_VISIT",
        },
        "caregiver_specialty": "Nutrition",
        "consultations": [
            {
                "dago": 70, "triage": "CHW_VISIT",
                "summary": "Child Ebrima, 3yo, enrolled in outpatient therapeutic programme. MUAC 11.2cm (moderate acute malnutrition). Started on RUTF (3 sachets/day). No complications. Father educated on feeding.",
                "symptoms": ["reduced appetite", "weight below growth curve", "MUAC 11.2cm"],
                "recs": ["RUTF 3 sachets/day", "Exclusive RUTF — no other food for first week", "CHW weekly weight check", "Return immediately if child stops eating or fever"],
                "messages": [
                    {"role":"user","content":"AMINA, I came to the health post with my son Ebrima. He is 3 years. They said his arm is too small. 11.2."},
                    {"role":"assistant","content":"11.2cm MUAC means Ebrima has moderate acute malnutrition — he is not getting enough nutrients. The good news is this is treatable at home. Has the nurse given you the RUTF sachets?"},
                    {"role":"user","content":"Yes, they gave us a box."},
                    {"role":"assistant","content":"Good. Give him 3 sachets every day. Each sachet is a complete meal — nutrients, protein, energy. The first week, give only RUTF and water — no other food. Let him eat at his own pace. How is his appetite?"},
                ]
            },
            {
                "dago": 50, "triage": "CHW_VISIT",
                "summary": "2-week review. Ebrima eating RUTF well. MUAC improved to 11.8cm. Weight up 0.3kg. Father very engaged. No fever or complications. Continue programme.",
                "symptoms": ["mild reduced appetite (improving)"],
                "recs": ["Continue RUTF 3 sachets/day", "Now can introduce family food alongside RUTF", "Weekly weight check"],
                "messages": [
                    {"role":"user","content":"AMINA, good news — Ebrima is eating the packets well. MUAC today 11.8."},
                    {"role":"assistant","content":"11.8 from 11.2 in 2 weeks is very good progress. That 0.6cm improvement means his nutrition status is improving. Is he eating all 3 sachets every day?"},
                    {"role":"user","content":"Yes, even sometimes he asks for them."},
                    {"role":"assistant","content":"That is excellent — his appetite is coming back, which is a sign his body is responding. From this week, you can start giving family food alongside the RUTF — small amounts of porridge or mashed food."},
                ]
            },
            {
                "dago": 25, "triage": "SELF_CARE",
                "summary": "6-week review. MUAC 12.4cm — approaching discharge threshold (>12.5cm). Weight 11.2kg. Eating well. Father maintaining feeding schedule. Expected discharge from programme next week.",
                "symptoms": [],
                "recs": ["Nearly complete — MUAC 12.4cm", "One more week of RUTF", "Transition to fortified family foods", "Continue growth monitoring monthly"],
                "messages": [
                    {"role":"user","content":"AMINA, Ebrima MUAC is 12.4 now!"},
                    {"role":"assistant","content":"12.4cm is just 0.1 below the discharge threshold — he is almost recovered! How does he look compared to 6 weeks ago?"},
                    {"role":"user","content":"He is more active. He is playing now. He was very quiet before."},
                    {"role":"assistant","content":"A child playing is the best sign of recovery. One more week of RUTF and then he will be discharged from the programme — but keep up monthly growth monitoring so we catch any problems early."},
                ]
            },
        ]
    },

    # ── TUBERCULOSIS ON TREATMENT ─────────────────────────────────────────────
    {
        "email": "bakary.sanyang@aminacare.dev", "password": "Amina2026",
        "name": "Bakary Sanyang", "age": 31, "gender": "male",
        "region": "Central River", "conditions": [],
        "language": "english",
        "profile": {
            "medications": [
                {"name": "Rifampicin", "dosage": "600mg", "frequency": "Once daily fasting (phase 2)"},
                {"name": "Isoniazid", "dosage": "300mg", "frequency": "Once daily"},
            ],
            "last_bp": "116/72", "last_glucose": None,
            "key_facts": [
                "Pulmonary TB — confirmed smear-positive",
                "Month 5 of 6-month DOTS course — near completion",
                "Phase 2 (continuation): Rifampicin + Isoniazid only",
                "Sputum smear now negative (converted at month 2)",
                "Weight restored from 56kg (diagnosis) to 63kg",
                "Excellent DOTS adherence — community health worker observes doses",
                "Lives with elderly mother — household screened",
            ],
            "triage_status": "SELF_CARE",
        },
        "caregiver_specialty": "HIV/AIDS",
        "consultations": [
            {
                "dago": 155, "triage": "FACILITY",
                "summary": "TB diagnosis confirmed. Smear +++ (highly infectious). Started on 4-drug HRZE (Rifampicin + Isoniazid + Pyrazinamide + Ethambutol). DOTS initiated. Household contacts screened.",
                "symptoms": ["3-month cough", "night sweats", "weight loss 7kg", "haemoptysis once", "positive smear"],
                "recs": ["Start HRZE phase 1", "DOTS community health worker assigned", "Isolate for 2 weeks", "Household contacts to clinic"],
                "messages": [
                    {"role":"user","content":"AMINA, I went to the clinic. They said TB. I have been coughing 3 months."},
                    {"role":"assistant","content":"I am sorry about the diagnosis, but finding it is the first step to curing it. Tuberculosis is curable with the right treatment. Have they started you on the tablets?"},
                    {"role":"user","content":"Yes, 4 tablets. They said I must take every day for 6 months."},
                    {"role":"assistant","content":"6 months every single day is essential — stopping early is the number one cause of treatment failure and drug resistance. The CHW will watch you take them each day (DOTS). This protects you and the community."},
                ]
            },
            {
                "dago": 110, "triage": "SELF_CARE",
                "summary": "Month 2 review. Sputum smear now NEGATIVE — conversion achieved. Cough much improved. Weight up 3kg (59kg). Switched to continuation phase: Rifampicin + Isoniazid only. DOTS continuing.",
                "symptoms": ["mild fatigue", "occasional cough (reducing)"],
                "recs": ["Phase 2: RH only", "Continue DOTS daily", "Monthly sputum", "Weight gain target: 65kg"],
                "messages": [
                    {"role":"user","content":"AMINA, sputum test came back negative! No more TB bacteria!"},
                    {"role":"assistant","content":"That is excellent news — sputum conversion at 2 months is a very good sign. You are no longer infectious. How is the cough?"},
                    {"role":"user","content":"Much less. And I've gained 3 kilos."},
                    {"role":"assistant","content":"Weight gain and cough reduction are exactly what we want to see. You are now on the easier 2-drug continuation phase — but do not stop taking them. 4 more months to complete the cure."},
                ]
            },
            {
                "dago": 50, "triage": "SELF_CARE",
                "summary": "Month 5 of 6. Weight 63kg (+7 from diagnosis). Sputum negative. No side effects. DOTS 100% adherence confirmed by CHW. Preparing for treatment completion certificate.",
                "symptoms": [],
                "recs": ["Final month of treatment", "Complete ALL remaining doses", "Post-treatment chest X-ray", "Advise: recurrence symptoms to report immediately"],
                "messages": [
                    {"role":"user","content":"AMINA, I am on my last month. CHW says I have not missed one dose."},
                    {"role":"assistant","content":"Zero missed doses in 5 months of TB treatment is an extraordinary achievement. You have cured yourself through that discipline. How do you feel compared to when we first spoke?"},
                    {"role":"user","content":"Like a different person. I gained 7 kg. I work again. I feel normal."},
                    {"role":"assistant","content":"Seven kilograms gained, smear negative, working again — this is what TB treatment success looks like. One more month. Don't stop. The treatment completion certificate recognises a real accomplishment."},
                ]
            },
        ]
    },

    # ── POST-PARTUM ANAEMIA ───────────────────────────────────────────────────
    {
        "email": "sainabou.fofana@aminacare.dev", "password": "Amina2026",
        "name": "Sainabou Fofana", "age": 24, "gender": "female",
        "region": "Kanifing", "conditions": [],
        "language": "english",
        "profile": {
            "medications": [
                {"name": "Ferrous sulphate", "dosage": "200mg", "frequency": "Twice daily with food"},
                {"name": "Folic acid", "dosage": "5mg", "frequency": "Once daily"},
            ],
            "last_bp": "104/68", "last_glucose": None,
            "key_facts": [
                "Post-partum haemorrhage 6 weeks ago (delivered 3.2kg baby boy)",
                "Haemoglobin 6.8g/dL at discharge — severe anaemia",
                "Current Hb improving: 9.2g/dL on iron supplements",
                "Exclusive breastfeeding — iron demand high",
                "Recovering well but tires easily",
                "Husband very supportive",
            ],
            "triage_status": "SELF_CARE",
        },
        "caregiver_specialty": "Maternal",
        "consultations": [
            {
                "dago": 55, "triage": "CHW_VISIT",
                "summary": "Post-partum day 5 — heavy bleeding reported at home after discharge. CHW assessment: lochia very heavy, pallor, tachycardia 110bpm. Referred immediately to facility.",
                "symptoms": ["heavy post-partum bleeding", "pallor", "dizziness", "tachycardia 110"],
                "recs": ["URGENT facility referral", "Potential PPH", "IV access needed"],
                "messages": [
                    {"role":"user","content":"AMINA I just had a baby 5 days ago. I am bleeding very heavily at home."},
                    {"role":"assistant","content":"Heavy bleeding after delivery is a medical emergency. Is the blood soaking more than one pad per hour?"},
                    {"role":"user","content":"Yes. I'm feeling very dizzy."},
                    {"role":"assistant","content":"This is a post-partum haemorrhage. You need to go to hospital immediately — call someone to take you NOW. Lie down, keep your legs raised if possible. Do not wait."},
                ]
            },
            {
                "dago": 40, "triage": "CHW_VISIT",
                "summary": "Post-hospitalisation. Received blood transfusion (2 units). Haemoglobin 6.8g/dL on discharge. Started on ferrous sulphate BD + folic acid. Baby breastfeeding well. Weekly Hb monitoring.",
                "symptoms": ["severe fatigue", "pallor", "shortness of breath on stairs"],
                "recs": ["Ferrous sulphate 200mg BD with food", "Folic acid 5mg daily", "Weekly Hb check", "Rest — limit heavy activity", "Iron-rich foods: leafy greens, meat, beans"],
                "messages": [
                    {"role":"user","content":"I am home. They gave me blood. My Hb was 6.8."},
                    {"role":"assistant","content":"6.8 is severely low — but you are now on iron supplements and have had a transfusion. How are you feeling?"},
                    {"role":"user","content":"Very tired. Can't climb stairs without stopping."},
                    {"role":"assistant","content":"Breathlessness on stairs at Hb 6.8 is expected — your blood is carrying much less oxygen than normal. The iron tablets will help but it takes 4-6 weeks to see significant improvement. Rest as much as possible."},
                ]
            },
            {
                "dago": 15, "triage": "SELF_CARE",
                "summary": "6-week post-partum. Hb improved to 9.2g/dL — significant recovery. Baby 5.1kg, thriving. Exclusive breastfeeding. Fatigue reducing. Continue iron + folic acid for 3 more months.",
                "symptoms": ["mild fatigue (improving)", "good energy on most days"],
                "recs": ["Continue iron + folic acid 3 months", "Target Hb >11 by 3 months", "Iron-rich diet important for breastfeeding", "Postnatal check at 3 months"],
                "messages": [
                    {"role":"user","content":"Hb came back 9.2! And baby is 5.1 kilos."},
                    {"role":"assistant","content":"9.2 from 6.8 in 4 weeks is excellent recovery — the iron tablets and rest are working. A baby gaining weight so well while breastfeeding means your milk is nourishing him beautifully despite your own low iron."},
                    {"role":"user","content":"I feel much better. I can walk normally again."},
                    {"role":"assistant","content":"Continue the iron for 3 more months to build your stores fully. Target is above 11. You handled a serious complication really well."},
                ]
            },
        ]
    },

    # ── SICKLE CELL DISEASE ───────────────────────────────────────────────────
    {
        "email": "adama.manneh@aminacare.dev", "password": "Amina2026",
        "name": "Adama Manneh", "age": 22, "gender": "male",
        "region": "Banjul", "conditions": [],
        "language": "english",
        "profile": {
            "medications": [
                {"name": "Hydroxyurea", "dosage": "500mg", "frequency": "Once daily"},
                {"name": "Folic acid", "dosage": "5mg", "frequency": "Once daily"},
                {"name": "Penicillin V", "dosage": "250mg", "frequency": "Twice daily (prophylaxis)"},
            ],
            "last_bp": "108/66", "last_glucose": None,
            "key_facts": [
                "Sickle cell disease (HbSS) — diagnosed age 5",
                "On Hydroxyurea — fetal haemoglobin being raised",
                "Crisis frequency reduced from 6-8/year to 2/year on Hydroxyurea",
                "Triggers: dehydration, cold, stress, infections",
                "University student — managing well",
                "Painful crisis last month, managed at home",
            ],
            "triage_status": "CHW_VISIT",
        },
        "caregiver_specialty": "Paediatric",
        "consultations": [
            {
                "dago": 100, "triage": "CHW_VISIT",
                "summary": "Painful crisis episode. Left arm and chest pain, 7/10 severity. Temperature 37.8°C. WBC normal — not infected. Managed at home with hydration and analgesia. Resolved in 3 days.",
                "symptoms": ["severe arm and chest pain 7/10", "low-grade fever 37.8", "crisis pattern"],
                "recs": ["Push fluids 3L/day", "Paracetamol + Ibuprofen alternating", "Warm compress", "Call if fever >38.5 or pain >8/10"],
                "messages": [
                    {"role":"user","content":"AMINA, crisis again. Left arm and chest pain. 7 out of 10."},
                    {"role":"assistant","content":"I am sorry — a crisis is very painful. Can you tell me: do you have fever, and did you check your temperature?"},
                    {"role":"user","content":"37.8°C. Not very high."},
                    {"role":"assistant","content":"37.8 is mildly elevated but not high enough to suggest infection. This sounds like a vaso-occlusive crisis. Start drinking water immediately — 3 litres over the next 8 hours. Take paracetamol now. Do you have ibuprofen too?"},
                ]
            },
            {
                "dago": 65, "triage": "FACILITY",
                "summary": "Acute chest syndrome (ACS). Fever 39.2°C, chest pain, SpO2 90%, new pulmonary infiltrate on chest X-ray. Admitted for IV antibiotics, oxygen, exchange transfusion consideration.",
                "symptoms": ["acute chest pain", "fever 39.2°C", "SpO2 90%", "new chest infiltrate on X-ray"],
                "recs": ["EMERGENCY facility admission", "ACS protocol: O2, antibiotics, incentive spirometry", "Exchange transfusion if SpO2 doesn't improve"],
                "messages": [
                    {"role":"user","content":"AMINA, bad chest pain and now fever 39.2. My oxygen monitor says 90%."},
                    {"role":"assistant","content":"90% oxygen with fever and chest pain in sickle cell is acute chest syndrome — this is a medical emergency. You must go to hospital immediately. Have someone take you now."},
                    {"role":"user","content":"Can't I manage at home like last time?"},
                    {"role":"assistant","content":"No — acute chest syndrome is different from a regular crisis. The oxygen level dropping to 90% means your lungs are involved. This can progress very quickly and become life-threatening. Please go to the hospital NOW."},
                ]
            },
            {
                "dago": 30, "triage": "SELF_CARE",
                "summary": "3-month Hydroxyurea review. No crisis in 6 weeks post-ACS. Hb 9.2, HbF rising (14%). Hydroxyurea dose maintained. Patient studying for exams — avoiding known triggers.",
                "symptoms": ["mild fatigue (baseline SCD)"],
                "recs": ["Continue Hydroxyurea + Folic acid + Penicillin", "Exam stress = crisis trigger — manage stress proactively", "Hydration daily regardless of thirst"],
                "messages": [
                    {"role":"user","content":"AMINA, no crisis for 6 weeks. Exams next month — I am worried about stress triggering one."},
                    {"role":"assistant","content":"Stress is a real trigger — you are right to plan ahead. What helps you manage stress?"},
                    {"role":"user","content":"Prayer, walking, and talking to my mum."},
                    {"role":"assistant","content":"Those are excellent coping mechanisms. Also: during exam period, drink 3 litres of water daily regardless of thirst, sleep 7-8 hours, and take your Hydroxyurea without missing a single dose. Your HbF rising to 14% means the Hydroxyurea is working to reduce crises."},
                ]
            },
        ]
    },

    # ── REPRODUCTIVE HEALTH ───────────────────────────────────────────────────
    {
        "email": "fatoumatta.darboe@aminacare.dev", "password": "Amina2026",
        "name": "Fatoumatta Darboe", "age": 19, "gender": "female",
        "region": "West Coast", "conditions": [],
        "language": "english",
        "profile": {
            "medications": [
                {"name": "Depo-Provera injection", "dosage": "150mg IM", "frequency": "Every 12 weeks"},
                {"name": "Ferrous sulphate", "dosage": "200mg", "frequency": "Once daily"},
            ],
            "last_bp": "110/70", "last_glucose": None,
            "key_facts": [
                "19-year-old on Depo-Provera contraceptive injection",
                "Last injection due — 2 weeks overdue",
                "Irregular periods on Depo — normal side effect",
                "Mild anaemia on iron supplementation",
                "No pregnancy currently",
                "Privacy important — family doesn't know about contraception",
            ],
            "triage_status": "SELF_CARE",
        },
        "caregiver_specialty": "Reproductive",
        "consultations": [
            {
                "dago": 85, "triage": "SELF_CARE",
                "summary": "First Depo-Provera injection. Normal weight and BP. Counselled on irregular periods as expected side effect. Iron started for mild anaemia (Hb 10.1). Confidentiality maintained.",
                "symptoms": ["mild anaemia Hb 10.1"],
                "recs": ["Depo-Provera 150mg IM given", "Next injection in 12 weeks", "Iron supplement for anaemia", "Confidentiality maintained"],
                "messages": [
                    {"role":"user","content":"AMINA, I don't want anyone to know I'm here. I want contraception."},
                    {"role":"assistant","content":"Your confidentiality is completely protected — I will not share your information with anyone without your consent. What method are you considering?"},
                    {"role":"user","content":"The injection. I don't want to take a tablet every day."},
                    {"role":"assistant","content":"Depo-Provera injection every 12 weeks is a good choice for privacy and convenience. Some women have irregular periods or no periods at all on it — this is normal and safe. Would you like to go ahead?"},
                ]
            },
            {
                "dago": 10, "triage": "SELF_CARE",
                "summary": "Depo injection overdue by 2 weeks. No unprotected sex in overdue period. Pregnancy test negative. Second injection given. Iron improving — Hb 11.4. Patient reassured.",
                "symptoms": ["anxiety about being overdue"],
                "recs": ["Second injection given — now protected", "Next injection in 12 weeks (mark calendar)", "Continue iron", "Emergency contact number given"],
                "messages": [
                    {"role":"user","content":"AMINA, I missed my injection by 2 weeks. I am worried."},
                    {"role":"assistant","content":"I understand the concern. Have you had any unprotected sex since you were due?"},
                    {"role":"user","content":"No. I was careful."},
                    {"role":"assistant","content":"Good. We will do a quick pregnancy test to be sure before giving the next injection. With no unprotected sex during the overdue period, the risk is very low. Your iron improved to 11.4 — that's good progress."},
                ]
            },
        ]
    },
]

# ── Caregiver matching ─────────────────────────────────────────────────────────

def find_best_caregiver(cg_rows: list, specialty_keyword: str) -> dict | None:
    for cg in cg_rows:
        spec = (cg.get("specialization") or "").lower()
        if specialty_keyword.lower() in spec:
            return cg
    return cg_rows[0] if cg_rows else None


# ── Insert consultations ────────────────────────────────────────────────────────

def insert_consultations(patient_id: str, consultations: list):
    now = datetime.now()
    count = 0
    for i, con in enumerate(consultations):
        days_ago = con.get("dago", len(consultations) * 20 - i * 20)
        start = now - timedelta(days=days_ago, hours=random.randint(7, 16))
        end   = start + timedelta(minutes=random.randint(8, 25))
        cid_val = cid()

        try:
            sql(
                "INSERT INTO ConsultationRecord SET "
                "id = :id, patient_id = :pid, session_id = :sid, "
                "started_at = :sa, ended_at = :ea, "
                "messages = :msgs, symptoms_reported = :syms, "
                "triage_level = :triage, tools_used = :tools, "
                "recommendations = :recs, followup_scheduled = null, "
                "summary = :summary",
                {
                    "id":      cid_val,
                    "pid":     patient_id,
                    "sid":     sid(patient_id, i),
                    "sa":      start.isoformat(),
                    "ea":      end.isoformat(),
                    "msgs":    json.dumps(con["messages"]),
                    "syms":    json.dumps(con["symptoms"]),
                    "triage":  con["triage"],
                    "tools":   json.dumps(["symptom_checker", "vital_validator"]),
                    "recs":    json.dumps(con["recs"]),
                    "summary": con["summary"],
                }
            )
            try:
                sql(
                    "CREATE EDGE HasConsultation "
                    "FROM (SELECT FROM PatientVertex WHERE id = :pid) "
                    "TO (SELECT FROM ConsultationRecord WHERE id = :cid)",
                    {"pid": patient_id, "cid": cid_val}
                )
            except Exception:
                pass
            count += 1
        except Exception as e:
            print(f"    Consultation #{i+1} insert failed: {e}")

    # Update patient consultation count
    try:
        sql(
            "UPDATE PatientVertex SET consultation_count = :cnt, last_consultation = :lc WHERE id = :pid",
            {"cnt": count, "lc": now.isoformat(), "pid": patient_id}
        )
    except Exception:
        pass
    return count


def update_patient_profile(patient_id: str, profile: dict):
    """Store medications, key_facts, last_bp, last_glucose, triage_status."""
    meds_str = json.dumps(profile.get("medications", []))
    facts_str = json.dumps(profile.get("key_facts", []))

    sets = ["medications = :meds", "key_facts = :facts"]
    params = {"meds": meds_str, "facts": facts_str, "pid": patient_id}

    if profile.get("last_bp"):
        sets.append("last_bp = :bp"); params["bp"] = profile["last_bp"]
    if profile.get("last_glucose"):
        sets.append("last_glucose = :gl"); params["gl"] = str(profile["last_glucose"])
    if profile.get("triage_status"):
        sets.append("triage_status = :ts"); params["ts"] = profile["triage_status"]

    try:
        sql(f"UPDATE PatientVertex SET {', '.join(sets)} WHERE id = :pid", params)
    except Exception as e:
        print(f"    Profile update warning: {e}")


def link_to_caregiver(patient_id: str, caregiver_id: str, admin_token: str):
    try:
        r = requests.post(
            f"{API}/api/v1/caregiver/link-patient",
            json={
                "patient_id":   patient_id,
                "caregiver_id": caregiver_id,
                "permissions":  ["vitals", "medications", "consultations", "alerts"],
            },
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=10,
        )
        return r.ok
    except Exception:
        return False


def get_admin_token():
    r = requests.post(f"{API}/api/v1/admin/login", json={"username": "admin", "password": "amina2026"}, timeout=10)
    return r.json().get("token", "")


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print("\n" + "═"*60)
    print("  AMINA Mixed Patient Seeder — 15 diverse clinical profiles")
    print("═"*60)

    # Get caregivers
    cg_rows = get_caregiver_ids()
    print(f"  Found {len(cg_rows)} caregivers in directory\n")

    admin_token = get_admin_token()
    if admin_token:
        print(f"  {OK} Admin token obtained\n")
    else:
        print(f"  {WARN} Could not get admin token — caregiver linking will be skipped\n")

    created = 0
    skipped = 0

    for p in PATIENTS:
        print(f"  → {p['name']} ({p['age']}y, {p['gender']}, {p['region']})")

        # 1. Create account
        r = requests.post(
            f"{API}/api/v1/auth/signup/email",
            json={
                "email":      p["email"],
                "password":   p["password"],
                "name":       p["name"],
                "age":        p["age"],
                "gender":     p["gender"],
                "region":     p["region"],
                "conditions": p["conditions"],
                "language":   p["language"],
            },
            timeout=10,
        )
        d = r.json()

        if "already registered" in (d.get("error") or ""):
            print(f"    {WARN} Already exists — updating profile + adding consultations")
            # Try to find patient ID
            rows = sql("SELECT id FROM PatientVertex WHERE phone = :ph OR email = :em LIMIT 1",
                       {"ph": p["email"], "em": p["email"]})
            if not rows:
                rows = sql("SELECT id FROM PatientVertex WHERE name = :nm LIMIT 1", {"nm": p["name"]})
            patient_id = rows[0]["id"] if rows else None
            skipped += 1
        elif d.get("success"):
            patient_id = d["patient"]["id"]
            print(f"    {OK} Created — id={patient_id}")
            created += 1
        else:
            print(f"    {FAIL} Failed: {d.get('error')}")
            continue

        if not patient_id:
            print(f"    {FAIL} Cannot resolve patient ID — skipping")
            continue

        # 2. Update profile with clinical details
        update_patient_profile(patient_id, p["profile"])
        print(f"    {OK} Profile updated ({len(p['profile'].get('medications',[]))} medications, triage={p['profile'].get('triage_status')})")

        # 3. Insert consultations
        n = insert_consultations(patient_id, p["consultations"])
        print(f"    {OK} {n} consultation(s) inserted")

        # 4. Link to caregiver
        cg = find_best_caregiver(cg_rows, p.get("caregiver_specialty", ""))
        if cg and admin_token:
            ok = link_to_caregiver(patient_id, cg["caregiver_id"], admin_token)
            if ok:
                print(f"    {OK} Linked to caregiver: {cg['name']} ({cg['specialization']})")
            else:
                print(f"    {WARN} Caregiver link failed — patient still created")
        print()

    print("═"*60)
    print(f"  Done — {created} new accounts created, {skipped} existing updated")
    print("═"*60)
    print("\n  Patient accounts (password: Amina2026):")
    for p in PATIENTS:
        triage = p["profile"].get("triage_status", "?")
        print(f"    {p['email']:<42} {p['name']:<30} [{triage}]")
    print()


if __name__ == "__main__":
    main()
