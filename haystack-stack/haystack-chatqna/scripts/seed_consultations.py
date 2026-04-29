#!/usr/bin/env python3
"""
Seed realistic consultation history for all 11 caregiver patients.
10 consultations per patient, last 30 days, condition-relevant conversations.
"""
import json, uuid, hashlib, requests
from datetime import datetime, timedelta
import random

ARCADEDB = "http://localhost:2480"
DB       = "genie"
AUTH     = ("root", "genieRoot123")

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
    return f"s_{patient_id}_{n:02d}"

def ts(days_ago, hour=10, minute=0):
    dt = datetime.now() - timedelta(days=days_ago, hours=random.randint(0,4))
    return dt.replace(hour=hour, minute=minute, second=0).isoformat()

# ── Patient consultations ─────────────────────────────────────────────────────

CONSULTATIONS = {

"P_TESTUSER01": [
    {
        "summary": "Patient checked in for routine health review. Reported mild fatigue. No urgent concerns identified.",
        "symptoms": ["fatigue"], "triage": "SELF_CARE",
        "recs": ["Rest well", "Stay hydrated"],
        "messages": [
            {"role":"user","content":"Hi AMINA, I've been feeling tired lately."},
            {"role":"assistant","content":"I'm sorry to hear that. How long have you been feeling fatigued?"},
            {"role":"user","content":"About 3 days now. I sleep 7 hours but still feel tired."},
            {"role":"assistant","content":"That could be from stress or mild dehydration. Are you drinking enough water and eating regular meals?"},
            {"role":"user","content":"Probably not drinking enough. I'll try to improve that."},
            {"role":"assistant","content":"Great. Aim for 8 glasses of water daily. If fatigue persists beyond a week, please visit your health post."},
        ]
    },
    {
        "summary": "Follow-up on fatigue. Patient reports improvement after increasing fluid intake. General wellbeing good.",
        "symptoms": [], "triage": "SELF_CARE",
        "recs": ["Continue hydration", "Monitor energy levels"],
        "messages": [
            {"role":"user","content":"AMINA, my energy is much better after drinking more water."},
            {"role":"assistant","content":"That's great to hear! Hydration makes a big difference. How is your sleep?"},
            {"role":"user","content":"Sleep is good, I feel rested now."},
            {"role":"assistant","content":"Excellent. Keep up the good habits. Come back if anything changes."},
        ]
    },
],

"P_66112160": [  # Fatou Jallow — hypertension, diabetes
    {
        "summary": "Patient reports headache and dizziness. BP self-measured at 152/94. Glucose 9.1 mmol/L. Medication adherence questioned — missed 2 doses this week. Advised to resume medication and monitor.",
        "symptoms": ["headache","dizziness","high blood pressure"], "triage": "CHW_VISIT",
        "recs": ["Resume Metformin and Amlodipine", "Check BP daily for 3 days", "CHW visit if BP stays above 150/90"],
        "messages": [
            {"role":"user","content":"AMINA I have a headache since morning and I feel dizzy."},
            {"role":"assistant","content":"I'm concerned about those symptoms. Have you checked your blood pressure today?"},
            {"role":"user","content":"Yes it was 152/94 on my home monitor."},
            {"role":"assistant","content":"That's elevated. Have you been taking your Amlodipine regularly?"},
            {"role":"user","content":"I missed it twice this week, I forgot."},
            {"role":"assistant","content":"Missing doses can cause BP to spike. Please take your medication now and continue daily. If the headache worsens or vision blurs, go to the health facility immediately."},
            {"role":"user","content":"Okay I will. My glucose was also 9.1 this morning."},
            {"role":"assistant","content":"That's a little high. Make sure to take your Metformin with meals. A CHW visit in the next 2 days would be helpful to review your readings."},
        ]
    },
    {
        "summary": "Routine diabetes check. Glucose 7.8 mmol/L — improvement from last visit. BP 145/88. Patient reports taking medications consistently. Encouraged to continue low-sugar diet.",
        "symptoms": ["mild fatigue"], "triage": "SELF_CARE",
        "recs": ["Continue medications", "Low-sugar diet", "Walk 20 mins daily"],
        "messages": [
            {"role":"user","content":"Hi AMINA. My glucose today was 7.8 and BP was 145/88."},
            {"role":"assistant","content":"That's a real improvement from last week! Are you taking your medications consistently?"},
            {"role":"user","content":"Yes, every day now. I set an alarm."},
            {"role":"assistant","content":"Excellent strategy. Keep that up. How is your diet?"},
            {"role":"user","content":"I cut out sugary tea and rice portions. Feeling better overall."},
            {"role":"assistant","content":"Those are exactly the right changes. Continue walking daily and I'll check in next week."},
        ]
    },
    {
        "summary": "Patient complaining of foot tingling and numbness — possible peripheral neuropathy from diabetes. Referred to health facility for HbA1c test.",
        "symptoms": ["foot tingling","numbness","fatigue"], "triage": "FACILITY",
        "recs": ["HbA1c test at health facility", "Foot care daily inspection", "Avoid tight footwear"],
        "messages": [
            {"role":"user","content":"AMINA my feet have been tingling at night. It's been two weeks."},
            {"role":"assistant","content":"Tingling and numbness in the feet can be a sign of diabetic neuropathy. This is important to check. How long have you had diabetes?"},
            {"role":"user","content":"About 4 years now."},
            {"role":"assistant","content":"Long-term diabetes can affect nerves. I strongly recommend visiting the health facility for an HbA1c blood test and a foot examination by a nurse or doctor."},
            {"role":"user","content":"Should I be worried?"},
            {"role":"assistant","content":"Early detection means we can prevent it from getting worse. This week, check your feet daily for any cuts or sores. Don't wait on this visit."},
        ]
    },
    {
        "summary": "Post-facility visit follow-up. HbA1c result 8.2% — above target. Doctor adjusted Metformin to 1000mg twice daily. Patient understands new dosing.",
        "symptoms": [], "triage": "SELF_CARE",
        "recs": ["New Metformin 1000mg twice daily", "Repeat HbA1c in 3 months", "Log glucose readings"],
        "messages": [
            {"role":"user","content":"AMINA I went to the facility. My HbA1c was 8.2%."},
            {"role":"assistant","content":"Thank you for going. 8.2% is above the target of 7%. Did the doctor make any medication changes?"},
            {"role":"user","content":"Yes they doubled my Metformin to 1000mg twice a day."},
            {"role":"assistant","content":"That's a reasonable adjustment. Take it with food to avoid stomach upset. You should repeat the HbA1c in 3 months to see the improvement."},
        ]
    },
    {
        "summary": "Patient reports swelling in ankles after standing long hours at market. BP 148/90. Advised elevation and to monitor for worsening.",
        "symptoms": ["ankle swelling","fatigue"], "triage": "CHW_VISIT",
        "recs": ["Elevate feet when resting", "Limit salt intake", "CHW check if swelling worsens"],
        "messages": [
            {"role":"user","content":"My ankles are swollen today. I stood at the market all day."},
            {"role":"assistant","content":"Ankle swelling with hypertension needs attention. Is the swelling in both ankles?"},
            {"role":"user","content":"Yes both. BP was 148/90 this morning."},
            {"role":"assistant","content":"Prolonged standing can cause this, but with your BP history, a CHW check is wise. Tonight elevate your feet above heart level and reduce salt in your food."},
        ]
    },
    {
        "summary": "Stable check-in. All readings within acceptable range. Good medication adherence reported. Patient feels well.",
        "symptoms": [], "triage": "SELF_CARE",
        "recs": ["Maintain current medication routine", "Continue dietary changes"],
        "messages": [
            {"role":"user","content":"Weekly check-in. Glucose 7.2, BP 142/86. Feeling good."},
            {"role":"assistant","content":"Excellent readings, Fatou! You're managing both conditions really well. Keep it up."},
            {"role":"user","content":"Thank you AMINA. The diet changes really helped."},
            {"role":"assistant","content":"Consistency is key. Same time next week — keep logging your numbers!"},
        ]
    },
],

"P_FE71B024": [  # Ousman Ceesay — heart disease, hypertension
    {
        "summary": "Patient reports chest tightness on exertion (walking uphill). BP 165/100. Atenolol taken. Advised to rest and seek immediate care if tightness occurs at rest.",
        "symptoms": ["chest tightness","shortness of breath","exertional pain"], "triage": "FACILITY",
        "recs": ["Immediate facility visit if pain at rest", "Limit strenuous activity", "Monitor pulse"],
        "messages": [
            {"role":"user","content":"AMINA I had chest tightness when walking to the mosque this morning."},
            {"role":"assistant","content":"Chest tightness during exertion is a warning sign we must take seriously. Did it go away when you stopped walking?"},
            {"role":"user","content":"Yes it stopped after I rested 5 minutes."},
            {"role":"assistant","content":"This sounds like it could be angina. Did you take your Atenolol today?"},
            {"role":"user","content":"Yes I took it. BP was 165/100."},
            {"role":"assistant","content":"Your BP is quite high. Please visit the health facility today or tomorrow — do not wait. If the chest pain occurs while resting, go to emergency immediately."},
        ]
    },
    {
        "summary": "Post-cardiology follow-up. Doctor confirmed stable angina. Added sublingual nitroglycerin for acute episodes. BP 155/92 at clinic. Continue Atenolol and Aspirin.",
        "symptoms": ["occasional chest tightness"], "triage": "SELF_CARE",
        "recs": ["Nitroglycerin for acute episodes", "Avoid heavy lifting", "Follow-up in 4 weeks"],
        "messages": [
            {"role":"user","content":"I saw the heart doctor. He said it's stable angina and gave me nitroglycerin tablets."},
            {"role":"assistant","content":"Good that you went. Nitroglycerin can stop an angina episode quickly. Do you know how to use it?"},
            {"role":"user","content":"One tablet under the tongue when pain starts, wait 5 minutes, can repeat twice."},
            {"role":"assistant","content":"Perfect. Also avoid any heavy work. What was your BP at the clinic?"},
            {"role":"user","content":"155/92. Better than home readings."},
            {"role":"assistant","content":"Still needs improvement. White coat effect may differ. Continue Atenolol daily and return in 4 weeks."},
        ]
    },
    {
        "summary": "Patient reports improved BP after walking 20 minutes daily as advised. BP 152/90. No chest pain episodes this week. Good adherence.",
        "symptoms": ["mild shortness of breath on stairs"], "triage": "SELF_CARE",
        "recs": ["Continue walking programme", "Take all medications on time"],
        "messages": [
            {"role":"user","content":"Good news AMINA. No chest pain this week. BP is 152/90."},
            {"role":"assistant","content":"That's progress! Are you doing the daily walks?"},
            {"role":"user","content":"Yes, 20 minutes every morning. I feel better."},
            {"role":"assistant","content":"Wonderful. Exercise is powerful medicine for the heart. Any shortness of breath?"},
            {"role":"user","content":"Only a little when climbing stairs."},
            {"role":"assistant","content":"That's expected at your age with your history. Take stairs slowly. Keep up the good work."},
        ]
    },
    {
        "summary": "Medication concern — patient forgot if he took Aspirin this morning. Advised not to double dose. Discussed pill organiser strategy.",
        "symptoms": [], "triage": "SELF_CARE",
        "recs": ["Use a pill organiser", "Do not double dose if missed"],
        "messages": [
            {"role":"user","content":"AMINA I forgot if I took my aspirin. Should I take another?"},
            {"role":"assistant","content":"Do not take a second dose if you're unsure. Missing one Aspirin rarely causes harm. Did you eat breakfast already?"},
            {"role":"user","content":"Yes I ate."},
            {"role":"assistant","content":"Then skip today's dose and continue tomorrow. I strongly recommend getting a weekly pill organiser — it removes all doubt."},
        ]
    },
    {
        "summary": "Leg swelling reported — mild bilateral oedema. BP 160/98. Referred to CHW to assess for possible fluid retention related to cardiac condition.",
        "symptoms": ["leg swelling","shortness of breath at night"], "triage": "CHW_VISIT",
        "recs": ["CHW assessment within 2 days", "Limit salt", "Sleep with legs elevated"],
        "messages": [
            {"role":"user","content":"My legs have been swollen for 3 days and I get short of breath when lying flat."},
            {"role":"assistant","content":"Swelling and breathlessness when lying down together are important warning signs for the heart. How severe is the breathlessness?"},
            {"role":"user","content":"I need to use 2 pillows to sleep comfortably."},
            {"role":"assistant","content":"Please contact your CHW today. These symptoms — orthopnoea and oedema — need professional assessment promptly. This could indicate the heart is under stress."},
        ]
    },
],

"P_8A9B70B9": [  # Adama Bah — diabetes
    {
        "summary": "Patient newly adjusting to insulin therapy. Reports injection site soreness. Glucose 11.5 mmol/L fasting. Technique review done.",
        "symptoms": ["injection site soreness","fatigue"], "triage": "CHW_VISIT",
        "recs": ["Rotate injection sites", "CHW insulin technique review", "Log glucose twice daily"],
        "messages": [
            {"role":"user","content":"AMINA my glucose is 11.5 this morning and my injection site hurts."},
            {"role":"assistant","content":"Injection site pain usually comes from using the same spot repeatedly. Are you rotating sites across your abdomen and thighs?"},
            {"role":"user","content":"No, I always inject the same spot on my stomach."},
            {"role":"assistant","content":"That's causing lipohypertrophy — hardening of tissue. You must rotate sites with each injection. Your CHW can show you the rotation pattern this week."},
        ]
    },
    {
        "summary": "Glucose improving after site rotation. Fasting glucose 8.9 mmol/L. Patient doing 2 readings per day. Diet discussion: reducing refined carbs.",
        "symptoms": ["mild fatigue"], "triage": "SELF_CARE",
        "recs": ["Continue rotation technique", "Reduce white rice portions", "Increase vegetable intake"],
        "messages": [
            {"role":"user","content":"Glucose down to 8.9 today! The rotation is helping."},
            {"role":"assistant","content":"Great improvement! The correct technique makes a significant difference. How is your diet?"},
            {"role":"user","content":"I eat rice twice a day. Is that too much?"},
            {"role":"assistant","content":"For diabetes management, half a cup of rice per meal is better than a full plate. Replace with more vegetables, fish, or beans to stay satisfied with less carbs."},
        ]
    },
    {
        "summary": "Episode of hypoglycaemia reported — glucose 3.2 at 3pm, feeling shaky and confused. Treated with sugar water. Insulin dose timing reviewed.",
        "symptoms": ["hypoglycaemia","shakiness","confusion"], "triage": "CHW_VISIT",
        "recs": ["Always carry glucose tablets or sugar", "CHW review insulin timing", "Do not skip meals"],
        "messages": [
            {"role":"user","content":"AMINA I felt shaky and confused at 3pm. Glucose was 3.2."},
            {"role":"assistant","content":"That is a hypoglycaemic episode — dangerously low sugar. What did you do?"},
            {"role":"user","content":"I drank sugar water and felt better in 10 minutes."},
            {"role":"assistant","content":"You did the right thing. But we need to understand why it happened. Did you skip lunch?"},
            {"role":"user","content":"Yes I was busy and forgot to eat after my morning insulin."},
            {"role":"assistant","content":"Never skip meals after taking insulin. This is serious. Please see your CHW to review your insulin timing schedule and always carry 3 glucose tablets with you."},
        ]
    },
    {
        "summary": "Stable follow-up. Fasting glucose 7.6 mmol/L. No hypoglycaemia episodes this week. Meal schedule improved. Patient confident with self-management.",
        "symptoms": [], "triage": "SELF_CARE",
        "recs": ["Maintain meal schedule", "Glucose log review next month"],
        "messages": [
            {"role":"user","content":"Glucose 7.6 fasting. No low episodes this week."},
            {"role":"assistant","content":"Excellent! That's a healthy fasting glucose. How are the meals going?"},
            {"role":"user","content":"I set alarms for lunch and dinner now. No more skipping."},
            {"role":"assistant","content":"Perfect strategy. You're taking real control of your diabetes. Keep the log going and we'll review next month."},
        ]
    },
    {
        "summary": "Patient asks about Ramadan fasting with diabetes. Discussed modified fasting plan with doctor's guidance.",
        "symptoms": [], "triage": "SELF_CARE",
        "recs": ["Consult doctor before fasting", "Modified insulin schedule for Ramadan", "Break fast if glucose below 4.0"],
        "messages": [
            {"role":"user","content":"AMINA, can I fast during Ramadan? I'm diabetic."},
            {"role":"assistant","content":"Many people with diabetes do fast during Ramadan safely, but it requires careful planning. Have you spoken to your doctor?"},
            {"role":"user","content":"Not yet. I was worried they'd say no."},
            {"role":"assistant","content":"Please discuss it with them before Ramadan starts. They can adjust your insulin timing. General rules: break fast immediately if glucose drops below 4.0, and test frequently."},
        ]
    },
],

"P_CCE7473B": [  # Lamin Sanneh — COPD, hypertension
    {
        "summary": "Severe breathlessness during morning walk — worse than usual. SpO2 reported 91% on home oximeter. Salbutamol used twice today. Urgent facility referral.",
        "symptoms": ["severe dyspnoea","low oxygen","wheezing"], "triage": "FACILITY",
        "recs": ["Immediate facility visit", "Use salbutamol as directed", "Avoid exertion until reviewed"],
        "messages": [
            {"role":"user","content":"AMINA I can barely walk today. Very short of breath. My oxygen was 91%."},
            {"role":"assistant","content":"91% oxygen saturation is below normal and needs urgent attention. Have you used your inhaler?"},
            {"role":"user","content":"Yes twice this morning but not much relief."},
            {"role":"assistant","content":"If your inhaler is not helping and oxygen is below 92%, you need to go to the health facility NOW. Ask someone to take you — do not walk alone."},
        ]
    },
    {
        "summary": "Post-exacerbation follow-up. Patient was given oral steroids and antibiotics at facility. Feeling 70% better. COPD action plan reviewed.",
        "symptoms": ["mild breathlessness","productive cough"], "triage": "SELF_CARE",
        "recs": ["Complete full antibiotic course", "Use preventer inhaler daily", "Flu vaccination reminder"],
        "messages": [
            {"role":"user","content":"I'm back from the hospital. They gave me steroids and antibiotics."},
            {"role":"assistant","content":"Good that you went. How are you feeling now?"},
            {"role":"user","content":"Much better, maybe 70%. Still some cough."},
            {"role":"assistant","content":"That's to be expected. Complete all the antibiotics even if you feel better. Are you using your preventer inhaler every morning?"},
            {"role":"user","content":"Sometimes I forget it."},
            {"role":"assistant","content":"The preventer inhaler is crucial for COPD — it reduces future attacks. Set it beside your toothbrush so you never forget."},
        ]
    },
    {
        "summary": "Routine COPD check. Breathing stable. BP 152/86. Patient walking short distances without significant breathlessness. Inhaler technique good.",
        "symptoms": ["mild morning cough"], "triage": "SELF_CARE",
        "recs": ["Continue both inhalers", "Avoid smoke and dust", "Breathing exercises daily"],
        "messages": [
            {"role":"user","content":"AMINA my breathing is much better this week. BP is 152/86."},
            {"role":"assistant","content":"That's good news. Any wheezing or chest tightness?"},
            {"role":"user","content":"No. Just some cough in the morning."},
            {"role":"assistant","content":"Morning cough is common with COPD and usually clears after using the inhaler. Are you doing the pursed-lip breathing exercises?"},
            {"role":"user","content":"Every morning yes."},
            {"role":"assistant","content":"You're doing everything right. Keep away from cooking fires and dust which can trigger attacks."},
        ]
    },
    {
        "summary": "Patient concerned about new medication Lisinopril causing dry cough. Discussed that cough is a known side effect — advised to report to doctor.",
        "symptoms": ["dry cough","medication side effect"], "triage": "CHW_VISIT",
        "recs": ["Report cough to doctor — may need alternative ACE inhibitor", "Do not stop medication without advice"],
        "messages": [
            {"role":"user","content":"Since starting Lisinopril I have a dry cough all day."},
            {"role":"assistant","content":"Dry cough is actually a very common side effect of Lisinopril — it affects about 10-15% of patients. It's not dangerous but it can be annoying."},
            {"role":"user","content":"It's disturbing my sleep."},
            {"role":"assistant","content":"In that case, please tell your doctor. They can switch you to a similar medication called an ARB (like Losartan) which doesn't cause this cough. Do not stop Lisinopril on your own before speaking to them."},
        ]
    },
    {
        "summary": "Cold weather triggered increased COPD symptoms. Patient using rescue inhaler more than usual. Warm fluids and avoiding cold air advised.",
        "symptoms": ["increased wheezing","chest tightness","cold-triggered symptoms"], "triage": "CHW_VISIT",
        "recs": ["Scarf over nose/mouth in cold", "Warm fluids", "CHW review if worsening"],
        "messages": [
            {"role":"user","content":"The cold weather is making my breathing worse. I'm using my inhaler more."},
            {"role":"assistant","content":"Cold air is a common COPD trigger — it causes airways to narrow. How many times per day are you using the rescue inhaler?"},
            {"role":"user","content":"3-4 times compared to 1-2 before."},
            {"role":"assistant","content":"That's too frequent. Cover your nose and mouth with a scarf when going outside. Drink warm liquids. If you need the inhaler more than 4 times in a day, please see the CHW."},
        ]
    },
],

"P_AC56323B": [  # Mariama Touray — anaemia
    {
        "summary": "Severe tiredness, pale skin, shortness of breath on minimal exertion. Haemoglobin reported 7.8 g/dL at last test. Iron tablet adherence poor due to GI side effects.",
        "symptoms": ["extreme fatigue","pallor","dyspnoea on exertion","palpitations"], "triage": "FACILITY",
        "recs": ["Facility visit for repeat Hb and iron studies", "Take iron with orange juice to improve absorption", "Avoid tea/coffee with iron tablets"],
        "messages": [
            {"role":"user","content":"AMINA I'm so tired I can barely do my housework. I get breathless walking upstairs."},
            {"role":"assistant","content":"Those are serious symptoms. What was your last haemoglobin result?"},
            {"role":"user","content":"7.8 two months ago at the clinic."},
            {"role":"assistant","content":"That's very low — normal for women is above 12. Have you been taking your iron tablets?"},
            {"role":"user","content":"They upset my stomach so I stopped."},
            {"role":"assistant","content":"I understand they can cause discomfort, but you need them urgently. Take them with a glass of orange juice and avoid tea or coffee for 2 hours after. Please visit the facility for a repeat blood test this week."},
        ]
    },
    {
        "summary": "Iron tablet adherence improved with orange juice strategy. Less GI discomfort. Patient feels 'slightly less tired'. Encouraged to continue full 3-month course.",
        "symptoms": ["fatigue — improving","mild dizziness"], "triage": "SELF_CARE",
        "recs": ["Continue full iron course", "Iron-rich foods: beans, leafy greens, meat", "Avoid tea near tablet time"],
        "messages": [
            {"role":"user","content":"The orange juice tip helped! Less stomach pain. I feel slightly better."},
            {"role":"assistant","content":"Wonderful! Even small improvements in iron levels make a difference. How many weeks of tablets do you have left?"},
            {"role":"user","content":"About 2 months worth."},
            {"role":"assistant","content":"Commit to the full course. Are you eating iron-rich foods — liver, beans, dark leafy greens?"},
            {"role":"user","content":"I eat groundnut soup with leafy greens most days."},
            {"role":"assistant","content":"Perfect — that's exactly the right diet. The vitamin C in tomatoes helps absorb iron too."},
        ]
    },
    {
        "summary": "Patient reports palpitations and light-headedness when standing quickly. Postural hypotension likely. Advised on slow position changes.",
        "symptoms": ["palpitations","lightheadedness on standing","dizziness"], "triage": "CHW_VISIT",
        "recs": ["Rise from sitting/lying slowly", "Sit at edge before standing", "CHW check if continues"],
        "messages": [
            {"role":"user","content":"I keep feeling dizzy and heart racing when I stand up quickly."},
            {"role":"assistant","content":"This is likely postural hypotension — blood pressure dropping when you stand. It's common with anaemia. How quickly do you stand?"},
            {"role":"user","content":"Very fast, I jump up quickly."},
            {"role":"assistant","content":"That's the cause. Always sit at the edge of the bed or chair first, wait 10-15 seconds, then stand slowly. This gives your blood pressure time to adjust."},
        ]
    },
    {
        "summary": "Good progress — patient reports much more energy. Pale colour improving. Ready for repeat blood test next week.",
        "symptoms": ["mild fatigue — resolving"], "triage": "SELF_CARE",
        "recs": ["Repeat Hb test next week", "Continue iron and diet"],
        "messages": [
            {"role":"user","content":"I have so much more energy! My friends say I look better."},
            {"role":"assistant","content":"That's a great sign — your colour returning shows haemoglobin is improving. Have you booked your repeat blood test?"},
            {"role":"user","content":"Next Friday at the clinic."},
            {"role":"assistant","content":"Perfect. Let me know the result. I expect it will show good improvement given how well you're feeling."},
        ]
    },
    {
        "summary": "Haemoglobin improved to 10.2 g/dL. Still below target but major improvement. Continue iron for 2 more months. Dietary iron reinforced.",
        "symptoms": [], "triage": "SELF_CARE",
        "recs": ["Continue iron 2 more months", "Balanced diet with iron-rich foods", "Follow-up Hb in 2 months"],
        "messages": [
            {"role":"user","content":"Hb is 10.2 now! Up from 7.8!"},
            {"role":"assistant","content":"That's a remarkable improvement — 2.4 points in just weeks! You should be proud of your consistency."},
            {"role":"user","content":"I feel like a different person."},
            {"role":"assistant","content":"The difference an adequate haemoglobin makes is life-changing. Continue for 2 more months to fully restore your iron stores. Target is above 12."},
        ]
    },
],

"P_1ED47FEC": [  # Ebrima Bojang — diabetes, obesity
    {
        "summary": "Glucose 12.4 after large rice meal. Patient unaware of glycaemic index concept. Portion control and food swaps discussed.",
        "symptoms": ["post-meal hyperglycaemia","thirst","frequent urination"], "triage": "CHW_VISIT",
        "recs": ["Portion control — half plate vegetables", "CHW dietary counselling", "Test glucose 2h after meals"],
        "messages": [
            {"role":"user","content":"My glucose was 12.4 after lunch. I ate a lot of rice."},
            {"role":"assistant","content":"12.4 two hours after eating is quite high. Large rice portions cause rapid glucose spikes. How much rice did you eat?"},
            {"role":"user","content":"A big bowl, maybe 2 cups cooked."},
            {"role":"assistant","content":"For diabetes, aim for half a cup per meal. Try replacing half with vegetables or beans — same satisfaction but much less glucose spike."},
            {"role":"user","content":"I didn't know that. I'll try smaller portions."},
            {"role":"assistant","content":"Great. Also test your glucose 2 hours after each meal this week so we can see the pattern. Your CHW can do a full dietary review."},
        ]
    },
    {
        "summary": "Weight check: 94kg (down 2kg from last month). Patient reports walking 30 minutes 4 days/week. Glucose average improving: 9.1 mmol/L weekly average.",
        "symptoms": ["mild fatigue after exercise"], "triage": "SELF_CARE",
        "recs": ["Increase walk to 5 days/week", "Set 5kg weight goal for 3 months", "Continue food diary"],
        "messages": [
            {"role":"user","content":"I lost 2kg this month! Weight is 94kg now."},
            {"role":"assistant","content":"Excellent! 2kg in a month is safe, healthy weight loss. How did you do it?"},
            {"role":"user","content":"Walking 30 minutes and smaller rice portions. My glucose average is 9.1 now."},
            {"role":"assistant","content":"Wonderful progress on both fronts. Both weight loss and lower glucose together show the lifestyle changes are working. Can you increase to 5 walking days?"},
        ]
    },
    {
        "summary": "Patient reports knee pain from walking. Discussed low-impact alternatives: swimming, cycling, seated exercises. Pain persists — referred to CHW.",
        "symptoms": ["knee pain","obesity-related joint strain"], "triage": "CHW_VISIT",
        "recs": ["Switch to swimming or cycling", "Weight loss will reduce knee strain", "CHW referral for physiotherapy"],
        "messages": [
            {"role":"user","content":"My knees hurt from all the walking. Should I stop?"},
            {"role":"assistant","content":"Don't stop exercise — but change the type. Walking with excess weight puts significant stress on knees. Do you have access to a pool?"},
            {"role":"user","content":"There's a pool at the community centre."},
            {"role":"assistant","content":"Swimming is perfect — zero impact on joints while burning more calories than walking. The CHW can also refer you for physiotherapy exercises to strengthen the knee."},
        ]
    },
    {
        "summary": "Metformin side effects: diarrhoea and nausea for 1 week. Changed to extended-release Metformin on doctor advice. Symptoms now tolerable.",
        "symptoms": ["diarrhoea","nausea","GI discomfort"], "triage": "SELF_CARE",
        "recs": ["Take extended-release Metformin with evening meal", "Small frequent meals", "Stay hydrated"],
        "messages": [
            {"role":"user","content":"AMINA my stomach has been very bad since doubling my Metformin."},
            {"role":"assistant","content":"Stomach issues are common when Metformin dose increases. Did you call the doctor?"},
            {"role":"user","content":"Yes, they switched me to extended release. The pharmacist says it's gentler."},
            {"role":"assistant","content":"Correct — extended release Metformin causes far fewer GI effects. Take it with your evening meal for best results."},
        ]
    },
    {
        "summary": "Best glucose reading to date: fasting 6.8 mmol/L. BMI now 30.4, down from 33.2. Patient very motivated. Celebrated progress together.",
        "symptoms": [], "triage": "SELF_CARE",
        "recs": ["Maintain lifestyle changes", "Target HbA1c below 7% at next test", "Continue monthly weight checks"],
        "messages": [
            {"role":"user","content":"AMINA my glucose was 6.8 fasting this morning! And I've lost 8kg total!"},
            {"role":"assistant","content":"This is outstanding! 6.8 is within the normal range. 8kg weight loss has made a profound difference to your diabetes control."},
            {"role":"user","content":"I feel better than I have in years."},
            {"role":"assistant","content":"You should be very proud. You've changed your life. At your next appointment, ask for an HbA1c test — I expect it will reflect this incredible progress."},
        ]
    },
],

"P_5A2F2506": [  # Sainabou Jammeh — hypertension
    {
        "summary": "Home BP readings variable: 155/95 morning, 142/88 evening. Hydrochlorothiazide adherence confirmed. White coat effect or true morning hypertension discussed.",
        "symptoms": ["headache","morning hypertension"], "triage": "CHW_VISIT",
        "recs": ["Log BP morning and evening for 1 week", "Take medication at same time each day", "CHW BP review"],
        "messages": [
            {"role":"user","content":"My morning BP is always higher — 155/95. Evenings it's 142/88."},
            {"role":"assistant","content":"Morning surge in BP is a recognised pattern and can increase heart risk. Are you taking your Hydrochlorothiazide at the same time every day?"},
            {"role":"user","content":"Usually yes, in the morning after breakfast."},
            {"role":"assistant","content":"Good. Log morning and evening readings for 1 week and bring the list to your CHW. This pattern may need a medication timing adjustment."},
        ]
    },
    {
        "summary": "Severe headache, visual disturbance, BP 172/105. Advised emergency facility visit. This is hypertensive urgency.",
        "symptoms": ["severe headache","visual disturbance","very high BP"], "triage": "FACILITY",
        "recs": ["IMMEDIATE facility visit", "Do not delay", "Call for transport"],
        "messages": [
            {"role":"user","content":"AMINA bad headache and my vision went blurry. BP is 172/105."},
            {"role":"assistant","content":"This is a hypertensive emergency. You need to go to the health facility RIGHT NOW. Do not wait. Is someone with you?"},
            {"role":"user","content":"My husband is here."},
            {"role":"assistant","content":"Ask him to take you immediately. Do not eat or drink anything. Sit calmly in the car. This cannot wait."},
        ]
    },
    {
        "summary": "Post-emergency follow-up. Doctor added Amlodipine 5mg to existing Hydrochlorothiazide. BP now 148/90. Patient feeling much better.",
        "symptoms": ["mild residual headache"], "triage": "SELF_CARE",
        "recs": ["New medication: Amlodipine 5mg morning", "Continue Hydrochlorothiazide", "Daily BP monitoring"],
        "messages": [
            {"role":"user","content":"I'm home from hospital. They added a new tablet, Amlodipine."},
            {"role":"assistant","content":"Good — two medications are often needed to control resistant hypertension. What is your BP today?"},
            {"role":"user","content":"148/90. Much better."},
            {"role":"assistant","content":"That's encouraging. The combination should bring it down further over the next week. Monitor daily and call the facility if it goes above 160 again."},
        ]
    },
    {
        "summary": "BP stabilising on dual therapy: 138/86. Patient reports no side effects from Amlodipine. Ankle swelling mild — expected side effect.",
        "symptoms": ["mild ankle swelling"], "triage": "SELF_CARE",
        "recs": ["Ankle swelling may improve after 4 weeks", "Reduce salt", "Stay active"],
        "messages": [
            {"role":"user","content":"BP is 138/86 now. The Amlodipine is working! But my ankles swell a bit."},
            {"role":"assistant","content":"138/86 is a real improvement! Ankle swelling is a mild side effect of Amlodipine that often improves after 4 weeks. Are you reducing salt?"},
            {"role":"user","content":"Yes, cooking with less salt now. Family complains but health first!"},
            {"role":"assistant","content":"Your family will get used to it — and their hearts will thank you too!"},
        ]
    },
    {
        "summary": "Excellent BP control achieved: 130/82. Patient now managing stress with prayer and evening walks. Medication review satisfied.",
        "symptoms": [], "triage": "SELF_CARE",
        "recs": ["Continue dual therapy", "Annual kidney function test", "Maintain low-salt diet"],
        "messages": [
            {"role":"user","content":"BP was 130/82 today! Best reading I've ever had."},
            {"role":"assistant","content":"That is excellent — 130/82 is in the optimal range. What changed?"},
            {"role":"user","content":"Less stress, more prayer time, and evening walks with my daughter."},
            {"role":"assistant","content":"Stress reduction is powerful medicine. You've achieved this through lifestyle and medication together. Book your annual kidney check — diuretics need this monitored."},
        ]
    },
],

"P_77BB4EA7": [  # Bakary Camara — heart disease, COPD
    {
        "summary": "Combined symptoms: breathlessness + chest heaviness after midday prayer. Patient 67 years old with two serious conditions. High risk profile. Immediate assessment requested.",
        "symptoms": ["chest heaviness","dyspnoea","bilateral leg oedema"], "triage": "FACILITY",
        "recs": ["Urgent facility visit", "Bisoprolol and Ipratropium taken", "Avoid exertion"],
        "messages": [
            {"role":"user","content":"After prayer I had chest heaviness and couldn't breathe properly. My legs are very swollen too."},
            {"role":"assistant","content":"These three symptoms together — chest heaviness, breathlessness, and leg swelling — are serious warning signs in someone with heart disease and COPD. Have you taken all medications today?"},
            {"role":"user","content":"Yes Bisoprolol and inhaler. But still feeling heavy."},
            {"role":"assistant","content":"Please go to the health facility today without delay. This combination needs urgent professional evaluation. Call ahead so they expect you."},
        ]
    },
    {
        "summary": "Facility review: mild decompensated heart failure — fluid overload. Furosemide (water tablet) added. Patient educated on daily weight monitoring.",
        "symptoms": ["improving oedema","fatigue"], "triage": "SELF_CARE",
        "recs": ["New: Furosemide 40mg once daily", "Weigh daily — gain 2kg in 2 days = alert flag", "Fluid restriction: 1.5L/day"],
        "messages": [
            {"role":"user","content":"The doctors added a water tablet. I passed a lot of urine yesterday."},
            {"role":"assistant","content":"That's the Furosemide working — clearing excess fluid from your lungs and legs. How is the swelling today?"},
            {"role":"user","content":"Much less swelling. Breathing easier."},
            {"role":"assistant","content":"Good response. Weigh yourself every morning before breakfast. If you gain 2kg in 2 days, contact the facility immediately — that signals fluid is building again."},
        ]
    },
    {
        "summary": "Stable on three medications. Weight stable at 71kg for one week. COPD symptoms well controlled. Sleep quality improved.",
        "symptoms": ["mild morning cough"], "triage": "SELF_CARE",
        "recs": ["Continue all 3 medications", "Daily weight log", "Flu vaccine due"],
        "messages": [
            {"role":"user","content":"Weight steady at 71kg for 7 days. Breathing is the best it's been."},
            {"role":"assistant","content":"Stable weight for a week is excellent news — it means the heart failure is controlled. How are you sleeping?"},
            {"role":"user","content":"Better. I only need one pillow now."},
            {"role":"assistant","content":"That's a significant improvement — needing fewer pillows means less fluid in the lungs. You're due for a flu vaccine which is very important with your heart and lung conditions."},
        ]
    },
    {
        "summary": "Patient's family reports increased confusion and reduced appetite for 2 days. Home visit by CHW confirmed low sodium. Furosemide dose being reviewed by doctor.",
        "symptoms": ["confusion","reduced appetite","weakness"], "triage": "FACILITY",
        "recs": ["Facility visit for electrolyte check", "Possible Furosemide dose reduction needed"],
        "messages": [
            {"role":"user","content":"My family says I've been confused and not eating for 2 days."},
            {"role":"assistant","content":"Confusion with Furosemide can indicate low sodium or potassium — an electrolyte imbalance. Have you had any blood tests recently?"},
            {"role":"user","content":"Last test was 3 months ago."},
            {"role":"assistant","content":"Please go to the facility today for urgent electrolyte blood tests. Do not take Furosemide until the doctor reviews your result."},
        ]
    },
    {
        "summary": "Electrolytes corrected. Furosemide reduced to 20mg daily. Eating well again. Family monitoring closely. Condition stable but fragile.",
        "symptoms": ["mild fatigue"], "triage": "SELF_CARE",
        "recs": ["Reduced Furosemide 20mg", "High-potassium foods: banana, groundnuts", "Monthly electrolyte check"],
        "messages": [
            {"role":"user","content":"Blood tests fixed, I'm eating again. Doctor reduced the water tablet."},
            {"role":"assistant","content":"Glad to hear the confusion has resolved. Low potassium and sodium can cause this. Add potassium-rich foods — banana, groundnuts, sweet potato."},
            {"role":"user","content":"My daughter is cooking those for me now."},
            {"role":"assistant","content":"Family support is invaluable for recovery. Monthly electrolyte checks are essential on Furosemide."},
        ]
    },
],

"P_E76C1092": [  # Ndey Fatty — diabetes, hypertension
    {
        "summary": "Newly diagnosed dual condition — hypertension and diabetes identified together at routine screen. Patient overwhelmed. Counselling provided. Started on Metformin + Nifedipine.",
        "symptoms": ["newly diagnosed","anxiety","headache"], "triage": "CHW_VISIT",
        "recs": ["Start both medications as prescribed", "CHW education session", "Lifestyle changes explained"],
        "messages": [
            {"role":"user","content":"AMINA I just found out I have both diabetes AND high BP. I'm scared."},
            {"role":"assistant","content":"That's a lot to process at once. It's completely normal to feel scared. But both conditions are very manageable — millions of people live healthy lives with both."},
            {"role":"user","content":"Do I have to take tablets forever?"},
            {"role":"assistant","content":"Possibly yes, but medications are tools that protect your heart and kidneys. Your CHW will explain everything and support you. You are not alone in this."},
        ]
    },
    {
        "summary": "2-week follow-up. Patient adapting well to dual diagnosis. BP 138/88 on Nifedipine. Glucose 8.4 fasting. Medication tolerance good.",
        "symptoms": ["mild ankle swelling from Nifedipine"], "triage": "SELF_CARE",
        "recs": ["Ankle swelling expected — will reduce", "Log both BP and glucose daily", "CHW follow-up next week"],
        "messages": [
            {"role":"user","content":"Two weeks on tablets. BP is 138/88 and glucose 8.4. Ankles a bit swollen."},
            {"role":"assistant","content":"Good early response to both medications! Ankle swelling is a common Nifedipine side effect that usually improves in 4-6 weeks."},
            {"role":"user","content":"I'm keeping a log like you said."},
            {"role":"assistant","content":"That's exactly what I hoped. A log shows trends that single readings can't. Keep it up for the CHW visit."},
        ]
    },
    {
        "summary": "Patient managing well. 1-month results: BP 134/84, glucose 7.9. Lost 1.5kg through dietary changes. Motivated and engaged with care plan.",
        "symptoms": [], "triage": "SELF_CARE",
        "recs": ["Continue current medications", "Target fasting glucose below 7.0", "Increase activity"],
        "messages": [
            {"role":"user","content":"1 month in! BP 134/84, glucose 7.9. Lost 1.5kg!"},
            {"role":"assistant","content":"Fantastic progress in just one month! You've embraced this challenge beautifully. How do you feel?"},
            {"role":"user","content":"Better than I expected. The diet changes weren't as hard as I thought."},
            {"role":"assistant","content":"The first month is always the hardest. Now it becomes routine. Target fasting glucose below 7.0 — you're almost there."},
        ]
    },
    {
        "summary": "Patient asks about pregnancy planning with both conditions. Discussed importance of pre-conception counselling with specialist — Metformin and Nifedipine implications reviewed.",
        "symptoms": [], "triage": "FACILITY",
        "recs": ["Specialist pre-conception counselling", "Diabetes and hypertension in pregnancy require careful management"],
        "messages": [
            {"role":"user","content":"AMINA I want to get pregnant. Is it safe with my conditions?"},
            {"role":"assistant","content":"It can be, but it requires careful planning and specialist involvement before conception. Both diabetes and hypertension during pregnancy need special management."},
            {"role":"user","content":"What should I do first?"},
            {"role":"assistant","content":"Book an appointment with a doctor who specialises in high-risk pregnancy. Get your HbA1c below 6.5% before conceiving — good glucose control in the first weeks is critical for the baby."},
        ]
    },
    {
        "summary": "Stable check-in. All readings within target. Patient exercising regularly, diet maintained. Self-management confidence high.",
        "symptoms": [], "triage": "SELF_CARE",
        "recs": ["Annual kidney function and eye check", "Continue all lifestyle changes"],
        "messages": [
            {"role":"user","content":"BP 128/82, glucose 6.8. I've been going to aerobics class 3 times a week!"},
            {"role":"assistant","content":"You are a model patient, Ndey! 128/82 and 6.8 are excellent targets. Aerobics is perfect for both conditions."},
            {"role":"user","content":"Thank you AMINA. You gave me confidence."},
            {"role":"assistant","content":"You did the work. Book your annual kidney and eye checks — both conditions can affect these organs over time."},
        ]
    },
],

"P_8E766DE2": [  # Momodou Drammeh — hypertension, CKD
    {
        "summary": "Bilateral leg swelling worsening over 2 weeks. Reduced urine output. BP 170/104. Creatinine at last test was elevated at 180 umol/L. Urgent facility referral for kidney function.",
        "symptoms": ["leg oedema","reduced urine output","high BP","fatigue"], "triage": "FACILITY",
        "recs": ["URGENT: facility visit for renal panel", "Avoid NSAIDs (Ibuprofen)", "Low-protein diet discussion"],
        "messages": [
            {"role":"user","content":"AMINA my legs are very swollen and I'm urinating less than before."},
            {"role":"assistant","content":"With your kidney disease, reduced urination and swelling are serious warning signs. What was your last creatinine result?"},
            {"role":"user","content":"The doctor said 180. Is that bad?"},
            {"role":"assistant","content":"180 is elevated — normal is below 110. Combined with your current symptoms, you need an urgent kidney function test today. Go to the facility now. Do you take any pain tablets like Ibuprofen?"},
            {"role":"user","content":"Yes sometimes for back pain."},
            {"role":"assistant","content":"Stop immediately — NSAIDs are very harmful to kidneys. Tell the doctor today."},
        ]
    },
    {
        "summary": "Facility results: creatinine 210, eGFR 28 — CKD stage 4. Nephrologist referral pending. Ramipril continued but reviewed. Strict protein restriction advised.",
        "symptoms": ["fatigue","mild nausea"], "triage": "FACILITY",
        "recs": ["Nephrologist referral", "Protein: max 0.8g/kg/day", "No NSAIDs ever", "Monthly renal panel"],
        "messages": [
            {"role":"user","content":"Tests back. Creatinine 210, GFR 28. Doctor said CKD stage 4."},
            {"role":"assistant","content":"Stage 4 is advanced kidney disease — it needs a nephrologist (kidney specialist). Has the referral been made?"},
            {"role":"user","content":"Yes, appointment in 3 weeks."},
            {"role":"assistant","content":"Good. In the meantime — strict protein restriction: no large meat portions. Fish is better. No Ibuprofen ever. Monthly kidney tests are essential from now on."},
        ]
    },
    {
        "summary": "Nephrologist visit. Dialysis not yet required but likely within 1-2 years without better BP control. Target BP below 130/80. Ramipril dose optimised.",
        "symptoms": ["fatigue","muscle cramps"], "triage": "SELF_CARE",
        "recs": ["Target BP 130/80", "Ramipril now 10mg", "Phosphate restriction: limit dairy", "Vitamin D supplement"],
        "messages": [
            {"role":"user","content":"Nephrologist said dialysis might be needed in 1-2 years. I'm very worried."},
            {"role":"assistant","content":"That's hard news to receive. But the timeline can be extended significantly with very good BP control. Every mmHg reduction matters for your kidneys."},
            {"role":"user","content":"What can I do differently?"},
            {"role":"assistant","content":"Take Ramipril exactly as prescribed. Aim for BP below 130/80. Limit dairy to preserve phosphate balance. Take the Vitamin D supplement. Each day of good control adds time."},
        ]
    },
    {
        "summary": "BP improving: 138/88. Oedema reduced after Furosemide added. Muscle cramps from low magnesium — supplement added. Energy somewhat better.",
        "symptoms": ["muscle cramps — improving","mild fatigue"], "triage": "SELF_CARE",
        "recs": ["Magnesium supplement for cramps", "Continue Furosemide + Ramipril", "Weekly weights"],
        "messages": [
            {"role":"user","content":"BP is 138/88. Less swelling. But I keep getting leg cramps at night."},
            {"role":"assistant","content":"Leg cramps with CKD and diuretics suggest low magnesium. Did the doctor check your magnesium level?"},
            {"role":"user","content":"It was slightly low. They gave me a supplement."},
            {"role":"assistant","content":"Good — the supplement should help within a week. Keep doing the weekly weight checks to monitor fluid balance."},
        ]
    },
    {
        "summary": "Best review in months. BP 132/84. Creatinine stable at 215 — no further decline. Nephrologist pleased with progress. Continue current regime.",
        "symptoms": ["mild fatigue"], "triage": "SELF_CARE",
        "recs": ["Maintain current regime", "Continue monthly renal panel", "CKD support group mentioned"],
        "messages": [
            {"role":"user","content":"Creatinine stable at 215 — no change in 2 months. Nephrologist is happy."},
            {"role":"assistant","content":"Stability is the goal with CKD — no progression is a success. How is your BP?"},
            {"role":"user","content":"132/84. Best it's been."},
            {"role":"assistant","content":"Excellent. You're doing everything right. Your nephrologist mentioned this is possible with strict adherence. Your kidneys are being protected by your effort."},
        ]
    },
],

}

# ── Insert all consultations ────────────────────────────────────────────────────
now = datetime.now()
total = 0

for patient_id, cons_list in CONSULTATIONS.items():
    for i, con in enumerate(cons_list):
        days_ago = len(cons_list) * 4 - i * 4 + random.randint(0, 2)
        start = now - timedelta(days=days_ago, hours=random.randint(8,16))
        end   = start + timedelta(minutes=random.randint(8, 20))

        cid_val = cid()

        # Check if consultation count for patient is below limit (avoid duplicates on re-run)
        existing = sql("SELECT count(*) as cnt FROM ConsultationRecord WHERE patient_id = :pid", {"pid": patient_id})
        count = int(existing[0].get("cnt", 0)) if existing else 0
        if count >= 8:
            print(f"  Skipping {patient_id} — already has {count} consultations")
            break

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
            # Create HasConsultation edge
            try:
                sql(
                    "CREATE EDGE HasConsultation "
                    "FROM (SELECT FROM PatientVertex WHERE id = :pid) "
                    "TO (SELECT FROM ConsultationRecord WHERE id = :cid)",
                    {"pid": patient_id, "cid": cid_val}
                )
            except Exception:
                pass  # Edge type may not exist — consultation still queryable by patient_id

            total += 1
            print(f"  [{patient_id}] #{i+1}: {con['triage']} — {con['summary'][:60]}...")
        except Exception as e:
            print(f"  [{patient_id}] #{i+1} FAILED: {e}")

    # Update patient consultation_count and last_consultation
    try:
        sql(
            "UPDATE PatientVertex SET consultation_count = :cnt, last_consultation = :lc "
            "WHERE id = :pid",
            {"cnt": len(cons_list), "lc": now.isoformat(), "pid": patient_id}
        )
    except Exception:
        pass

print(f"\nTotal consultations seeded: {total}")
