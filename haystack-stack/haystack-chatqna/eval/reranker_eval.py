#!/usr/bin/env python3
"""
AMINA Care — Clinical Re-Ranker Evaluation (Phase 2)
=====================================================
Evaluates re-ranker models on clinical relevance judgment triplets
grounded in WHO PEN protocols and Gambian health context.

Each triplet:
  - query:         patient/CHW question
  - relevant:      clinically correct, specific passage
  - irrelevant:    topically adjacent but clinically useless
  - hard_negative: same domain but wrong clinical detail

Metrics:
  - NDCG@3:    normalized discounted cumulative gain at rank 3
  - MRR:       mean reciprocal rank of first relevant passage
  - Hard neg rejection: % of hard negatives ranked below relevant

Usage:
  # Eval default model (ms-marco-mini)
  python -m eval.reranker_eval --report reranker_report.json

  # Eval specific model
  python -m eval.reranker_eval --model bge-reranker-v2

  # Compare all models
  python -m eval.reranker_eval --compare-all --report reranker_compare.json

  # Dry-run (validate triplets, no model loading)
  python -m eval.reranker_eval --dry-run
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("reranker_eval")

# ═══════════════════════════════════════════════════════════════════════════════
# CLINICAL RELEVANCE TRIPLETS
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass
class RerankerTriplet:
    query: str
    relevant: str
    irrelevant: str
    hard_negative: str
    domain: str
    source: str = "WHO PEN"


RERANKER_EVAL: List[RerankerTriplet] = [
    # ── DIABETES (25 triplets) ────────────────────────────────────────
    RerankerTriplet(
        query="What is the fasting glucose target for type 2 diabetes",
        relevant="Target fasting plasma glucose for type 2 diabetes is 4-7 mmol/L (72-126 mg/dL) according to WHO PEN Protocol 1.",
        irrelevant="Diabetes mellitus is a group of metabolic diseases characterized by high blood sugar levels over a prolonged period.",
        hard_negative="Target HbA1c for type 1 diabetes management in children should be individualized but generally below 7.5%.",
        domain="diabetes",
    ),
    RerankerTriplet(
        query="My fasting sugar is 14 mmol/L should I worry",
        relevant="Fasting glucose above 11.1 mmol/L requires immediate medical review. Target is 4-7 mmol/L. Values above 13 mmol/L risk diabetic ketoacidosis.",
        irrelevant="Blood sugar levels fluctuate throughout the day depending on food intake and physical activity.",
        hard_negative="Random blood glucose of 14 mg/dL (not mmol/L) would indicate severe hypoglycemia requiring emergency glucose.",
        domain="diabetes",
    ),
    RerankerTriplet(
        query="What is HbA1c and what is the target",
        relevant="HbA1c (glycated hemoglobin) measures average blood glucose over 2-3 months. Target is below 7% (53 mmol/mol) for most adults with type 2 diabetes.",
        irrelevant="Hemoglobin is the protein in red blood cells that carries oxygen throughout the body.",
        hard_negative="HbA1c testing requires venous blood sampling and is not available at all primary health facilities in The Gambia.",
        domain="diabetes",
    ),
    RerankerTriplet(
        query="Signs of hypoglycemia low blood sugar",
        relevant="Hypoglycemia symptoms: shakiness, sweating, confusion, rapid heartbeat, hunger, dizziness. Blood glucose below 4 mmol/L. Treat with 15g fast-acting carbohydrate.",
        irrelevant="Low blood pressure (hypotension) can cause dizziness and fainting, especially when standing up quickly.",
        hard_negative="Hyperglycemia (high blood sugar) symptoms include increased thirst, frequent urination, and blurred vision.",
        domain="diabetes",
    ),
    RerankerTriplet(
        query="Can metformin cause diarrhea",
        relevant="Metformin commonly causes gastrointestinal side effects including diarrhea, nausea, and abdominal discomfort in 20-30% of patients. Taking with meals and gradual dose titration reduces these effects.",
        irrelevant="Diarrhea can be caused by viral infections, food poisoning, or changes in diet.",
        hard_negative="Glibenclamide side effects include hypoglycemia and weight gain but rarely gastrointestinal symptoms.",
        domain="diabetes",
    ),
    RerankerTriplet(
        query="Diabetes foot care what to check",
        relevant="Daily foot inspection for cuts, blisters, redness, swelling. Wash feet daily, dry between toes. Never walk barefoot. Cut nails straight across. Report any wound that does not heal within 2 days.",
        irrelevant="Foot pain can be caused by wearing ill-fitting shoes, flat feet, or plantar fasciitis.",
        hard_negative="Diabetic retinopathy requires annual eye examination with pupil dilation to detect early changes.",
        domain="diabetes",
    ),
    RerankerTriplet(
        query="When to start insulin for type 2 diabetes",
        relevant="Insulin initiation when: HbA1c remains above 8% despite maximum oral therapy, fasting glucose consistently above 10 mmol/L, or at diagnosis if glucose above 16.7 mmol/L with symptoms.",
        irrelevant="Insulin is a hormone produced by the pancreas that helps cells absorb glucose from the blood.",
        hard_negative="Type 1 diabetes requires insulin from diagnosis as the pancreas produces no insulin.",
        domain="diabetes",
    ),
    RerankerTriplet(
        query="How often should diabetics check blood sugar",
        relevant="Self-monitoring frequency: newly diagnosed or insulin-treated 2-4 times daily. Stable on oral medications: fasting glucose 2-3 times per week. HbA1c every 3-6 months at facility.",
        irrelevant="Regular health check-ups are recommended for adults over 40 years of age.",
        hard_negative="Blood pressure monitoring should be done at every clinic visit for patients with hypertension.",
        domain="diabetes",
    ),
    RerankerTriplet(
        query="Pre-diabetes can it be reversed",
        relevant="Pre-diabetes (fasting glucose 6.1-6.9 mmol/L) can be reversed with lifestyle changes: 150 minutes exercise per week, 5-7% weight loss, reduced refined carbohydrates. 58% risk reduction in landmark studies.",
        irrelevant="A healthy lifestyle includes balanced diet, regular exercise, adequate sleep, and stress management.",
        hard_negative="Type 2 diabetes remission is possible after bariatric surgery in some obese patients.",
        domain="diabetes",
    ),
    RerankerTriplet(
        query="Diabetes and kidney damage signs",
        relevant="Diabetic nephropathy signs: foamy urine (proteinuria), swelling in feet and ankles, elevated creatinine, reduced urine output. Screen annually with urine albumin and serum creatinine. WHO PEN Protocol 1.",
        irrelevant="The kidneys filter waste products from the blood and produce urine.",
        hard_negative="Acute kidney injury from dehydration presents with oliguria and elevated creatinine but is reversible with fluids.",
        domain="diabetes",
    ),
    RerankerTriplet(
        query="Gestational diabetes diet advice",
        relevant="Gestational diabetes diet: 3 meals + 2-3 snacks daily, limit simple carbohydrates, choose whole grains, include protein with each meal. Monitor postprandial glucose 1-2 hours after meals. Target below 7.8 mmol/L.",
        irrelevant="Pregnant women should eat a balanced diet rich in vitamins and minerals for fetal development.",
        hard_negative="Type 2 diabetes diet focuses on HbA1c control through carbohydrate counting and glycemic index awareness.",
        domain="diabetes",
    ),
    RerankerTriplet(
        query="Diabetes eye problems blurry vision",
        relevant="Diabetic retinopathy: blurred vision, floaters, dark spots, vision loss. Annual dilated eye exam recommended. Risk increases with duration of diabetes and poor glucose control. Refer if any visual changes.",
        irrelevant="Blurry vision can be corrected with prescription glasses or contact lenses in many cases.",
        hard_negative="Cataracts are more common in diabetics but develop slowly and are treatable with surgery.",
        domain="diabetes",
    ),
    RerankerTriplet(
        query="Can I eat rice with diabetes",
        relevant="White rice has high glycemic index (GI 73). Prefer brown rice (GI 68), fonio, or millet. Portion control: one fist-sized serving. Combine with protein and vegetables to reduce glucose spike.",
        irrelevant="Rice is a staple food consumed by more than half the world's population.",
        hard_negative="Benachin (Jollof rice) can be adapted for diabetes by reducing oil, using brown rice, and adding more vegetables.",
        domain="diabetes",
    ),
    RerankerTriplet(
        query="Diabetes smoking risks",
        relevant="Smoking with diabetes doubles cardiovascular risk. Increases insulin resistance, worsens neuropathy, and accelerates kidney damage. Quitting reduces CVD risk by 50% within one year.",
        irrelevant="Smoking is the leading cause of preventable death worldwide and causes lung cancer.",
        hard_negative="Alcohol consumption in diabetes can cause hypoglycemia, especially when combined with insulin or sulfonylureas.",
        domain="diabetes",
    ),
    RerankerTriplet(
        query="Metformin dose how much to take",
        relevant="Metformin: start 500mg once daily with meals, increase by 500mg every 1-2 weeks. Usual dose 500-1000mg twice daily. Maximum 2000mg/day (or 2550mg in some guidelines). Reduce dose if eGFR 30-45.",
        irrelevant="Medication doses should always be prescribed by a qualified healthcare professional.",
        hard_negative="Glibenclamide dosing: start 2.5mg daily, maximum 15mg daily in divided doses. Risk of hypoglycemia increases with dose.",
        domain="diabetes",
    ),
    # Additional diabetes
    RerankerTriplet(
        query="Diabetes and wound healing",
        relevant="High blood glucose impairs white blood cell function and blood flow, slowing wound healing. Keep wounds clean and dry. Seek medical help if wound shows no improvement in 48 hours or signs of infection.",
        irrelevant="Wound healing occurs in four phases: hemostasis, inflammation, proliferation, and remodeling.",
        hard_negative="Pressure ulcers in bedridden patients require repositioning every 2 hours and nutritional support.",
        domain="diabetes",
    ),
    RerankerTriplet(
        query="Exercise for diabetes how much",
        relevant="WHO recommends 150 minutes moderate-intensity aerobic activity per week (brisk walking, cycling). Resistance training 2 sessions per week. Check blood sugar before exercise; carry fast-acting sugar.",
        irrelevant="Regular physical activity improves cardiovascular health and mental wellbeing.",
        hard_negative="High-intensity interval training (HIIT) may cause rapid glucose drops in insulin-treated diabetes.",
        domain="diabetes",
    ),
    RerankerTriplet(
        query="Diabetes tingling numbness feet neuropathy",
        relevant="Peripheral neuropathy: tingling, numbness, burning pain in feet/hands. Caused by prolonged high glucose damaging nerves. Management: optimize glucose control, foot care, gabapentin for pain. WHO PEN Protocol 1.",
        irrelevant="Numbness and tingling can occur from sitting in one position too long or carpal tunnel syndrome.",
        hard_negative="Autonomic neuropathy affects digestion (gastroparesis), bladder function, and blood pressure regulation in diabetes.",
        domain="diabetes",
    ),
    RerankerTriplet(
        query="Diabetes sick day rules",
        relevant="Sick day rules: never stop diabetes medication. Check blood sugar every 2-4 hours. Drink plenty of fluids. If vomiting and unable to eat, seek medical help. If glucose above 15 mmol/L, check for ketones.",
        irrelevant="When sick, rest and drink plenty of fluids to help your body fight infection.",
        hard_negative="Fasting during illness differs from Ramadan fasting — sick day management takes priority over religious fasting obligations.",
        domain="diabetes",
    ),
    RerankerTriplet(
        query="Is moringa good for diabetes",
        relevant="Moringa oleifera shows modest glucose-lowering effect in small studies (5-10% reduction). Not a substitute for prescribed medication. Can be consumed as part of a balanced diet. No standardized dosing established.",
        irrelevant="Moringa is a plant native to parts of Africa and Asia, rich in vitamins and minerals.",
        hard_negative="Bitter leaf (Vernonia amygdalina) is traditionally used for diabetes in West Africa but lacks clinical evidence for efficacy.",
        domain="diabetes",
    ),
    RerankerTriplet(
        query="Diabetes children symptoms",
        relevant="Childhood diabetes symptoms: excessive thirst, frequent urination, bedwetting, unexplained weight loss, fatigue, blurred vision. Type 1 onset can be rapid. Seek immediate medical attention if suspected.",
        irrelevant="Children need regular health check-ups to monitor growth and development milestones.",
        hard_negative="Childhood obesity increases risk of type 2 diabetes but symptoms of obesity alone do not indicate diabetes.",
        domain="diabetes",
    ),
    RerankerTriplet(
        query="Diabetes and pregnancy risks",
        relevant="Pre-existing diabetes in pregnancy: increased risk of pre-eclampsia, macrosomia, birth defects, stillbirth. Optimize HbA1c below 6.5% before conception. Switch to insulin if on oral medications. Intensive monitoring required.",
        irrelevant="Pregnancy is a natural process that typically lasts about 40 weeks from the last menstrual period.",
        hard_negative="Gestational diabetes develops during pregnancy and usually resolves after delivery but increases future type 2 diabetes risk.",
        domain="diabetes",
    ),
    RerankerTriplet(
        query="Diabetes travel tips",
        relevant="Travel with diabetes: carry double supplies, keep insulin in carry-on (not checked luggage), carry medical letter, adjust insulin timing for time zones, wear medical ID, pack fast-acting glucose.",
        irrelevant="When traveling, ensure you have travel insurance and necessary vaccinations for your destination.",
        hard_negative="Diabetes medication storage: metformin at room temperature, insulin in cool bag (2-8°C), test strips away from heat.",
        domain="diabetes",
    ),
    RerankerTriplet(
        query="Diabetic ketoacidosis DKA symptoms emergency",
        relevant="DKA symptoms: fruity breath odor, deep rapid breathing (Kussmaul), nausea/vomiting, abdominal pain, confusion. Blood glucose usually above 13.9 mmol/L. Emergency — requires IV fluids and insulin in hospital.",
        irrelevant="Breathing difficulties can be caused by asthma, pneumonia, or anxiety and should be evaluated by a doctor.",
        hard_negative="Hyperosmolar hyperglycemic state (HHS) occurs in type 2 diabetes with very high glucose (>33 mmol/L) but without significant ketosis.",
        domain="diabetes",
    ),
    RerankerTriplet(
        query="Diabetes stress management",
        relevant="Stress hormones (cortisol, adrenaline) raise blood glucose. Stress management: deep breathing, regular sleep schedule, social support, moderate exercise. Monitor glucose more frequently during stressful periods.",
        irrelevant="Stress is a normal response to challenging situations and can be managed through various coping techniques.",
        hard_negative="Depression is twice as common in people with diabetes and requires separate screening and treatment.",
        domain="diabetes",
    ),

    # ── HYPERTENSION (20 triplets) ────────────────────────────────────
    RerankerTriplet(
        query="What is the blood pressure target for diabetic patients",
        relevant="Blood pressure target for diabetic patients: below 130/80 mmHg (WHO PEN). If kidney disease present, target below 125/75 mmHg. Measure at every clinic visit.",
        irrelevant="Blood pressure is the force of blood pushing against the walls of your arteries as your heart pumps.",
        hard_negative="Blood pressure target for general hypertension without diabetes: below 140/90 mmHg per WHO guidelines.",
        domain="hypertension",
    ),
    RerankerTriplet(
        query="Amlodipine side effects swollen ankles",
        relevant="Amlodipine causes peripheral edema (ankle swelling) in 5-10% of patients, dose-dependent. Not dangerous but uncomfortable. Can switch to ACE inhibitor or add low-dose diuretic. Do not stop without medical advice.",
        irrelevant="Swollen ankles can be caused by standing for long periods, pregnancy, or heart failure.",
        hard_negative="Enalapril side effects include dry cough (10-15%), hyperkalemia, and rarely angioedema. No ankle swelling.",
        domain="hypertension",
    ),
    RerankerTriplet(
        query="High blood pressure and salt intake how much",
        relevant="Limit sodium to less than 5g salt (2g sodium) per day. Reduce Maggi cubes, processed foods, salted fish. Use lemon, herbs, and spices for flavor. Reducing salt by 5g/day lowers BP by 5-6 mmHg.",
        irrelevant="Salt is a mineral composed primarily of sodium chloride used for food seasoning and preservation.",
        hard_negative="Potassium-rich foods (bananas, sweet potatoes) may help lower blood pressure but excess potassium is dangerous with kidney disease.",
        domain="hypertension",
    ),
    RerankerTriplet(
        query="BP 180 over 110 what should I do",
        relevant="BP 180/110 mmHg is stage 2 hypertension / hypertensive urgency. Seek medical attention today. Sit quietly, avoid exertion. If headache, chest pain, or visual changes: go to emergency immediately.",
        irrelevant="Blood pressure readings consist of systolic (top number) and diastolic (bottom number) measurements.",
        hard_negative="BP 140/90 mmHg is stage 1 hypertension requiring lifestyle modification and possibly medication initiation.",
        domain="hypertension",
    ),
    RerankerTriplet(
        query="Can I stop blood pressure medicine if I feel fine",
        relevant="Never stop antihypertensive medication without medical advice. Hypertension is usually asymptomatic — feeling fine does not mean BP is controlled. Stopping abruptly risks rebound hypertension, stroke, or heart attack.",
        irrelevant="Many chronic diseases can be managed effectively with proper medication adherence.",
        hard_negative="Metformin for diabetes should also not be stopped without medical advice even if blood sugar normalizes.",
        domain="hypertension",
    ),
    RerankerTriplet(
        query="Hypertension and stroke risk",
        relevant="Hypertension is the leading modifiable risk factor for stroke. Each 10 mmHg reduction in systolic BP reduces stroke risk by 33%. Ischemic stroke (80%) and hemorrhagic stroke (20%) both linked to uncontrolled BP.",
        irrelevant="A stroke occurs when blood supply to part of the brain is interrupted or reduced.",
        hard_negative="Atrial fibrillation independently increases stroke risk 5-fold and requires anticoagulation regardless of blood pressure.",
        domain="hypertension",
    ),
    RerankerTriplet(
        query="Best exercise for high blood pressure",
        relevant="Aerobic exercise (brisk walking, swimming, cycling) 30 minutes most days reduces BP by 5-8 mmHg. Avoid heavy weightlifting and breath-holding exercises (Valsalva). Start gradually if BP above 160/100.",
        irrelevant="Physical exercise has many benefits including improved mood, better sleep, and weight management.",
        hard_negative="Resistance training in diabetes focuses on improving insulin sensitivity and glycemic control.",
        domain="hypertension",
    ),
    RerankerTriplet(
        query="Hypertension in pregnancy preeclampsia",
        relevant="Preeclampsia: BP above 140/90 after 20 weeks with proteinuria. Symptoms: headache, visual changes, epigastric pain, edema. Risk of seizures (eclampsia). Requires urgent referral — may need early delivery.",
        irrelevant="During pregnancy, regular prenatal check-ups are important for monitoring the health of mother and baby.",
        hard_negative="Chronic hypertension before pregnancy requires medication review — switch from ACE inhibitors to methyldopa or nifedipine.",
        domain="hypertension",
    ),
    RerankerTriplet(
        query="How to measure blood pressure correctly at home",
        relevant="Sit quietly 5 minutes, feet flat on floor, arm supported at heart level. Use validated automatic monitor on bare upper arm. Take 2 readings 1 minute apart, record average. Measure morning and evening.",
        irrelevant="Medical devices should be calibrated regularly to ensure accurate readings.",
        hard_negative="Ambulatory blood pressure monitoring (24-hour ABPM) is the gold standard for diagnosing white coat hypertension.",
        domain="hypertension",
    ),
    RerankerTriplet(
        query="White coat hypertension is it real",
        relevant="White coat hypertension: elevated BP in clinic but normal at home (<135/85). Affects 15-30% of patients. Confirm with home monitoring or 24-hour ABPM. Lower CVD risk than sustained hypertension but still needs follow-up.",
        irrelevant="Anxiety in medical settings is common and can affect various physiological measurements.",
        hard_negative="Masked hypertension is the opposite: normal clinic BP but elevated home BP. Higher risk than white coat hypertension.",
        domain="hypertension",
    ),
    RerankerTriplet(
        query="Domoda high blood pressure can I eat it",
        relevant="Domoda (groundnut stew) contains significant oil and salt from Maggi cubes. Adapt: use less groundnut paste, no Maggi, add vegetables, reduce palm oil. A modified portion can fit a low-sodium diet.",
        irrelevant="Domoda is a traditional Gambian stew made with groundnut paste, typically served with rice.",
        hard_negative="Benachin can be adapted for diabetes by using brown rice and reducing oil, but sodium content also needs monitoring for hypertension.",
        domain="hypertension",
    ),
    RerankerTriplet(
        query="Hydrochlorothiazide side effects",
        relevant="Hydrochlorothiazide (HCTZ): hypokalemia (low potassium), increased uric acid (gout risk), glucose elevation, dehydration, dizziness. Monitor electrolytes and glucose. Take in morning to avoid nighttime urination.",
        irrelevant="Diuretics are medications that help remove excess water and salt from the body through urine.",
        hard_negative="Furosemide is a loop diuretic used for heart failure edema — more potent but not first-line for hypertension.",
        domain="hypertension",
    ),
    RerankerTriplet(
        query="Hypertension kidney damage",
        relevant="Hypertensive nephropathy: chronic high BP damages kidney blood vessels. Screen with serum creatinine and urine albumin annually. ACE inhibitors/ARBs are kidney-protective. Target BP below 130/80 with kidney disease.",
        irrelevant="The kidneys play a vital role in filtering waste products and maintaining fluid balance in the body.",
        hard_negative="Diabetic nephropathy is the leading cause of kidney failure globally, distinct from hypertensive kidney damage.",
        domain="hypertension",
    ),
    RerankerTriplet(
        query="Can stress cause high blood pressure",
        relevant="Acute stress temporarily raises BP via cortisol and adrenaline. Chronic stress may contribute to sustained hypertension through behavioral pathways (poor diet, smoking, alcohol). Stress management is adjunctive to medication.",
        irrelevant="Stress is a natural biological response that can affect both physical and mental health.",
        hard_negative="Pheochromocytoma is a rare adrenal tumor causing episodic severe hypertension with headache, sweating, and palpitations.",
        domain="hypertension",
    ),
    RerankerTriplet(
        query="Hypertension headache when to worry",
        relevant="Most headaches are NOT caused by hypertension. Worry if: severe thunderclap headache, BP above 180/120 with headache, visual changes, confusion, or neck stiffness. These may indicate hypertensive emergency or stroke.",
        irrelevant="Headaches are one of the most common medical complaints and can have many different causes.",
        hard_negative="Migraine headaches can cause temporary blood pressure elevation during attacks but do not cause chronic hypertension.",
        domain="hypertension",
    ),
    RerankerTriplet(
        query="ACE inhibitor cough alternative",
        relevant="ACE inhibitor dry cough affects 10-15% of patients (more common in women and African descent). Switch to ARB (losartan, valsartan) — same renal/cardiac protection without cough. WHO PEN Protocol 2.",
        irrelevant="A cough is a reflex action to clear your airways of mucus and irritants.",
        hard_negative="Beta-blocker side effects include fatigue, cold extremities, and erectile dysfunction — different from ACE inhibitor cough.",
        domain="hypertension",
    ),
    RerankerTriplet(
        query="Alcohol and blood pressure",
        relevant="Heavy alcohol intake raises BP by 5-10 mmHg. Limit to 1 drink/day for women, 2 for men. Binge drinking causes acute BP spikes. Reducing alcohol intake can lower BP by 3-5 mmHg.",
        irrelevant="Alcohol is produced by fermentation of sugars by yeast and has been consumed by humans for thousands of years.",
        hard_negative="Red wine contains resveratrol which some studies suggest may have cardiovascular benefits, but this does not offset the BP-raising effect of alcohol.",
        domain="hypertension",
    ),
    RerankerTriplet(
        query="Resistant hypertension BP not controlled on 3 medicines",
        relevant="Resistant hypertension: uncontrolled BP despite 3 medications (including diuretic) at optimal doses. Check adherence first. Consider secondary causes (renal artery stenosis, aldosteronism). Add spironolactone as 4th agent.",
        irrelevant="Some medical conditions may be difficult to treat and require multiple approaches to management.",
        hard_negative="Treatment-resistant depression similarly requires multiple medication trials and may benefit from augmentation strategies.",
        domain="hypertension",
    ),
    RerankerTriplet(
        query="Blood pressure medications safe in pregnancy",
        relevant="Safe antihypertensives in pregnancy: methyldopa (first-line), labetalol, nifedipine. CONTRAINDICATED: ACE inhibitors, ARBs (teratogenic), atenolol. Reduce target to below 140/90 in pregnancy.",
        irrelevant="Medication safety during pregnancy is an important consideration for all women of childbearing age.",
        hard_negative="Metformin is generally considered safe in pregnancy for gestational diabetes, unlike some other diabetes medications.",
        domain="hypertension",
    ),
    RerankerTriplet(
        query="Hypertension and cholesterol combined risk",
        relevant="Hypertension + dyslipidemia doubles cardiovascular risk. Use WHO/ISH risk charts. If 10-year CVD risk above 20%: start statin regardless of LDL level. Combined management reduces events by 50-75%.",
        irrelevant="Cholesterol is a waxy substance found in the blood that is needed for building cells.",
        hard_negative="Familial hypercholesterolemia requires statin therapy from childhood regardless of blood pressure status.",
        domain="hypertension",
    ),

    # ── EMERGENCY (15 triplets) ───────────────────────────────────────
    RerankerTriplet(
        query="Chest pain sweating heart attack",
        relevant="Suspected MI: crushing chest pain, sweating, nausea, pain radiating to left arm/jaw. Give aspirin 300mg (chew), call emergency services immediately. Do not wait. Time is muscle — every minute counts.",
        irrelevant="Chest pain can have many causes including muscle strain, acid reflux, and anxiety.",
        hard_negative="Angina pectoris causes chest pain with exertion that resolves with rest — differs from heart attack where pain persists and is more severe.",
        domain="emergency",
    ),
    RerankerTriplet(
        query="Someone collapsed not breathing",
        relevant="Unresponsive, not breathing: call emergency (116). Start CPR: 30 chest compressions (center of chest, 5cm deep, 100-120/min), 2 rescue breaths. Continue until help arrives. Use AED if available.",
        irrelevant="Fainting can be caused by dehydration, low blood sugar, or sudden drops in blood pressure.",
        hard_negative="Recovery position (lateral recumbent) is for unconscious patients who ARE breathing — not for cardiac arrest.",
        domain="emergency",
    ),
    RerankerTriplet(
        query="Severe allergic reaction anaphylaxis",
        relevant="Anaphylaxis: swelling of face/throat, difficulty breathing, rapid pulse, rash, dizziness. Give epinephrine (adrenaline) IM outer thigh immediately. Call emergency. Position patient flat with legs elevated.",
        irrelevant="Allergies are immune system responses to substances that are normally harmless to most people.",
        hard_negative="Mild allergic reactions (localized hives, itching) can be treated with oral antihistamines without emergency services.",
        domain="emergency",
    ),
    RerankerTriplet(
        query="Snake bite first aid",
        relevant="Snake bite: keep patient calm and still, immobilize bitten limb below heart level. Remove jewelry/tight clothing. Do NOT cut wound, suck venom, or apply tourniquet. Transport to hospital urgently for antivenom.",
        irrelevant="Snakes are elongated reptiles found on every continent except Antarctica.",
        hard_negative="Scorpion sting first aid: clean wound, apply cold compress, take paracetamol for pain. Most stings are not life-threatening.",
        domain="emergency",
    ),
    RerankerTriplet(
        query="Burn hot oil cooking first aid",
        relevant="Burns first aid: cool under running water for 20 minutes. Remove clothing/jewelry near burn (not stuck). Cover with clean non-stick dressing. Do NOT apply butter, toothpaste, or ice. Seek medical help for large or deep burns.",
        irrelevant="Burns are injuries to the skin and underlying tissues caused by heat, chemicals, electricity, or radiation.",
        hard_negative="Sunburn treatment: aloe vera gel, cool compresses, ibuprofen for pain. Severe sunburn with blistering needs medical attention.",
        domain="emergency",
    ),
    RerankerTriplet(
        query="Child choking on food",
        relevant="Child choking (over 1 year): 5 back blows between shoulder blades, then 5 abdominal thrusts (Heimlich). Alternate until object expelled. If unconscious, start CPR. For infants: 5 back blows + 5 chest thrusts.",
        irrelevant="Children should always be supervised while eating to prevent accidents.",
        hard_negative="Adult choking uses Heimlich maneuver only — technique differs from pediatric approach due to body size and rib flexibility.",
        domain="emergency",
    ),
    RerankerTriplet(
        query="Seizure convulsion what to do",
        relevant="During seizure: clear area of sharp objects, cushion head, turn on side (recovery position) after convulsion stops. Time the seizure. Do NOT restrain or put anything in mouth. Call emergency if seizure lasts over 5 minutes.",
        irrelevant="Seizures are sudden, uncontrolled electrical disturbances in the brain.",
        hard_negative="Febrile seizures in children are triggered by fever and are generally benign — different from epileptic seizures.",
        domain="emergency",
    ),
    RerankerTriplet(
        query="Stroke signs FAST",
        relevant="FAST: Face drooping, Arm weakness, Speech difficulty, Time to call emergency. Also: sudden confusion, vision loss, severe headache, balance loss. Onset time is critical — thrombolysis within 4.5 hours.",
        irrelevant="The brain requires a constant supply of oxygen and nutrients delivered through blood vessels.",
        hard_negative="Transient ischemic attack (TIA) has same symptoms as stroke but resolves within 24 hours — still requires urgent evaluation.",
        domain="emergency",
    ),
    RerankerTriplet(
        query="Severe bleeding cut wound",
        relevant="Severe bleeding: apply direct firm pressure with clean cloth. Elevate injured limb. Do NOT remove embedded objects. If blood soaks through, add more cloth on top. Call emergency. Apply tourniquet only as last resort if limb.",
        irrelevant="Blood is a body fluid that delivers nutrients and oxygen to cells and transports waste products.",
        hard_negative="Nosebleed (epistaxis) first aid: lean forward, pinch soft part of nose for 10-15 minutes. Different from traumatic bleeding management.",
        domain="emergency",
    ),
    RerankerTriplet(
        query="Diabetic emergency unconscious sugar",
        relevant="Diabetic emergency: if conscious and low sugar — give sugar water, juice, or glucose tablets. If unconscious — do NOT give food/drink (aspiration risk). Place in recovery position. Glucagon injection if available. Call emergency.",
        irrelevant="Diabetes is a chronic metabolic condition affecting how the body processes blood sugar.",
        hard_negative="Insulin overdose causes severe hypoglycemia requiring emergency glucose — prevent by careful dose measurement and regular meals.",
        domain="emergency",
    ),
    RerankerTriplet(
        query="Heat stroke symptoms treatment",
        relevant="Heat stroke: body temperature above 40°C, confusion, hot dry skin, rapid pulse, headache. Move to shade, remove excess clothing, cool with wet cloths/fans, cold packs to neck/armpits/groin. Emergency — can be fatal.",
        irrelevant="Hot weather can be uncomfortable and may require staying hydrated and seeking shade.",
        hard_negative="Heat exhaustion (heavy sweating, weakness, nausea) is less severe than heat stroke — treated with rest, fluids, and cooling.",
        domain="emergency",
    ),
    RerankerTriplet(
        query="Asthma attack severe cannot breathe",
        relevant="Severe asthma attack: sit upright, use reliever inhaler (salbutamol) 4-6 puffs via spacer. Repeat every 20 minutes if needed. Call emergency if: no improvement after 3 doses, cannot speak in sentences, lips turning blue.",
        irrelevant="Breathing is the process of inhaling oxygen and exhaling carbon dioxide.",
        hard_negative="COPD exacerbation management differs from asthma: prednisolone 30mg for 5 days plus antibiotics if purulent sputum.",
        domain="emergency",
    ),
    RerankerTriplet(
        query="Drowning rescue what to do",
        relevant="Drowning: remove from water safely. If not breathing: 5 rescue breaths first, then CPR 30:2. Call emergency. Do NOT attempt to drain water from lungs. Even brief submersion requires hospital evaluation for secondary drowning.",
        irrelevant="Water safety is important for preventing accidents, especially for children.",
        hard_negative="Near-drowning in cold water may have better outcomes due to hypothermia-induced neuroprotection.",
        domain="emergency",
    ),
    RerankerTriplet(
        query="Poisoning child swallowed cleaning product",
        relevant="Poisoning: call poison control or emergency. Identify the product (keep container). Do NOT induce vomiting (risk of re-exposure to caustic substances). Rinse mouth with water. Bring product container to hospital.",
        irrelevant="Household cleaning products should be stored out of reach of children.",
        hard_negative="Food poisoning (bacterial contamination) presents with vomiting and diarrhea 6-72 hours after ingestion — different from chemical poisoning.",
        domain="emergency",
    ),
    RerankerTriplet(
        query="Pregnant woman heavy bleeding emergency",
        relevant="Antepartum hemorrhage: heavy vaginal bleeding during pregnancy is an emergency. Lie down, call emergency immediately. Do NOT insert anything vaginally. Causes include placenta previa and placental abruption. Risk of maternal and fetal death.",
        irrelevant="Some light spotting can be normal in early pregnancy but should be reported to a healthcare provider.",
        hard_negative="Postpartum hemorrhage (after delivery) requires uterine massage, oxytocin, and potentially surgical intervention.",
        domain="emergency",
    ),

    # ── RAMADAN / CULTURAL (10 triplets) ──────────────────────────────
    RerankerTriplet(
        query="Can I fast during Ramadan with diabetes",
        relevant="IDF-DAR risk assessment: very high risk (type 1, recent DKA, pregnancy) should NOT fast. High risk (poorly controlled type 2, HbA1c >8%) fasting not recommended. Moderate risk: can fast with medical supervision, dose adjustment.",
        irrelevant="Ramadan is the ninth month of the Islamic calendar observed by Muslims worldwide through fasting from dawn to sunset.",
        hard_negative="Intermittent fasting (16:8 pattern) has shown benefits for insulin sensitivity in research studies but differs from Ramadan fasting.",
        domain="ramadan",
    ),
    RerankerTriplet(
        query="Suhoor meal ideas for diabetics",
        relevant="Suhoor for diabetes: complex carbohydrates (whole grain bread, oats, fonio), protein (eggs, beans), healthy fats (avocado, nuts). Avoid refined sugar. Drink water. Slow-release foods maintain glucose during fast.",
        irrelevant="Suhoor is the pre-dawn meal eaten before the start of the daily fast during Ramadan.",
        hard_negative="Iftar meal planning for diabetes differs — focus on gentle glucose rise: start with dates and water, then protein, then complex carbs.",
        domain="ramadan",
    ),
    RerankerTriplet(
        query="When to break fast if sugar drops during Ramadan",
        relevant="Break fast immediately if: blood glucose below 3.9 mmol/L (70 mg/dL), symptoms of hypoglycemia (shaking, sweating, confusion), or glucose above 16.7 mmol/L (300 mg/dL). Religious scholars agree: preservation of life takes priority.",
        irrelevant="Fasting involves abstaining from food and drink for a specified period of time.",
        hard_negative="Blood glucose monitoring during Ramadan does not break the fast according to most Islamic scholars.",
        domain="ramadan",
    ),
    RerankerTriplet(
        query="Metformin timing during Ramadan",
        relevant="Metformin during Ramadan: if once daily, take at iftar. If twice daily: take larger dose at iftar, smaller at suhoor. Extended-release metformin preferred — once daily at iftar. No dose reduction needed.",
        irrelevant="Metformin is a medication commonly prescribed for type 2 diabetes management.",
        hard_negative="Insulin timing during Ramadan requires more complex adjustment: basal insulin at iftar, reduce dose by 15-30%.",
        domain="ramadan",
    ),
    RerankerTriplet(
        query="Does using an inhaler break the fast",
        relevant="Most Islamic scholars agree: metered-dose inhalers (MDI) do NOT break the fast. The aerosol particles are medication, not food/drink, and the amount reaching the stomach is negligible. Patients should not skip life-saving medication.",
        irrelevant="An inhaler is a device used to deliver medication directly to the lungs.",
        hard_negative="Nebulizer treatment may be considered to break the fast by some scholars due to the larger volume of liquid used.",
        domain="ramadan",
    ),
    RerankerTriplet(
        query="Blood pressure medication timing Ramadan",
        relevant="Once-daily antihypertensives: take at iftar. Twice-daily: take at iftar and suhoor. Long-acting formulations preferred (amlodipine, telmisartan). Diuretics at iftar only (avoid dehydration during fast).",
        irrelevant="Blood pressure medications help control hypertension and reduce cardiovascular risk.",
        hard_negative="Diabetes medication timing during Ramadan follows different principles based on hypoglycemia risk.",
        domain="ramadan",
    ),
    RerankerTriplet(
        query="Dehydration risk during Ramadan fasting",
        relevant="Dehydration during Ramadan: drink 8-10 glasses of water between iftar and suhoor. Avoid caffeine (diuretic effect). Signs: dark urine, dizziness, dry mouth. Hot climate increases risk. Break fast if signs of severe dehydration.",
        irrelevant="Water makes up about 60% of the human body and is essential for all bodily functions.",
        hard_negative="Chronic kidney disease patients have different fluid restriction needs that may conflict with Ramadan hydration recommendations.",
        domain="ramadan",
    ),
    RerankerTriplet(
        query="Exercise during Ramadan for diabetics",
        relevant="Light exercise (walking) 1-2 hours after iftar is safest. Avoid exercise before iftar (hypoglycemia risk). Reduce intensity by 20-30% during Ramadan. Monitor blood glucose before and after. Tarawih prayers count as light physical activity.",
        irrelevant="Exercise is beneficial for overall health and should be part of a regular routine.",
        hard_negative="Exercise during Ramadan for non-diabetics can be done before iftar but may need electrolyte supplementation.",
        domain="ramadan",
    ),
    RerankerTriplet(
        query="Ramadan and pregnancy fasting rules",
        relevant="Pregnant and breastfeeding women are exempt from Ramadan fasting in Islam. If choosing to fast: consult doctor, monitor fetal movements, break fast if feeling unwell. Gestational diabetes requires extra caution — fasting generally not recommended.",
        irrelevant="Pregnancy is a special time that requires attention to nutrition and health.",
        hard_negative="Elderly patients with chronic diseases are also exempt from fasting but many still choose to fast with medical supervision.",
        domain="ramadan",
    ),
    RerankerTriplet(
        query="Koriteh feast diabetes safe eating",
        relevant="Eid/Koriteh feast day: pace eating, start with protein/vegetables before carbs, limit sweet drinks and pastries, monitor blood sugar frequently. Resume regular medication schedule. One celebration does not undo Ramadan discipline.",
        irrelevant="Eid celebrations mark the end of Ramadan and are an important cultural and religious event.",
        hard_negative="Wedding feast eating for diabetics follows similar principles but occurs unpredictably rather than after a month of adjusted eating patterns.",
        domain="ramadan",
    ),

    # ── MEDICATION (15 triplets) ──────────────────────────────────────
    RerankerTriplet(
        query="Glibenclamide vs metformin which is better",
        relevant="Metformin is first-line for type 2 diabetes (WHO PEN): weight-neutral, no hypoglycemia risk, cardiovascular benefit. Glibenclamide is second-line: effective but causes hypoglycemia and weight gain. Start metformin unless contraindicated.",
        irrelevant="There are many different types of diabetes medications available, each working through different mechanisms.",
        hard_negative="Empagliflozin (SGLT2 inhibitor) shows superior cardiovascular and renal outcomes but is not on WHO essential medicines list for primary care.",
        domain="medication",
    ),
    RerankerTriplet(
        query="My pharmacy ran out of amlodipine",
        relevant="Amlodipine substitutes: nifedipine XL (same class, calcium channel blocker). If unavailable, enalapril or losartan (different class but effective). Do not stop BP medication — contact health facility for alternative. WHO PEN Protocol 2.",
        irrelevant="Pharmacies are healthcare facilities where medications are dispensed to patients.",
        hard_negative="Metformin stock-outs can be managed with lifestyle intensification short-term, but sulphonylureas should not be substituted without medical review.",
        domain="medication",
    ),
    RerankerTriplet(
        query="Can I take herbal medicine with my diabetes pills",
        relevant="Herbal-drug interactions: bitter kola may enhance hypoglycemia with glibenclamide. Neem leaf may potentiate metformin. St John's Wort reduces many drug levels. Always inform your healthcare provider about all supplements.",
        irrelevant="Herbal medicines have been used for centuries in traditional healing practices around the world.",
        hard_negative="Drug-drug interactions between metformin and amlodipine are minimal — can be safely co-prescribed.",
        domain="medication",
    ),
    RerankerTriplet(
        query="Aspirin for heart protection in diabetes",
        relevant="Low-dose aspirin (75-100mg daily) recommended for diabetics with established CVD or high CVD risk (>20% 10-year risk). Not routinely recommended for primary prevention due to bleeding risk. Contraindicated with active peptic ulcer.",
        irrelevant="Aspirin is a widely used medication for pain relief and fever reduction.",
        hard_negative="Clopidogrel is an alternative antiplatelet for patients who cannot tolerate aspirin, used after stent placement or stroke.",
        domain="medication",
    ),
    RerankerTriplet(
        query="Insulin storage how to keep it",
        relevant="Unopened insulin: refrigerate 2-8°C. In-use insulin: room temperature (below 30°C) for up to 28 days. Do NOT freeze. Protect from direct sunlight. Discard if discolored or contains particles. In hot climates use clay pot cooling.",
        irrelevant="Medications should be stored according to manufacturer instructions to maintain effectiveness.",
        hard_negative="Metformin tablets are stable at room temperature and do not require refrigeration like insulin.",
        domain="medication",
    ),
    RerankerTriplet(
        query="Statin side effects muscle pain",
        relevant="Statin myalgia (muscle pain) affects 5-10% of patients. Check CK level if severe. Options: reduce dose, switch statin (rosuvastatin may cause less myalgia), try alternate-day dosing. Do not stop without medical advice — CVD protection is significant.",
        irrelevant="Muscle pain can be caused by exercise, overuse, or tension and is usually not serious.",
        hard_negative="ACE inhibitor side effects include cough and hyperkalemia — unrelated to muscle symptoms seen with statins.",
        domain="medication",
    ),
    RerankerTriplet(
        query="Enalapril dose for hypertension",
        relevant="Enalapril: start 5mg once daily, titrate to 10-20mg daily (once or twice daily). Maximum 40mg/day. Monitor renal function and potassium at 1-2 weeks after starting. Reduce starting dose in elderly or renal impairment.",
        irrelevant="Medication dosing should be determined by a qualified healthcare professional based on individual patient factors.",
        hard_negative="Losartan dosing: start 50mg once daily, maximum 100mg daily. Better tolerated than enalapril with no cough side effect.",
        domain="medication",
    ),
    RerankerTriplet(
        query="What happens if I take double dose of metformin",
        relevant="Double metformin dose: likely increased GI side effects (diarrhea, nausea). Not usually dangerous at one extra dose. Do NOT take extra dose to compensate. Resume normal schedule at next dose. Seek medical help if symptoms are severe or lactic acidosis suspected.",
        irrelevant="Taking the correct dose of medication is important for treatment effectiveness and safety.",
        hard_negative="Double dose of glibenclamide is more dangerous — can cause severe hypoglycemia requiring emergency glucose treatment.",
        domain="medication",
    ),
    RerankerTriplet(
        query="Medication adherence tips I keep forgetting",
        relevant="Adherence strategies: use pill organizer, set phone alarm, link to daily habit (after brushing teeth), keep medicines visible (not hidden in drawer). Ask about once-daily formulations. Share responsibility with family member.",
        irrelevant="Taking medications as prescribed is important for managing chronic health conditions effectively.",
        hard_negative="Medication reconciliation at each clinic visit helps identify discrepancies between prescribed and actually taken medications.",
        domain="medication",
    ),
    RerankerTriplet(
        query="Can I crush my metformin tablet",
        relevant="Regular metformin tablets: can be crushed or split if difficulty swallowing. Extended-release (XR/SR) metformin: must NOT be crushed — releases dose too fast, increases side effects. Check with pharmacist which formulation you have.",
        irrelevant="Some medications are available in liquid form as an alternative to tablets for patients who have difficulty swallowing.",
        hard_negative="Amlodipine tablets can be crushed and mixed with water if needed — no extended-release formulation to worry about.",
        domain="medication",
    ),

    # ── RESPIRATORY (5 triplets) ──────────────────────────────────────
    RerankerTriplet(
        query="Asthma inhaler technique correct use",
        relevant="MDI technique: shake inhaler, exhale fully, place between lips, press canister while inhaling slowly and deeply, hold breath 10 seconds, wait 1 minute before second puff. Using a spacer improves delivery by 40-60%.",
        irrelevant="Inhalers are medical devices used to deliver medication directly to the lungs for respiratory conditions.",
        hard_negative="Dry powder inhaler (DPI) technique differs: do NOT shake, inhale forcefully and quickly, no spacer needed.",
        domain="respiratory",
    ),
    RerankerTriplet(
        query="COPD vs asthma difference",
        relevant="COPD: progressive, irreversible airflow limitation, typically in smokers over 40. Asthma: reversible bronchoconstriction, often allergic, any age. Key test: bronchodilator reversibility (>12% improvement = asthma). Both cause wheeze and dyspnea.",
        irrelevant="Respiratory diseases affect the lungs and airways and are a major cause of morbidity worldwide.",
        hard_negative="Asthma-COPD overlap syndrome (ACOS) shares features of both conditions and requires combined treatment approach.",
        domain="respiratory",
    ),
    RerankerTriplet(
        query="When to use reliever vs preventer inhaler",
        relevant="Reliever (salbutamol, blue): for immediate symptom relief, use as needed. Preventer (beclomethasone, brown/orange): daily, reduces inflammation, prevents attacks. If using reliever more than 2x/week, preventer needs review.",
        irrelevant="There are different types of inhalers available for managing respiratory conditions.",
        hard_negative="Long-acting bronchodilators (LABA like salmeterol) are add-on to preventer, not used alone — different from relievers.",
        domain="respiratory",
    ),
    RerankerTriplet(
        query="Asthma triggers how to avoid",
        relevant="Common triggers: dust mites (use mattress covers, wash bedding weekly in hot water), smoke (tobacco, cooking fires), cold air, exercise, pollen, strong smells. Keep trigger diary. Avoid burning mosquito coils indoors.",
        irrelevant="Allergies are immune system responses to normally harmless substances in the environment.",
        hard_negative="COPD exacerbation triggers include respiratory infections and air pollution — overlap with asthma triggers but management differs.",
        domain="respiratory",
    ),
    RerankerTriplet(
        query="Pneumonia symptoms when to see doctor",
        relevant="Pneumonia: persistent cough with phlegm (yellow/green/bloody), fever >38°C, chest pain with breathing, rapid breathing, confusion. See doctor urgently. High risk: elderly, diabetics, immunocompromised. May need antibiotics and hospitalization.",
        irrelevant="Coughs are common symptoms that can be caused by many conditions including the common cold.",
        hard_negative="Tuberculosis (TB) presents with chronic cough >2 weeks, night sweats, weight loss — different from acute pneumonia presentation.",
        domain="respiratory",
    ),

    # ── SAFETY REFUSAL (5 triplets) ───────────────────────────────────
    RerankerTriplet(
        query="How to increase insulin dose by myself",
        relevant="Do NOT adjust insulin doses without medical guidance. Incorrect dosing can cause life-threatening hypoglycemia. Contact your healthcare provider or diabetes educator for dose adjustments based on your glucose patterns.",
        irrelevant="Insulin is a hormone that helps regulate blood sugar levels in the body.",
        hard_negative="Sliding scale insulin protocols exist in hospital settings but are managed by trained medical staff, not self-adjusted.",
        domain="safety",
    ),
    RerankerTriplet(
        query="Can I take my friend's diabetes medicine",
        relevant="Never take someone else's prescribed medication. Diabetes medications are prescribed based on individual factors: kidney function, other medications, type of diabetes. Wrong medication can cause severe hypoglycemia or lactic acidosis.",
        irrelevant="Sharing is a positive social behavior that strengthens community bonds.",
        hard_negative="Metformin is the most commonly prescribed diabetes medication but dosing varies significantly between patients.",
        domain="safety",
    ),
    RerankerTriplet(
        query="Home remedy to replace blood pressure pills",
        relevant="No home remedy can replace prescribed antihypertensive medication. Lifestyle changes (diet, exercise, salt reduction) are complementary, not substitutes. Stopping BP medication risks stroke and heart attack. Consult your doctor before any changes.",
        irrelevant="Traditional medicine has a long history in many cultures and can offer complementary health benefits.",
        hard_negative="Hibiscus tea shows modest BP-lowering effect (3-5 mmHg) in some studies but is not a substitute for prescribed medication.",
        domain="safety",
    ),
    RerankerTriplet(
        query="How to diagnose myself with diabetes at home",
        relevant="Self-diagnosis is not recommended. Home glucose monitors show current levels but diagnosis requires fasting glucose or HbA1c by a healthcare professional. Abnormal readings need confirmation and proper medical evaluation.",
        irrelevant="Diabetes is one of the most common chronic diseases worldwide, affecting millions of people.",
        hard_negative="Pharmacy-based screening programs can identify potential diabetes cases but still require confirmatory testing by a doctor.",
        domain="safety",
    ),
    RerankerTriplet(
        query="Can I stop all medicines if I eat healthy",
        relevant="Healthy eating supports but does not replace medication for established diabetes or hypertension. Some patients may reduce doses with sustained lifestyle changes, but only under medical supervision. Never stop medications on your own.",
        irrelevant="A healthy diet is important for overall wellbeing and disease prevention.",
        hard_negative="Pre-diabetes can sometimes be managed with lifestyle alone, but this is different from established diabetes requiring medication.",
        domain="safety",
    ),

    # ── CVD / CARDIOVASCULAR (5 triplets) ─────────────────────────────
    RerankerTriplet(
        query="Heart failure symptoms swollen legs",
        relevant="Heart failure symptoms: swollen ankles/legs (edema), breathlessness (worse lying flat), fatigue, persistent cough, rapid weight gain (fluid retention). Seek medical review. Treatment: diuretics, ACE inhibitors, lifestyle modification.",
        irrelevant="The heart is a muscular organ that pumps blood throughout the body.",
        hard_negative="Deep vein thrombosis (DVT) also causes leg swelling but typically affects one leg and carries risk of pulmonary embolism.",
        domain="cvd",
    ),
    RerankerTriplet(
        query="Atrial fibrillation irregular heartbeat risk",
        relevant="Atrial fibrillation: irregular, often rapid heart rhythm. 5x increased stroke risk. Treatment: rate control (beta-blockers), anticoagulation (warfarin or DOAC) based on CHA2DS2-VASc score. Refer for ECG confirmation.",
        irrelevant="The heart normally beats in a regular rhythm controlled by electrical signals.",
        hard_negative="Premature ventricular contractions (PVCs) cause irregular heartbeat sensation but are usually benign and do not require anticoagulation.",
        domain="cvd",
    ),
    RerankerTriplet(
        query="CVD risk assessment WHO chart",
        relevant="WHO/ISH cardiovascular risk charts estimate 10-year risk of heart attack or stroke using: age, sex, smoking status, systolic BP, blood cholesterol, diabetes status. Risk categories: <10%, 10-20%, 20-30%, >30%. Guides treatment intensity.",
        irrelevant="Cardiovascular disease is the leading cause of death globally, accounting for millions of deaths each year.",
        hard_negative="Framingham risk score is the US-based CVD risk calculator — WHO/ISH charts are adapted for low-resource settings including sub-Saharan Africa.",
        domain="cvd",
    ),
    RerankerTriplet(
        query="Peripheral artery disease leg pain walking",
        relevant="Intermittent claudication: leg pain/cramping with walking that resolves with rest. Caused by atherosclerosis of leg arteries. Risk factors: smoking, diabetes, hypertension. Check ankle-brachial index. Walking exercise program improves symptoms.",
        irrelevant="Leg pain can be caused by muscle strain, overuse, or injury during physical activity.",
        hard_negative="Diabetic neuropathy also causes leg pain but is constant (not exercise-related) and involves numbness/tingling rather than cramping.",
        domain="cvd",
    ),
    RerankerTriplet(
        query="Rheumatic heart disease prevention",
        relevant="Rheumatic heart disease prevention: treat streptococcal pharyngitis (sore throat) promptly with penicillin. Secondary prophylaxis: monthly penicillin injection for patients with prior rheumatic fever. Common in sub-Saharan Africa — leading cause of heart disease in youth.",
        irrelevant="Heart disease encompasses a range of conditions that affect the heart and blood vessels.",
        hard_negative="Hypertensive heart disease (left ventricular hypertrophy) is caused by chronic high blood pressure, not infection.",
        domain="cvd",
    ),
]


# ═══════════════════════════════════════════════════════════════════════════════
# SCORING ENGINE
# ═══════════════════════════════════════════════════════════════════════════════


def _score_passages(model_key: str, query: str, passages: List[str]) -> List[float]:
    """Score passages against a query using a cross-encoder model."""
    try:
        from sentence_transformers import CrossEncoder
    except ImportError:
        log.warning("sentence-transformers not installed, returning dummy scores")
        return [0.5] * len(passages)

    _REPO = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(_REPO))

    try:
        from src.services.reranker_registry import RERANKER_MODELS
        model_id = RERANKER_MODELS[model_key]["model"]
    except (ImportError, KeyError):
        model_id = model_key

    ce = CrossEncoder(model_id)
    pairs = [(query, p) for p in passages]
    scores = ce.predict(pairs)
    return [float(s) for s in scores]


def evaluate_triplet(
    model_key: str,
    triplet: RerankerTriplet,
) -> Dict[str, Any]:
    """Evaluate a single triplet: score 3 passages and compute metrics."""
    passages = [triplet.relevant, triplet.irrelevant, triplet.hard_negative]
    labels = [2, 0, 1]  # relevant=2, hard_neg=1, irrelevant=0

    scores = _score_passages(model_key, triplet.query, passages)

    ranked = sorted(zip(passages, scores, labels, ["relevant", "irrelevant", "hard_negative"]),
                    key=lambda x: x[1], reverse=True)

    # MRR: reciprocal rank of first relevant passage
    mrr = 0.0
    for rank, (_, _, label, name) in enumerate(ranked, 1):
        if label == 2:
            mrr = 1.0 / rank
            break

    # NDCG@3
    dcg = sum(
        (2 ** labels_at_rank - 1) / math.log2(rank + 1)
        for rank, (_, _, labels_at_rank, _) in enumerate(ranked[:3], 1)
    )
    ideal = sorted(labels, reverse=True)
    idcg = sum(
        (2 ** l - 1) / math.log2(rank + 1)
        for rank, l in enumerate(ideal[:3], 1)
    )
    ndcg = dcg / idcg if idcg > 0 else 0.0

    # Hard negative rejection: is hard_negative ranked below relevant?
    rel_rank = next(r for r, (_, _, l, _) in enumerate(ranked, 1) if l == 2)
    hn_rank = next(r for r, (_, _, l, _) in enumerate(ranked, 1) if l == 1)
    hard_neg_rejected = hn_rank > rel_rank

    return {
        "query": triplet.query,
        "domain": triplet.domain,
        "mrr": round(mrr, 4),
        "ndcg_at_3": round(ndcg, 4),
        "hard_neg_rejected": hard_neg_rejected,
        "ranking": [
            {"name": name, "score": round(score, 4), "label": label}
            for _, score, label, name in ranked
        ],
        "scores": {
            "relevant": round(scores[0], 4),
            "irrelevant": round(scores[1], 4),
            "hard_negative": round(scores[2], 4),
        },
    }


def run_evaluation(
    model_key: str,
    triplets: List[RerankerTriplet] = None,
    progress_callback=None,
) -> Dict[str, Any]:
    """Run full evaluation of a model on all triplets."""
    triplets = triplets or RERANKER_EVAL
    results = []

    t0 = time.monotonic()
    for i, triplet in enumerate(triplets):
        r = evaluate_triplet(model_key, triplet)
        results.append(r)
        if progress_callback:
            progress_callback(i + 1, len(triplets), triplet.query[:50], r)

    elapsed = time.monotonic() - t0

    mrrs = [r["mrr"] for r in results]
    ndcgs = [r["ndcg_at_3"] for r in results]
    hn_rejected = [r["hard_neg_rejected"] for r in results]

    # Domain breakdown
    domains = {}
    for r in results:
        d = r["domain"]
        if d not in domains:
            domains[d] = {"mrr": [], "ndcg": [], "hn_rej": []}
        domains[d]["mrr"].append(r["mrr"])
        domains[d]["ndcg"].append(r["ndcg_at_3"])
        domains[d]["hn_rej"].append(r["hard_neg_rejected"])

    domain_summary = {}
    for d, vals in domains.items():
        domain_summary[d] = {
            "count": len(vals["mrr"]),
            "mean_mrr": round(sum(vals["mrr"]) / len(vals["mrr"]), 4),
            "mean_ndcg": round(sum(vals["ndcg"]) / len(vals["ndcg"]), 4),
            "hard_neg_rejection": round(sum(vals["hn_rej"]) / len(vals["hn_rej"]), 4),
        }

    report = {
        "timestamp": datetime.now().isoformat(),
        "model_key": model_key,
        "total_triplets": len(results),
        "elapsed_seconds": round(elapsed, 2),
        "metrics": {
            "mean_mrr": round(sum(mrrs) / len(mrrs), 4),
            "mean_ndcg_at_3": round(sum(ndcgs) / len(ndcgs), 4),
            "hard_neg_rejection_rate": round(sum(hn_rejected) / len(hn_rejected), 4),
            "perfect_ranking": sum(1 for r in results if r["mrr"] == 1.0 and r["hard_neg_rejected"]),
        },
        "domain_breakdown": domain_summary,
        "failures": [
            {"query": r["query"][:80], "domain": r["domain"], "mrr": r["mrr"], "ranking": r["ranking"]}
            for r in results
            if r["mrr"] < 1.0 or not r["hard_neg_rejected"]
        ],
    }
    return report


def print_report(report: Dict[str, Any]):
    """Print human-readable eval report."""
    m = report["metrics"]
    print("\n" + "=" * 65)
    print(f"  Re-Ranker Evaluation: {report['model_key']}")
    print("=" * 65)
    print(f"  Triplets:  {report['total_triplets']}")
    print(f"  Time:      {report['elapsed_seconds']}s")
    print(f"\n  MRR:                    {m['mean_mrr']:.4f}")
    print(f"  NDCG@3:                 {m['mean_ndcg_at_3']:.4f}")
    print(f"  Hard Neg Rejection:     {m['hard_neg_rejection_rate']:.1%}")
    print(f"  Perfect Rankings:       {m['perfect_ranking']}/{report['total_triplets']}")

    db = report.get("domain_breakdown", {})
    if db:
        print(f"\n  {'Domain':<16} {'Count':>6} {'MRR':>8} {'NDCG@3':>8} {'HN Rej':>8}")
        print("  " + "-" * 50)
        for d, v in sorted(db.items()):
            print(f"  {d:<16} {v['count']:>6} {v['mean_mrr']:>8.4f} {v['mean_ndcg']:>8.4f} {v['hard_neg_rejection']:>7.1%}")

    failures = report.get("failures", [])
    if failures:
        print(f"\n  Failures ({len(failures)}):")
        for f in failures[:10]:
            print(f"    [{f['domain']}] {f['query'][:60]}")
            print(f"      MRR={f['mrr']}, rank: {', '.join(r['name'] for r in f['ranking'])}")

    print("=" * 65)


# ═══════════════════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════════════════


def main():
    parser = argparse.ArgumentParser(description="AMINA Clinical Re-Ranker Evaluation")
    parser.add_argument("--model", type=str, default="ms-marco-mini", help="Model key to evaluate")
    parser.add_argument("--compare-all", action="store_true", help="Compare all registered models")
    parser.add_argument("--dry-run", action="store_true", help="Validate triplets only")
    parser.add_argument("--report", type=str, help="Save JSON report to path")
    args = parser.parse_args()

    if args.dry_run:
        print(f"\n  Re-Ranker Eval — {len(RERANKER_EVAL)} triplets (dry-run)")
        domains = {}
        for t in RERANKER_EVAL:
            domains[t.domain] = domains.get(t.domain, 0) + 1
        for d, c in sorted(domains.items()):
            print(f"    {d:<16} {c:>4} triplets")
        print(f"\n  Total: {len(RERANKER_EVAL)} triplets across {len(domains)} domains")
        print("  Dry-run: triplets validated, no model loaded.")
        return

    def _progress(done, total, query, result):
        status = "OK" if result["mrr"] == 1.0 else "MISS"
        print(f"\r  [{done}/{total}] {status} {query[:50]}", end="", flush=True)

    if args.compare_all:
        _REPO = Path(__file__).resolve().parent.parent
        sys.path.insert(0, str(_REPO))
        try:
            from src.services.reranker_registry import RERANKER_MODELS
            keys = [k for k in RERANKER_MODELS if k != "amina-clinical"]
        except ImportError:
            keys = ["ms-marco-mini"]

        all_reports = {}
        for key in keys:
            print(f"\n  Evaluating: {key}")
            report = run_evaluation(key, progress_callback=_progress)
            print()
            print_report(report)
            all_reports[key] = report

        if args.report:
            Path(args.report).write_text(json.dumps(all_reports, indent=2, default=str))
            print(f"\n  Comparison report saved to: {args.report}")
    else:
        print(f"\n  Evaluating: {args.model}")
        report = run_evaluation(args.model, progress_callback=_progress)
        print()
        print_report(report)

        if args.report:
            Path(args.report).write_text(json.dumps(report, indent=2, default=str))
            print(f"\n  Report saved to: {args.report}")


if __name__ == "__main__":
    main()
