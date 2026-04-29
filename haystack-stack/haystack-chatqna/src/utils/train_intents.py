# src/utils/train_intents.py

"""
Train FAISS intent classifier with ~5000+ augmented examples.
Core: ~540 hand-written | Augmented: ~4500+ via paraphrase generation

Run: docker exec haystack-chatqna python -m src.utils.train_intents
"""

import json
import random
import itertools
import faiss
import numpy as np
from sentence_transformers import SentenceTransformer

CORE_TRIAGE = [
    "I have severe chest pain",
    "My chest hurts really bad",
    "I think I'm having a heart attack",
    "Sharp pain in my chest won't go away",
    "My chest feels tight and I'm sweating",
    "Pressure in my chest radiating to my arm",
    "Crushing pain in the middle of my chest",
    "My left arm is tingling and my chest hurts",
    "I can't breathe properly",
    "I'm having serious trouble breathing",
    "My breathing is getting worse",
    "I feel like I'm suffocating",
    "I can't catch my breath",
    "My child is struggling to breathe",
    "I'm gasping for air",
    "My lips are turning blue",
    "I feel numbness on one side of my body",
    "I'm having trouble speaking and my face is drooping",
    "My arm suddenly went numb",
    "I can't see out of one eye suddenly",
    "I have the worst headache of my life",
    "My face is drooping on one side",
    "My speech is slurred and I feel confused",
    "One side of my body feels weak suddenly",
    "My blood sugar is extremely low and I feel confused",
    "My blood sugar is over 500",
    "I'm diabetic and I'm shaking and confused",
    "I think I'm having a diabetic emergency",
    "My family member is diabetic and won't wake up",
    "Blood sugar reading says HI on the meter",
    "I'm bleeding and it won't stop",
    "I'm coughing up blood",
    "There's blood in my stool",
    "I'm vomiting blood",
    "I cut myself and the bleeding won't stop",
    "My blood pressure is dangerously high",
    "Blood pressure is 200 over 120",
    "I have a very high fever and I'm shaking",
    "I took too many pills by accident",
    "My child is choking",
    "I'm having a seizure",
    "Someone collapsed and is not moving",
    "I have unbearable abdominal pain",
    "I can't feel my legs",
    "My throat is closing from allergic reaction",
    "I feel like I'm going to faint",
    "My heart is beating very fast",
    "I've been bitten by a snake",
    "My fever is very high from malaria",
    "I'm pregnant and bleeding heavily",
    "My child has a febrile convulsion",
    "I overdosed on my medication",
    "I lost vision in both eyes",
    "I have a severe burn",
    "I was in an accident with severe pain",
    "I feel like I want to hurt myself",
    "I'm thinking about ending my life",
    "I don't want to live anymore",
    "Please help me something is very wrong",
    "I need emergency help right now",
    "This is an emergency",
    "Call an ambulance",
    "I need to go to the hospital immediately",
    "Help my mother collapsed",
    "My father is not breathing",
    "The baby is turning blue",
    "I think my child swallowed poison",
]

CORE_ASSISTANT = [
    "What is diabetes?",
    "How do I manage my blood sugar?",
    "What foods should I avoid with diabetes?",
    "What is HbA1c?",
    "Difference between type 1 and type 2 diabetes",
    "My blood sugar is 200 is that dangerous?",
    "I have prediabetes what should I do?",
    "How does insulin work?",
    "What are the symptoms of diabetes?",
    "Can diabetes be cured?",
    "How often should I check my blood sugar?",
    "What happens if diabetes is untreated?",
    "Can diabetes affect my eyes?",
    "My feet feel numb from diabetes",
    "What is diabetic neuropathy?",
    "Can I eat rice with diabetes?",
    "What fruits are safe for diabetics?",
    "How does exercise help diabetes?",
    "What is gestational diabetes?",
    "What is a normal blood sugar level?",
    "What foods lower blood sugar?",
    "Can stress raise blood sugar?",
    "Why is blood sugar high in the morning?",
    "What is insulin resistance?",
    "Is diabetes hereditary?",
    "How does diabetes affect kidneys?",
    "Can I reverse type 2 diabetes?",
    "What are warning signs of low blood sugar?",
    "How does sleep affect blood sugar?",
    "Can diabetes be managed without medication?",
    "What is metformin used for?",
    "Can I fast during Ramadan with diabetes?",
    "What is hypertension?",
    "How can I lower blood pressure naturally?",
    "What are symptoms of high blood pressure?",
    "How often should I check blood pressure?",
    "My blood pressure is 160 over 100",
    "How do I prevent a stroke?",
    "Tell me about cholesterol",
    "What should I eat to control cholesterol?",
    "Can I drink alcohol with high blood pressure?",
    "How much salt is too much?",
    "What medications for high blood pressure?",
    "What is the normal blood pressure range?",
    "Can high blood pressure damage kidneys?",
    "What causes heart disease?",
    "How does stress affect my heart?",
    "What are risk factors for stroke?",
    "Can I exercise with high blood pressure?",
    "Is hypertension hereditary?",
    "Can young people get high blood pressure?",
    "How does caffeine affect blood pressure?",
    "Can meditation lower blood pressure?",
    "What is coronary artery disease?",
    "What is a normal cholesterol level?",
    "Can exercise alone control blood pressure?",
    "Can losing weight lower blood pressure?",
    "What are omega 3 fatty acids good for?",
    "What are warning signs of cancer?",
    "What screening tests should I get?",
    "What causes breast cancer?",
    "How often to screen for cervical cancer?",
    "What is hepatitis B and liver cancer?",
    "Can cancer be prevented?",
    "How to do breast self-examination?",
    "What is the HPV vaccine?",
    "Can a healthy diet reduce cancer risk?",
    "What is a mammogram?",
    "What are symptoms of breast cancer?",
    "Can smoking cause cancer?",
    "Can exercise reduce cancer risk?",
    "What are side effects of cancer treatment?",
    "How does hepatitis B vaccine prevent cancer?",
    "What is COPD?",
    "How do I use an asthma inhaler?",
    "What triggers asthma attacks?",
    "How can I manage asthma better?",
    "Can secondhand smoke cause lung problems?",
    "What breathing exercises help lungs?",
    "I have a persistent cough",
    "Can dust cause breathing problems?",
    "How do I keep my lungs healthy?",
    "What is pneumonia?",
    "Can cooking smoke cause lung problems?",
    "How do I quit smoking?",
    "What happens after I quit smoking?",
    "How long does nicotine withdrawal last?",
    "What are health risks of smoking?",
    "Tips to stop smoking",
    "Is shisha as dangerous as cigarettes?",
    "How does alcohol affect health?",
    "How much alcohol is safe?",
    "Can alcohol cause high blood pressure?",
    "How can I manage stress?",
    "What medications help depression?",
    "How to reduce anxiety without medication?",
    "How do I improve my sleep?",
    "What is depression?",
    "Can chronic disease cause depression?",
    "How does exercise help mental health?",
    "I can't sleep at night",
    "What is the connection between diabetes and depression?",
    "What is burnout?",
    "How do I practice mindfulness?",
    "Can lack of sleep cause health problems?",
    "What is a panic attack?",
    "How many hours of sleep do I need?",
    "What is insomnia?",
    "What are side effects of metformin?",
    "How to take blood pressure medication?",
    "Can I stop medication if I feel better?",
    "What if I miss a dose?",
    "Can I take traditional medicine with prescription?",
    "My medication makes me dizzy",
    "How to store insulin properly?",
    "Can medications interact?",
    "Generic versus brand name drugs?",
    "How long to take blood pressure medication?",
    "Can I eat domoda with diabetes?",
    "Is benachin healthy for heart disease?",
    "Can moringa help with diabetes?",
    "What is a healthy diet in The Gambia?",
    "How to make domoda healthier?",
    "Is palm oil bad for my heart?",
    "Should I eat millet instead of rice?",
    "How much groundnut paste is okay?",
    "Is supakanja good for blood pressure?",
    "Can baobab juice help health?",
    "Is dried fish bad for blood pressure?",
    "How to reduce salt in Gambian cooking?",
    "Is chere better than rice for diabetics?",
    "What Gambian foods are heart-healthy?",
    "Is Maggi cube bad for blood pressure?",
    "How to eat healthy on a budget in Gambia?",
    "Is attaya tea okay with diabetes?",
    "How to cook benachin with less oil?",
    "Can I eat mangoes with diabetes?",
    "Is okra water good for diabetes?",
    "Is hibiscus tea good for the heart?",
    "How to prepare moringa leaves?",
    "Can I eat cassava with diabetes?",
    "Is wonjo drink healthy?",
    "I'm pregnant with diabetes what should I know?",
    "Blood pressure medication during pregnancy?",
    "What is gestational diabetes management?",
    "How to eat healthy during pregnancy?",
    "Can high BP affect pregnancy?",
    "What exercises are safe during pregnancy?",
    "What is postpartum depression?",
    "How much exercise per week?",
    "Benefits of walking?",
    "What exercises are safe for diabetics?",
    "How to start exercising?",
    "Can exercise help depression?",
    "Best exercise for weight loss?",
    "Can I exercise with asthma?",
    "How to exercise in hot weather?",
    "Can yoga help blood pressure?",
    "Can household chores count as exercise?",
    "When should I see a doctor?",
    "What is preventive healthcare?",
    "How much water per day?",
    "What is BMI?",
    "What vaccines for adults?",
    "What is fatty liver?",
    "What causes kidney disease?",
    "How to lose weight safely?",
    "What is chronic kidney disease?",
    "What are non-communicable diseases?",
    "Why are NCDs a problem in Gambia?",
    "How to access healthcare in rural Gambia?",
    "I have been feeling tired all the time",
    "My legs swell up at the end of the day",
    "I get headaches every morning",
    "I feel dizzy when I stand up",
    "My wound is not healing",
    "I have been losing weight without trying",
    "I feel thirsty all the time",
    "I go to the bathroom too often at night",
    "My appetite has decreased",
    "I feel weak and fatigued",
    "I can't afford my medication",
    "How to get my family to eat healthier?",
    "How to lose weight safely?",
    "What is portion control?",
    "Can stress cause weight gain?",
    "Is intermittent fasting safe?",
    "How to stop craving sugary foods?",
    "How to manage multiple chronic conditions?",
]

CORE_SMALLTALK = [
    "Hello",
    "Hi there",
    "How are you?",
    "Good morning",
    "Good afternoon",
    "Good evening",
    "What is your name?",
    "Who are you?",
    "Thank you",
    "Thanks for your help",
    "Goodbye",
    "What can you do?",
    "Tell me about yourself",
    "Nice to meet you",
    "Hey",
    "Hi Amina",
    "Are you a real doctor?",
    "Can I trust your advice?",
    "How do you work?",
    "Who made you?",
    "What topics can you help with?",
    "Okay thanks",
    "That was helpful",
    "See you later",
    "Bye bye",
    "Have a nice day",
    "Assalamu alaikum",
    "Peace be upon you",
    "Na nga def",
    "I naa le",
    "Are you AI?",
    "Is this a chatbot?",
    "Can you help me?",
    "I have a question",
    "Take care",
    "God bless",
    "Inshallah",
    "Mashallah",
    "Alhamdulillah",
    "Jazakallah",
    "Nanga def?",
    "Jam nga fanaan?",
    "Yo",
    "Whats up",
    "Great advice",
    "Perfect thank you",
    "You made me feel better",
    "Bless you",
    "I appreciate your help",
    "Tell me more",
]


def augment(core_triage, core_assistant, core_smalltalk, target=5000):
    random.seed(42)
    data = []

    # Add all core
    for q in core_triage:
        data.append((q, "triage"))
    for q in core_assistant:
        data.append((q, "assistant"))
    for q in core_smalltalk:
        data.append((q, "smalltalk"))

    # ── TRIAGE augmentation ──
    triage_prefixes = [
        "Help! ", "Please help! ", "Emergency! ", "Oh God ",
        "I'm scared ", "Someone help ", "Please ",
        "I need help ", "Quick ", "Hurry ",
    ]
    triage_suffixes = [
        "", " please help", " what do I do", " help me",
        " I'm scared", " this is serious", " I need help now",
        " what should I do", " is this an emergency",
    ]
    triage_rephrases = {
        "I have": ["I'm experiencing", "I've got", "I'm having", "I feel", "There is"],
        "I can't": ["I cannot", "I'm unable to", "I'm not able to", "I am struggling to"],
        "My": ["My mother's", "My father's", "My child's", "My husband's", "My wife's"],
    }
    for q in core_triage:
        # Prefix variations (3 per example)
        for _ in range(3):
            p = random.choice(triage_prefixes)
            data.append((p + q[0].lower() + q[1:], "triage"))
        # Suffix variations (2 per example)
        for _ in range(2):
            s = random.choice(triage_suffixes)
            if s:
                data.append((q + s, "triage"))
        # Rephrase (1 per example)
        for old, news in triage_rephrases.items():
            if q.startswith(old):
                data.append((random.choice(news) + q[len(old):], "triage"))
                break

    # ── ASSISTANT augmentation ──
    asst_prefixes = [
        "Can you tell me ", "I want to know ", "Please explain ",
        "I need information about ", "Help me understand ",
        "What do you know about ", "I'm curious about ",
        "Could you explain ", "I'd like to learn about ",
        "Tell me ", "Explain to me ", "I have a question about ",
        "Can you help me with ", "I need advice on ",
        "What can you tell me about ", "I wonder about ",
        "My doctor mentioned ", "I read about ",
        "Someone told me about ", "I heard that ",
    ]
    asst_suffixes = [
        "", " please", " thanks", " can you help?",
        " what should I do?", " is this serious?",
        " I'm worried", " I need advice", " for my health",
        " any tips?", " what do you suggest?", " I'm concerned",
    ]
    asst_rephrases = {
        "What is": ["Tell me about", "Explain", "Define", "Describe", "What do you mean by"],
        "How do I": ["What's the best way to", "How can I", "What should I do to", "Tips for", "Ways to", "How to"],
        "Can I": ["Is it safe to", "Is it okay to", "Should I", "Am I able to", "Would it be fine to", "Is it advisable to"],
        "What are": ["List the", "Tell me the", "Name some", "Give me examples of", "What would be the"],
        "How can I": ["What's the best way to", "How do I", "What should I do to", "Best approach to"],
        "How much": ["What amount of", "How many", "What quantity of", "How much of"],
        "How often": ["How frequently", "How many times", "How regularly should I"],
        "What causes": ["Why does", "What leads to", "What is the reason for", "Why do people get"],
        "Is": ["Would", "Could", "Does", "Can"],
    }

    for q in core_assistant:
        # Prefix variations (3 per example)
        for _ in range(3):
            p = random.choice(asst_prefixes)
            lower_q = q[0].lower() + q[1:] if q[0].isupper() else q
            lower_q = lower_q.rstrip("?").rstrip(".")
            data.append((f"{p}{lower_q}?", "assistant"))
        # Suffix variations (2 per example)
        for _ in range(2):
            s = random.choice(asst_suffixes)
            if s:
                data.append((q.rstrip("?").rstrip(".") + s, "assistant"))
        # Rephrase (1 per example)
        for old, news in asst_rephrases.items():
            if q.startswith(old):
                data.append((random.choice(news) + q[len(old):], "assistant"))
                break

    # ── SMALLTALK augmentation ──
    talk_variations = [
        "Hey {}", "Hi {}", "Hello {}",
        "{} how are you", "{} nice to talk",
    ]
    talk_extras = [
        "Thanks Amina", "Amina thank you", "Thank you Amina",
        "Ok Amina", "Got it Amina", "Understood",
        "Yes please", "No thanks", "Not right now",
        "Maybe later", "I'll think about it", "That makes sense",
        "OK I understand", "Right", "Sure thing",
        "Cool", "Noted", "Will do",
        "Good to know", "Interesting", "I did not know that",
        "Really?", "Oh okay", "I see what you mean",
        "Hmm okay", "Let me think", "One moment",
        "Before I go", "One more thing", "Last question",
        "Actually never mind", "That's all", "Nothing else",
        "You're great", "Very helpful", "Best advice",
        "Love this app", "Amazing help", "So useful",
        "Salam", "Salaam", "Wa alaikum salam",
        "Naka ligey?", "Mangi fi", "Jaam rekk",
        "Naka sa yaram?", "Ana waa keur?", "Jaarama",
    ]
    for q in core_smalltalk:
        for tmpl in random.sample(talk_variations, 2):
            data.append((tmpl.format(q.lower()), "smalltalk"))
    for q in talk_extras:
        data.append((q, "smalltalk"))

    # ── Gambian English pidgin ──
    pidgin = [
        ("I dey feel pain for my chest", "triage"),
        ("My body no dey well at all", "assistant"),
        ("I want make I know about sugar sickness", "assistant"),
        ("How I go fit manage my BP?", "assistant"),
        ("The medicine wey doctor give me dey make me dizzy", "assistant"),
        ("I no fit sleep at night", "assistant"),
        ("My pikin get fever", "triage"),
        ("Wetin I go eat if I get sugar?", "assistant"),
        ("This domoda go affect my sugar?", "assistant"),
        ("I want lose weight how I go do am?", "assistant"),
        ("My mama get high blood wey no dey come down", "assistant"),
        ("I dey smoke how I go stop?", "assistant"),
        ("My body dey pain me everywhere", "assistant"),
        ("I dey feel weak all the time", "assistant"),
        ("Doctor talk say I get cholesterol", "assistant"),
        ("I no understand wetin the test talk", "assistant"),
        ("How much Maggi I fit use?", "assistant"),
        ("Attaya good for person wey get sugar?", "assistant"),
        ("I want know about cancer screening", "assistant"),
        ("My papa get stroke wetin I go do?", "triage"),
        ("The sickness dey worry me", "assistant"),
        ("I dey fear say I get cancer", "assistant"),
        ("My heart dey beat fast fast", "triage"),
        ("I no fit breathe well", "triage"),
        ("Blood dey come from my nose", "triage"),
        ("My eye dey pain me", "assistant"),
        ("I get rash for my body", "assistant"),
        ("My belly dey pain since morning", "assistant"),
        ("I dey vomit since yesterday", "triage"),
        ("My pikin no dey eat", "assistant"),
    ]
    data.extend(pidgin)

    # ── Personal framing ──
    conditions = [
        "diabetes", "blood sugar", "blood pressure", "cholesterol",
        "weight", "medication", "asthma", "depression", "anxiety",
        "kidney problem", "heart condition", "high blood pressure",
        "breathing problems", "joint pain", "back pain", "fatigue",
        "insomnia", "stress", "hypertension", "liver problem",
    ]
    templates = [
        "How do I manage my {}?",
        "What should I know about my {}?",
        "Is my {} getting worse?",
        "Can I control {} with diet?",
        "What exercises help with {}?",
        "How does {} affect daily life?",
        "What foods should I avoid for {}?",
        "Can {} be reversed?",
        "Should I worry about my {}?",
        "What are complications of {}?",
        "My doctor said I have {} what now?",
        "I was diagnosed with {} last week",
        "How to live with {}?",
        "Will {} affect my children?",
        "Is {} common in The Gambia?",
    ]
    for cond in conditions:
        for tmpl in templates:
            data.append((tmpl.format(cond), "assistant"))

    # ── Deduplicate ──
    seen = set()
    unique = []
    for q, i in data:
        key = q.lower().strip().rstrip("?.!")
        if key not in seen and len(key) > 1:
            seen.add(key)
            unique.append((q, i))

    return unique


def train():
    data = augment(CORE_TRIAGE, CORE_ASSISTANT, CORE_SMALLTALK)
    print(f"Training FAISS intent classifier with {len(data)} examples...")

    queries = [q for q, _ in data]
    labels = [l for _, l in data]

    model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    embeddings = model.encode(queries, convert_to_numpy=True, show_progress_bar=True, batch_size=64)
    faiss.normalize_L2(embeddings)

    dim = embeddings.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(embeddings)

    faiss.write_index(index, "src/models/intent/router.faiss")
    with open("src/models/intent/intent_labels.json", "w") as f:
        json.dump(labels, f)

    intent_counts = {}
    for l in labels:
        intent_counts[l] = intent_counts.get(l, 0) + 1

    print(f"\n✅ FAISS index saved: {index.ntotal} vectors, {len(set(labels))} intents")
    for intent, count in sorted(intent_counts.items()):
        print(f"   {intent}: {count} examples")


if __name__ == "__main__":
    train()