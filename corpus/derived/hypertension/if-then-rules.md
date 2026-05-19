# Hypertension — if-then rules

Decision rules the chatbot can pattern-match against to give specific,
non-generic guidance. Derived from the WHO *HEARTS technical package*,
the WHO *Be He@lthy Be Mobile — mHypertension handbook* (2020), and
*WHO treatment guidelines for hypertension*.

All numerical thresholds are simplified for adult patients without
specific comorbidities. A clinician must individualise these for
pregnancy, diabetes, chronic kidney disease, and elderly patients with
orthostatic hypotension.

---

## Triage by blood-pressure reading

| If the most recent reading is … | And the person … | Then … |
|---|---|---|
| < 120 / 80 | (anyone) | Reassure: this is in the normal range. Encourage the lifestyle steps that maintain it. |
| 120-139 / 80-89 | not yet diagnosed | Flag as "elevated." Recommend recheck within 1-3 months and the four lifestyle pillars (salt, fruit/veg, activity, no smoking, limit alcohol). |
| 140-159 / 90-99 | not yet diagnosed | Recommend they see a health worker within 1-2 weeks for confirmation. Do not start medication advice in the chat. |
| 140-159 / 90-99 | already diagnosed, on medication | Reinforce adherence. If consistently above 140/90 across multiple readings over 1-2 weeks, recommend a clinic visit to review medication. |
| 160-179 / 100-109 | (anyone) | Recommend a clinic visit within a few days. Reinforce adherence if on medication. |
| ≥ 180 / 110 | symptom-free | Recommend they sit quietly for 5 minutes and recheck. If still ≥ 180/110, contact health worker the **same day**. |
| ≥ 180 / 110 | **with** any red-flag symptom (see below) | **Hypertensive emergency.** Tell them to seek emergency care immediately — do not drive themselves. |

### Red-flag symptoms (hypertensive emergency)

If any of these appear with a high reading, escalate to emergency:

- Severe headache, especially sudden onset
- Loss of consciousness, confusion or sudden weakness
- Chest pain or pressure
- Nausea and vomiting that won't stop
- Sudden visual disturbance or loss of vision
- Racing or pounding heartbeat
- Sudden trouble speaking, slurred speech, drooping of one side of the face
- Severe shortness of breath
- Weakness or numbness on one side of the body (possible stroke)

---

## Medication adherence

| If the person reports … | Then … |
|---|---|
| missed yesterday's dose | "Take today's dose as usual. Do not double up. Set a reminder so it doesn't happen again." |
| missed several doses this week | "Take today's dose. Tell your health worker — your readings will be off and they may need to adjust. Ask about a reminder system or a combination pill." |
| stopping because "I feel fine" | Explain that hypertension is silent and the pills are why they feel fine. Strongly discourage stopping. Offer to set adherence reminders. |
| stopping because of side effects | Discourage stopping unilaterally. Ask which side effect. Suggest contacting the health worker — there is almost always an alternative within the same effect class. |
| can't afford the medication | Surface this as a barrier worth addressing. Recommend they ask their health worker about (a) generic equivalents, (b) lower-cost combination tablets, (c) any subsidy or NCD-programme access in their region. Do not advise stopping. |
| dry persistent cough on a "-pril" medicine (ACE inhibitor) | Explain this is a known side effect and an alternative class (ARBs, ending in "-sartan") exists. Recommend they ask the health worker to switch. Don't stop on their own. |
| swollen ankles on a "-pine" medicine (CCB) | Acknowledge this is a known side effect. Recommend the health worker review the dose or switch. Don't stop on their own. |

---

## Salt and diet

| If the person says … | Then suggest … |
|---|---|
| they use stock cubes (Maggi, bouillon) | Cut to half a cube per pot, add later in cooking, replace flavour with onion, garlic, ginger, scotch bonnet, herbs, lemon. |
| they eat bread every morning | Note bread is a hidden salt source. Suggest 3-4 mornings a week instead of 7, and pair with avocado/egg instead of butter and processed meat. |
| "I don't add salt at the table" | Acknowledge but redirect: most dietary salt comes from cooking and processed foods, not the salt shaker. Focus on stock cubes, processed meat, dried/salted fish, instant noodles, canned foods. |
| their meals are mostly rice, oil and a bit of meat | Recommend adding vegetables (any colour, raw or cooked) to half the plate, swapping palm/coconut oil for sunflower/soya/olive, and using fish or chicken more often than red meat. |
| they drink sugary drinks daily | Recommend water as the default, fresh fruit instead of juice, and reducing sugar in tea/coffee gradually. |

### Portion guidance (5-a-day)

- 1 portion = 1 banana, 1 mango, 1 apple, 1 orange, 1 handful of berries,
  3 tablespoons of cooked vegetables, or a cup of leafy greens.
- **Starchy roots** (potato, sweet potato, cassava, yam, plantain) do
  **not** count toward the 5.
- Juice counts at most as 1 portion per day, regardless of how much is
  drunk.

---

## Physical activity

| If the person … | Then recommend … |
|---|---|
| has done no exercise in years | Start with 10-minute walks, twice a day. Add a minute or two per week. Goal: 30 min/day, 5 days/week. |
| does some activity but less than 150 min/week | "Add one or two extra 15-minute walks. Try to make it brisk enough that you breathe faster." |
| already meets 150 min/week | Encourage maintenance and variety (walking, gardening, dancing, swimming, cycling). |
| has knee/joint pain | Suggest swimming, cycling, or shorter more frequent walks on flat ground with cushioned shoes. Recommend telling the health worker if pain persists. |
| has chest pain on exertion, severe shortness of breath, or dizziness when exercising | **Stop and see a health worker before continuing.** Do not push through these symptoms. |
| current reading > 180/110 | Defer exercise advice. Recommend they get their pressure under control first via clinic visit. |

---

## Tobacco, alcohol, weight

| If the person … | Then … |
|---|---|
| smokes | Strongly recommend quitting as the single highest-impact change. Offer to refer them to the tobacco-cessation flow. Do not minimise. |
| has someone in the home who smokes | Recommend asking them not to smoke indoors or in the car. Second-hand smoke is a real cardiovascular risk for them too. |
| drinks alcohol daily | Recommend at least 2 alcohol-free days per week, and no more than 2 drinks on any drinking day. The lowest-risk option remains zero. |
| drinks > 14 drinks/week or has trouble cutting back | Treat as a flag. Encourage them to discuss with their health worker; there is help available beyond willpower. |
| is overweight | Recommend slow, steady weight loss (about 0.5 kg / 1 lb per week) through eating and movement combined. Discourage crash diets and miracle products. |
| is underweight | Note: this is not the typical hypertension picture and may indicate something else (uncontrolled diabetes, infection, malnutrition). Recommend a clinic visit. |

---

## Self-monitoring at home

| If the person … | Then … |
|---|---|
| has a home BP machine and asks how to use it | Sit quietly for 5 min, feet flat on the floor, arm at heart level, cuff on bare skin, don't talk during the reading. Take 2 readings 1 min apart and record both. Best times: morning before medication, and evening. |
| reports very different readings on the same arm | Reassure that BP varies through the day. Recommend the same time, same posture, same arm each day; record the average over a week rather than reacting to single readings. |
| asks how often to check at home | If newly started on treatment: daily for the first 1-2 weeks, then 2-3 times/week once stable. If stable for months: 1-2 times/week is usually enough. Always more often if symptoms appear. |
| asks "is this reading bad?" | Use the triage table above. **Do not interpret a single reading in isolation** — encourage them to take 3-5 readings over a few days before drawing conclusions. |

---

## Things to never do in the conversation

- Never recommend stopping prescribed medication.
- Never recommend a specific new prescription medication by name.
- Never provide dose changes for blood pressure medicines — that is a
  clinical decision.
- Never claim hypertension can be "cured" by a particular food, herb,
  supplement, or programme.
- Never minimise red-flag symptoms or delay the emergency-care
  recommendation when the triage rules above call for it.
- Never give clinical advice that contradicts what the patient's own
  health worker has told them — surface the conflict and recommend they
  clarify with the health worker.
