"""
Medication Safety Response Templates — multilingual refusal + INTERIM CARE.

AMINA cannot prescribe, but she CAN give FIRST AID and interim guidance
to buy time until the patient reaches a doctor. This is the difference
between "go see a doctor" (unhelpful in rural Gambia) and "here's what
to do RIGHT NOW while you arrange to see a doctor" (saves lives).

FIRST AID ≠ PRESCRIPTION:
  ✅ "Eat honey if your sugar drops"         → first aid
  ✅ "Drink ORS for dehydration"             → first aid
  ✅ "Reduce salt in your food today"        → lifestyle
  ✅ "Sit upright if you can't breathe"      → first aid
  ❌ "Take Metformin 500mg"                  → prescribing (NEVER)
  ❌ "Increase your amlodipine to 10mg"      → prescribing (NEVER)
"""

from typing import Dict, Any

MEDICATION_RESPONSES = {
    "requesting_prescription": {
        "en": (
            "I cannot prescribe medicine — only a doctor who has examined you can do that safely. "
            "Everyone's body is different, and the wrong medicine can be dangerous.\n\n"
            "But here is what you CAN do right now:\n"
            "• If your blood sugar feels low — eat a spoonful of honey or sugar, or drink sweet tea.\n"
            "• If your blood pressure feels high (headache, dizziness) — sit down, rest, breathe slowly, and avoid salt today.\n"
            "• If you have diabetes — focus on eating vegetables, reduce rice portions, avoid sugary drinks, and walk 30 minutes daily.\n"
            "• If you have high BP — cook with less salt, use one less Maggi cube, eat more fruits like banana and orange.\n\n"
            "These steps help while you arrange to see a doctor. "
            "Let me find the nearest health centre for you."
        ),
        "ma": (
            "N te se fura le foola i ye — dokitaroo le ka kan ka i mako ñaa. "
            "Bariŋ koe doolu be i se ka ke sisan:\n"
            "I la sugar ye doyaa — kumu le domo baa sukaroo.\n"
            "I la BP ye ka jiitoo — sirii, i hakili sabaatii, kana koŋo domo kunuŋ.\n"
            "N na i demmaa dokitaroo soto la."
        ),
        "action": "route_to_facility",
        "suggest_form": None,
    },
    "dosage_question": {
        "en": (
            "I cannot advise on medicine doses — your doctor knows the right amount for YOUR body. "
            "Taking too much or too little can both be dangerous.\n\n"
            "While you wait to see your doctor:\n"
            "• Do NOT change your dose on your own.\n"
            "• Take your medicine exactly as your doctor last told you.\n"
            "• If you missed a dose — take it when you remember, but do not take a double dose.\n"
            "• Write down your question so you remember to ask the doctor.\n\n"
            "Would you like me to find the nearest health centre where you can ask about your dose?"
        ),
        "ma": (
            "N te se ka fura janjanoo fo i ye — i la dokitaroo le y'a loŋ. "
            "Kana i la fura janjanoo felee i faŋ. "
            "N na i demmaa dokitaroo soto la."
        ),
        "action": "route_to_facility",
        "suggest_form": None,
    },
    "drug_interaction": {
        "en": (
            "I cannot advise on mixing medicines — some combinations can be very dangerous, "
            "and only a doctor or pharmacist can check safely.\n\n"
            "What you should do:\n"
            "• Write down ALL medicines you take (modern AND traditional/herbal).\n"
            "• Take this list to your doctor or pharmacist.\n"
            "• Do NOT start a new medicine until a doctor says it is safe with your current ones.\n"
            "• If you feel unwell after mixing medicines — stop the new one and go to the health centre.\n\n"
            "Let me help you find the nearest health centre or pharmacy."
        ),
        "ma": (
            "N te se ka fura filaalu noo la — a ka se ka barakee. "
            "I la furaalu bee sebe, i taa a la dokitaroo baa faramaasi la."
        ),
        "action": "route_to_facility",
        "suggest_form": None,
    },
    "overdose_emergency": {
        "en": (
            "THIS IS URGENT! Call 199 NOW! Go to the hospital IMMEDIATELY!\n\n"
            "While you wait or travel:\n"
            "• Do NOT make the person vomit.\n"
            "• If they are unconscious — turn them on their side.\n"
            "• Bring the medicine container or remaining pills to the hospital.\n"
            "• If it is a child — tell the hospital the child's age and weight.\n"
            "• Stay with the person. Keep them calm.\n\n"
            "Call 199 NOW. Every minute matters."
        ),
        "ma": (
            "KANA MAAKOY! Telefon ke 199 la SISAN! Taa ospitaali la joona!\n"
            "Kana moo la fura buntundi. "
            "Fura kuŋkoo taa a la ospitaali la."
        ),
        "action": "emergency_alert",
        "suggest_form": None,
    },
    "side_effect_report": {
        "en": (
            "Side effects can be worrying, but please do NOT stop your medicine without asking your doctor first — "
            "stopping suddenly can sometimes be more dangerous than the side effect.\n\n"
            "What to do right now:\n"
            "• If the side effect is mild (slight dizziness, mild nausea) — continue your medicine and visit the doctor this week.\n"
            "• If the side effect is severe (difficulty breathing, swelling, rash all over body) — stop the medicine and go to the health centre TODAY.\n"
            "• Drink water and rest.\n"
            "• Write down exactly what you feel and when it started — this helps the doctor.\n\n"
            "Would you like me to find the nearest health centre?"
        ),
        "ma": (
            "Kana i la fura dabaa saayi dokitaroo ñininkaa kono. "
            "Jiiye domo, i hakili sabaatii. Taa i la dokitaroo la."
        ),
        "action": "route_to_facility",
        "suggest_form": None,
    },
    "existing_prescription": {
        "en": (
            "I can help you remember to take the medicine your doctor prescribed.\n\n"
            "What medicine did your doctor give you, and when did they say to take it? "
            "I will set up a reminder for you.\n\n"
            "Quick tips for taking medicine safely:\n"
            "• Take it at the same time every day.\n"
            "• If your doctor said 'with food' — eat before taking it.\n"
            "• Do not share your medicine with anyone — it was prescribed for YOUR body.\n"
            "• Keep medicines in a dry, cool place away from children."
        ),
        "ma": (
            "N na i demmaa i la fura hakilinanoo la. "
            "Fura jumeŋ ne dokitaroo ye i so? "
            "N na reminder siitoo i ye."
        ),
        "action": "setup_reminder",
        "suggest_form": "prescription",
    },
    "refill_needed": {
        "en": (
            "Let me help you find where to refill your medicine.\n\n"
            "Important while you wait:\n"
            "• Do NOT skip doses — take what you have left on schedule.\n"
            "• If you run out completely — go to your nearest health post. They may have your medicine in stock.\n"
            "• Ask the pharmacist if there is a cheaper version of your medicine (generic).\n"
            "• Bring your old medicine packet so they know the exact name and dose.\n\n"
            "Let me find the nearest health post or pharmacy for you."
        ),
        "ma": (
            "N na i demmaa i la fura kotendiŋo soto la. "
            "Kana fura domoroo tinna. I la fura kuŋkoo taa faramaasi la."
        ),
        "action": "find_facility",
        "suggest_form": None,
    },
    "traditional_remedy": {
        "en": (
            "Many people use traditional remedies alongside modern medicine, and I respect that tradition.\n\n"
            "What you should know:\n"
            "• Some herbs can affect how your modern medicine works — this can be dangerous.\n"
            "• ALWAYS tell your doctor what herbs or traditional medicines you take.\n"
            "• Do NOT replace your doctor's medicine with herbs unless the doctor agrees.\n"
            "• Bitter leaf tea, neem, and moringa are commonly used — but they CAN interact with diabetes and BP medicines.\n\n"
            "Your doctor needs to know so they can keep you safe. "
            "Both paths can work together — but only if your doctor knows about both."
        ),
        "ma": (
            "Moo jamaa be fura tradisioŋolu domola. "
            "Bariŋ i ka a fo i la dokitaroo ye fura tradisioŋo oolu bee. "
            "Fura doolu ka se ka barakee ñoŋo la."
        ),
        "action": None,
        "suggest_form": None,
    },
    "general_med_info": {
        "en": None,  # Let the LLM handle with safety prompt — education only
        "ma": None,
        "action": None,
        "suggest_form": None,
    },
    "urgent_symptom_relief": {
        "en": None,  # Dynamically generated based on scenario — see get_urgent_first_aid()
        "ma": None,
        "action": "first_aid",
        "suggest_form": None,
    },
}


# ── Scenario-specific first aid responses ──
# These are NOT prescriptions — they are safe interim actions any CHW would give.
# They buy time until the patient reaches a facility.

_URGENT_FIRST_AID = {
    "hypo": (
        "I can hear you are not well. Stay calm — low blood sugar can be fixed quickly.\n\n"
        "DO THIS RIGHT NOW:\n"
        "1. Eat 3-4 sugar cubes, or a spoonful of honey, or drink half a glass of juice or sweet tea.\n"
        "2. Sit down somewhere safe in case you feel faint.\n"
        "3. Wait 15 minutes, then check how you feel.\n"
        "4. If you still feel shaky after 15 minutes — eat again and ask someone to take you to the health post.\n"
        "5. Once you feel better, eat a proper meal (chere with milk, or rice with stew) to keep your sugar stable.\n\n"
        "This is NOT medicine — this is first aid. Your body needs sugar right now.\n"
        "If you lose consciousness or cannot swallow — someone must call 199 immediately.\n\n"
        "How are you feeling now? Can you eat something?"
    ),
    "hyper": (
        "I understand you are worried. Very high blood sugar needs attention, but stay calm.\n\n"
        "DO THIS RIGHT NOW:\n"
        "1. Drink water — small sips, 2-3 glasses over the next hour. Dehydration makes it worse.\n"
        "2. Do NOT eat sugar, sweet drinks, white rice, or bread right now.\n"
        "3. If you can, take a slow 10-minute walk — even around the compound. This helps your body use the sugar.\n"
        "4. If you have medicine your doctor prescribed — take it as usual. Do NOT take extra.\n"
        "5. Watch for danger signs: vomiting, stomach pain, fruity smell on breath, fast breathing → call 199.\n\n"
        "You need to visit your health post today or tomorrow to check your readings.\n"
        "I am not giving you medicine — I am helping you stay safe until you see your doctor.\n\n"
        "Are you able to drink water now?"
    ),
    "bp_crisis": (
        "I can hear this is scary. Very high blood pressure needs calm — getting stressed makes it worse.\n\n"
        "DO THIS RIGHT NOW:\n"
        "1. SIT DOWN. Do not lie flat — sit upright with your back supported.\n"
        "2. Breathe slowly: in through your nose for 4 counts, out through your mouth for 6 counts. Repeat 5 times.\n"
        "3. Loosen any tight clothing around your neck or chest.\n"
        "4. Do NOT eat anything salty. Drink plain water.\n"
        "5. If you have BP medicine your doctor prescribed — take your normal dose. Do NOT take extra.\n"
        "6. If you have a nosebleed — lean forward slightly, pinch the soft part of your nose.\n\n"
        "DANGER SIGNS — call 199 immediately if: chest pain, sudden confusion, slurred speech, "
        "one side of face drooping, sudden vision loss, or the headache is the worst you have ever had.\n\n"
        "I am not prescribing anything — this is what a Community Health Worker would tell you.\n"
        "You need to reach a health facility today.\n\n"
        "How is your breathing? Is anyone with you?"
    ),
    "breathing": (
        "I hear you — difficulty breathing is frightening. Let me help you right now.\n\n"
        "DO THIS RIGHT NOW:\n"
        "1. Sit UPRIGHT — do not lie down. Lean slightly forward with hands on your knees.\n"
        "2. If you have an inhaler your doctor gave you — use it now. 2 puffs, wait 20 seconds between puffs.\n"
        "3. Stay away from smoke, dust, strong smells — move to fresh air if possible.\n"
        "4. Breathe slowly: in through your nose, out through pursed lips (like blowing through a straw).\n"
        "5. Try to stay calm — panic makes breathing harder.\n\n"
        "CALL 199 if: your lips or fingertips turn blue, you cannot speak a full sentence, "
        "or it is getting worse not better after 15 minutes.\n\n"
        "I am not giving you medicine — this is safe first aid to help you breathe easier.\n\n"
        "Can you speak to me? Are you breathing a little better?"
    ),
    "pain_acute": (
        "I hear you are in pain. Let me help you manage it safely right now.\n\n"
        "DO THIS RIGHT NOW:\n"
        "1. Find a comfortable position — sit or lie down, whatever feels least painful.\n"
        "2. If the pain is in your stomach — lie on your side with knees pulled up.\n"
        "3. If you have a headache — sit in a dark, quiet room. Put a cool damp cloth on your forehead.\n"
        "4. Breathe slowly and deeply — pain makes us tense up, and tension makes pain worse.\n"
        "5. Drink small sips of water.\n\n"
        "CALL 199 if: chest pain or pressure, sudden worst-ever headache, pain with fever and confusion, "
        "or pain after an injury.\n\n"
        "I cannot give you medicine names — only your doctor can do that safely. "
        "But these steps can help until you reach the health post.\n\n"
        "Where exactly is the pain? How long has it been going on?"
    ),
    "general": (
        "I can hear you are not feeling well. Let me help you stay safe right now.\n\n"
        "DO THIS RIGHT NOW:\n"
        "1. Sit or lie down in a comfortable, safe place.\n"
        "2. Drink small sips of water.\n"
        "3. If you feel dizzy — sit down immediately and put your head between your knees.\n"
        "4. If you are sweating and shaking — eat something sweet (honey, sugar, juice).\n"
        "5. If you have medicine your doctor prescribed — take your normal dose, not extra.\n"
        "6. Ask someone to stay with you.\n\n"
        "CALL 199 if: chest pain, difficulty breathing, sudden confusion, fainting, or severe bleeding.\n\n"
        "I cannot prescribe medicine — but I can help you with safe steps to feel better right now "
        "and help you reach a doctor.\n\n"
        "Tell me more — what exactly are you feeling?"
    ),
}


def get_urgent_first_aid(scenario: str = "general") -> str:
    """Get calm, scenario-specific first aid response for a patient in distress.

    This is NOT a prescription — it's safe interim care (eat sugar for hypo,
    sit and breathe for high BP) that any CHW would give in the field.
    """
    return _URGENT_FIRST_AID.get(scenario, _URGENT_FIRST_AID["general"])


def get_medication_response(
    intent_name: str, language: str = "en",
    acute_scenario: str = None,
) -> Dict[str, Any]:
    """Get the appropriate response template for a medication intent.

    For URGENT_SYMPTOM_RELIEF, returns scenario-specific first aid instead
    of a generic block message.
    """
    if intent_name == "urgent_symptom_relief" and acute_scenario:
        return {
            "response": get_urgent_first_aid(acute_scenario),
            "action": "first_aid",
            "suggest_form": None,
            "blocked": True,
        }
    if intent_name == "urgent_symptom_relief":
        return {
            "response": get_urgent_first_aid("general"),
            "action": "first_aid",
            "suggest_form": None,
            "blocked": True,
        }

    templates = MEDICATION_RESPONSES.get(intent_name, {})
    response_text = templates.get(language) or templates.get("en")
    return {
        "response": response_text,
        "action": templates.get("action"),
        "suggest_form": templates.get("suggest_form"),
        "blocked": response_text is not None,
    }
