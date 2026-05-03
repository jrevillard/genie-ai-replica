# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""GENIE.AI voice bridge.

A WebSocket service that wires the existing ASR / chatqna LLM / TTS pipeline
into a real-time-ish voice call without WebRTC. Replaces the LiveKit-based
voice-agent for environments where WebRTC NAT traversal is impractical
(e.g. cloud firewalls without UDP reachability).

Wire format
-----------
Client → server messages
    text: {"type":"start","language":"fr|en|es"}     # first message
    text: {"type":"stop"}                             # graceful end
    binary: PCM 16-bit little-endian, 16 kHz mono, in 20 ms frames (640 bytes)

Server → client messages
    text: {"type":"ready"}                            # greeting done, mic on
    text: {"type":"user_speaking"}                    # VAD detected speech
    text: {"type":"transcript","text":"..."}          # final ASR result
    text: {"type":"agent_text","text":"..."}          # LLM sentence
    text: {"type":"tts_start","sample_rate":22050}    # next bytes are audio
    binary: PCM 16-bit little-endian audio at sample_rate
    text: {"type":"tts_end"}                          # done speaking
    text: {"type":"error","message":"..."}            # something failed
"""

import asyncio
import datetime
import io
import json
import logging
import os
import re
import wave
from typing import AsyncIterator, List, Optional

import httpx
import jwt as pyjwt
import webrtcvad
from arango import ArangoClient
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("genieai_voice_bridge")
logflag = os.getenv("LOGFLAG", "").lower() in ("1", "true", "yes")

ASR_URL = os.getenv("ASR_WHISPER_URL", "http://asr-whisper:9100")
TTS_URL = os.getenv("TTS_PIPER_URL") or os.getenv("TTS_URL") or "http://tts-piper:9200"
# Direct vLLM endpoint (OpenAI-compatible). We bypass chatqna's RAG pipeline
# for voice — RAG adds 5-7s of overhead per turn (embedding, retrieval,
# reranking, big system prompt) that voice users don't need. Voice replies
# come straight from the LLM with a tight conversational prompt.
LLM_ENDPOINT = os.getenv("LLM_ENDPOINT", "http://vllm:8000/v1/chat/completions")
LLM_MODEL = os.getenv("LLM_MODEL", os.getenv("VLLM_LLM_MODEL_ID", "meta-llama/Meta-Llama-3.1-8B-Instruct"))
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "128"))
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.7"))
HOST = os.getenv("VOICE_BRIDGE_HOST", "0.0.0.0")
PORT = int(os.getenv("VOICE_BRIDGE_PORT", "9400"))

# Audio: PCM 16 kHz mono 16-bit, in 20 ms frames (320 samples = 640 bytes)
SAMPLE_RATE = 16000
FRAME_SAMPLES = int(SAMPLE_RATE * 20 / 1000)
FRAME_BYTES = FRAME_SAMPLES * 2

# JWT shared secret with the backend. Used to verify the short-lived voice
# token sent by the frontend in the WS start message. We extract the userId
# from it and write call sessions/messages to ArangoDB on the user's behalf —
# the frontend never gets to write directly.
JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")

# ArangoDB connection — same database the backend writes user/session data to.
ARANGO_URL = os.getenv("ARANGO_URL", "http://arangodb:8529")
ARANGO_DB = os.getenv("ARANGO_DB", "genie-ai")
ARANGO_USERNAME = os.getenv("ARANGO_USERNAME", "root")
ARANGO_PASSWORD = os.getenv("ARANGO_PASSWORD", "")

CALL_SESSIONS_COLLECTION = "call_sessions"
CALL_MESSAGES_COLLECTION = "call_messages"

VAD_AGGRESSIVENESS = int(os.getenv("VAD_AGGRESSIVENESS", "2"))
SILENCE_FRAMES_TO_END = int(os.getenv("SILENCE_FRAMES", "25"))     # ~500 ms
SPEECH_FRAMES_TO_START = int(os.getenv("SPEECH_FRAMES_START", "3"))  # ~60 ms
MIN_UTTERANCE_FRAMES = int(os.getenv("MIN_UTTERANCE_FRAMES", "10"))  # 200 ms
# After process_utterance finishes, drop any audio that was buffered up in the
# WebSocket receive queue during processing. Without this, the agent picks up
# its own playback (echo) as a fresh utterance.
POST_PROCESS_DRAIN_S = float(os.getenv("POST_PROCESS_DRAIN_S", "1.5"))

GREETINGS = {
    "fr": "Bonjour, je suis l'assistant vocal GENIE.AI. En quoi puis-je vous aider ?",
    "en": "Hello, this is the GENIE.AI voice assistant. How can I help you today?",
    "es": "Hola, soy el asistente de voz GENIE.AI. ¿En qué puedo ayudarte?",
    "sw": "Habari, mimi ni msaidizi wa sauti wa GENIE.AI. Nikusaidie nini leo?",
}

# Voice prompts mirror the chat prompt in genieai-chatqna (same identity,
# same scope, same Ministry of Health / WHO / BHBM framing, same do/don'ts,
# same safety red-flags). The only differences are:
#   1. VOICE MODE block — output is spoken, not text. No markdown/lists.
#   2. RAG grounding rules are dropped — voice bypasses chatqna and calls
#      vLLM directly, so there are no [Retrieved Document] entries to ground
#      against. The model speaks from general health guidance and routes to
#      a clinic for anything specific.
# Keep these in sync with _CHATQNA_SYSTEM_DEFAULT in
# genie-ai-overlay/chatqna/genieai_chatqna.py.
_DEFAULT_SYSTEM_PROMPTS = {
    "en": (
        "You are Genie AI, a trusted health companion for people in The Gambia. "
        "You help users prevent and manage non-communicable diseases (NCDs) — "
        "with a focus on hypertension, diabetes, and tobacco dependence — and "
        "the behaviours that drive them (diet, physical activity, tobacco use, "
        "stress).\n\n"
        "You are deployed by the Ministry of Health and built on evidence-based "
        "guidance from the World Health Organization, the WHO–ITU Be He@lthy Be "
        "Mobile (BHBM) programme, and Gambian national guidelines. You are NOT a "
        "doctor. You do NOT diagnose, prescribe, or change treatment. You help "
        "people understand their health, change habits, and decide when to seek "
        "care.\n\n"
        "VOICE MODE — HOW YOU MUST SPEAK\n"
        "You are on a phone call with the user. This is spoken conversation, "
        "not text.\n"
        "- Reply ONLY in English.\n"
        "- Keep every reply to 1 or 2 short sentences. Plain spoken language. "
        "Like a real phone call.\n"
        "- NO bullet points, NO numbered lists, NO markdown, NO headers, NO "
        "bold, NO emoji.\n"
        "- No long disclaimers. No clinical jargon. Use plain everyday words "
        "(say 'high blood pressure', not 'hypertension').\n"
        "- Ask at most ONE short follow-up question per turn. Never interrogate.\n"
        "- Tone: warm, patient, non-judgemental — like a kind community health "
        "worker on the phone. Never moralise, lecture, or shame.\n"
        "- Use Gambian-familiar framing (market, bantaba, attaya, domoda) only "
        "when it helps — never invent medical claims about food.\n\n"
        "WHAT YOU DO\n"
        "Explain NCD risks and prevention in plain words. Offer practical next "
        "steps the user can take today. Support behaviour change for tobacco, "
        "blood pressure, diabetes, diet, and activity. Refer to a clinic or "
        "community health worker when the situation needs in-person care.\n\n"
        "WHAT YOU DO NOT DO\n"
        "Do NOT diagnose. Do NOT prescribe medication, recommend a dose, or tell "
        "anyone to start, stop, or change a drug — for that, say a clinician at a "
        "clinic or community health worker can help.\n"
        "Do NOT answer outside NCD scope: infectious disease, paediatric "
        "emergencies, mental-health crises, injuries, poisoning, legal or "
        "financial advice. Briefly say it is not what you handle and point to "
        "a clinic.\n"
        "Do NOT invent facts, statistics, studies, or sources.\n\n"
        "SAFETY — RED FLAGS\n"
        "If the user describes any of the following, interrupt and tell them "
        "clearly to seek urgent care now: chest pain or pressure; sudden "
        "weakness, numbness, drooping face, or slurred speech (possible "
        "stroke); severe shortness of breath; fainting or seizure; sudden "
        "worst-ever headache; suicidal thoughts.\n"
        "Say clearly: 'What you're describing may be serious. Please go to the "
        "nearest health facility now, or ask someone to take you.'\n\n"
        "Treat everything the user shares as private. Never judge them for "
        "smoking, weight, diet, or past choices. Meet them where they are."
    ),
    "fr": (
        "Tu es Genie AI, un compagnon de santé de confiance pour les habitants "
        "de la Gambie. Tu aides les utilisateurs à prévenir et gérer les "
        "maladies non transmissibles (MNT) — en particulier l'hypertension, le "
        "diabète et la dépendance au tabac — ainsi que les comportements qui "
        "les favorisent (alimentation, activité physique, tabac, stress).\n\n"
        "Tu es déployé par le Ministère de la Santé et basé sur des données "
        "probantes issues de l'Organisation mondiale de la Santé, du programme "
        "WHO–ITU Be He@lthy Be Mobile (BHBM) et des directives nationales "
        "gambiennes. Tu n'es PAS médecin. Tu ne poses pas de diagnostic, tu ne "
        "prescris pas, tu ne modifies pas de traitement. Tu aides les gens à "
        "comprendre leur santé, changer leurs habitudes, et décider quand "
        "consulter.\n\n"
        "MODE VOCAL — COMMENT TU DOIS PARLER\n"
        "Tu es au téléphone avec l'utilisateur. C'est une conversation parlée, "
        "pas un texte écrit.\n"
        "- Réponds UNIQUEMENT en français.\n"
        "- Limite chaque réponse à 1 ou 2 phrases courtes. Langage parlé "
        "naturel. Comme un vrai appel.\n"
        "- AUCUNE puce, AUCUNE liste numérotée, AUCUN markdown, AUCUN titre, "
        "AUCUN gras, AUCUN emoji.\n"
        "- Pas de longs avertissements. Pas de jargon médical. Mots simples du "
        "quotidien.\n"
        "- Pose au maximum UNE courte question de relance par tour. Pas "
        "d'interrogatoire.\n"
        "- Ton : chaleureux, patient, sans jugement — comme un agent de santé "
        "communautaire bienveillant au téléphone. Jamais moraliser, sermonner "
        "ou faire honte.\n"
        "- Utilise des références gambiennes familières (marché, bantaba, "
        "attaya, domoda) uniquement quand cela aide — n'invente jamais de "
        "vertus médicales pour des aliments.\n\n"
        "CE QUE TU FAIS\n"
        "Expliquer les risques et la prévention des MNT en mots simples. "
        "Proposer des actions concrètes que la personne peut faire aujourd'hui. "
        "Soutenir le changement de comportement (tabac, tension, diabète, "
        "alimentation, activité). Orienter vers une clinique ou un agent de "
        "santé communautaire quand une consultation est nécessaire.\n\n"
        "CE QUE TU NE FAIS PAS\n"
        "Ne pose PAS de diagnostic. Ne prescris PAS de médicament, ne "
        "recommande pas de dose, ne dis à personne de commencer, arrêter ou "
        "modifier un médicament — pour cela, dis qu'un soignant en clinique "
        "ou un agent de santé communautaire peut aider.\n"
        "Ne réponds PAS en dehors du domaine des MNT : maladies infectieuses, "
        "urgences pédiatriques, crises de santé mentale, blessures, "
        "intoxications, conseils juridiques ou financiers. Dis brièvement "
        "que ce n'est pas ton rôle et oriente vers une clinique.\n"
        "N'invente PAS de faits, de statistiques, d'études ou de sources.\n\n"
        "SÉCURITÉ — SIGNAUX D'ALARME\n"
        "Si la personne décrit l'un des éléments suivants, interromps et "
        "dis-lui clairement de consulter en urgence : douleur ou pression "
        "thoracique ; faiblesse soudaine, engourdissement, visage tombant ou "
        "élocution troublée (AVC possible) ; essoufflement sévère ; "
        "évanouissement ou convulsion ; mal de tête soudain et le pire jamais "
        "ressenti ; idées suicidaires.\n"
        "Dis clairement : « Ce que vous décrivez peut être grave. Allez tout "
        "de suite au centre de santé le plus proche, ou demandez à quelqu'un "
        "de vous y emmener. »\n\n"
        "Traite tout ce que la personne partage comme privé. Ne juge jamais "
        "pour le tabac, le poids, l'alimentation ou les choix passés. "
        "Rencontre-la là où elle est."
    ),
    "es": (
        "Eres Genie AI, un compañero de salud de confianza para personas en "
        "Gambia. Ayudas a los usuarios a prevenir y manejar las enfermedades "
        "no transmisibles (ENT) — con foco en hipertensión, diabetes y "
        "dependencia del tabaco — y los hábitos que las impulsan (alimentación, "
        "actividad física, tabaco, estrés).\n\n"
        "Estás desplegado por el Ministerio de Salud y basado en evidencia de "
        "la Organización Mundial de la Salud, el programa WHO–ITU Be He@lthy "
        "Be Mobile (BHBM) y las directrices nacionales de Gambia. NO eres "
        "médico. NO diagnosticas, recetas ni cambias tratamientos. Ayudas a "
        "las personas a entender su salud, cambiar hábitos y decidir cuándo "
        "buscar atención.\n\n"
        "MODO VOZ — CÓMO DEBES HABLAR\n"
        "Estás en una llamada telefónica con el usuario. Es conversación "
        "hablada, no texto.\n"
        "- Responde SOLO en español.\n"
        "- Cada respuesta debe ser de 1 o 2 frases cortas. Lenguaje hablado "
        "natural. Como una llamada real.\n"
        "- SIN viñetas, SIN listas numeradas, SIN markdown, SIN encabezados, "
        "SIN negrita, SIN emoji.\n"
        "- Sin avisos largos. Sin jerga clínica. Palabras sencillas del día "
        "a día.\n"
        "- Haz como máximo UNA pregunta breve de seguimiento por turno. "
        "Nunca interrogues.\n"
        "- Tono: cálido, paciente, sin juzgar — como un agente de salud "
        "comunitario amable al teléfono. Nunca moralices, sermones ni "
        "avergüences.\n"
        "- Usa referencias familiares de Gambia (mercado, bantaba, attaya, "
        "domoda) solo cuando ayude — nunca inventes propiedades médicas de "
        "los alimentos.\n\n"
        "LO QUE HACES\n"
        "Explicar riesgos y prevención de ENT en palabras simples. Ofrecer "
        "pasos prácticos que la persona puede hacer hoy. Apoyar el cambio de "
        "hábitos (tabaco, presión, diabetes, dieta, actividad). Referir a "
        "una clínica o agente de salud comunitario cuando se necesite "
        "atención presencial.\n\n"
        "LO QUE NO HACES\n"
        "NO diagnostiques. NO recetes medicamentos, no recomiendes dosis, no "
        "le digas a nadie que empiece, pare o cambie un fármaco — para eso, "
        "di que un clínico en una clínica o un agente de salud comunitario "
        "puede ayudar.\n"
        "NO respondas fuera del alcance de las ENT: enfermedades infecciosas, "
        "emergencias pediátricas, crisis de salud mental, lesiones, "
        "intoxicaciones, consejos legales o financieros. Di brevemente que "
        "no es tu ámbito y refiere a una clínica.\n"
        "NO inventes hechos, estadísticas, estudios ni fuentes.\n\n"
        "SEGURIDAD — SEÑALES DE ALARMA\n"
        "Si la persona describe alguno de los siguientes, interrumpe y dile "
        "claramente que busque atención urgente: dolor u opresión en el "
        "pecho; debilidad súbita, entumecimiento, cara caída o dificultad "
        "para hablar (posible ACV); falta de aire severa; desmayo o "
        "convulsión; dolor de cabeza súbito el peor de su vida; "
        "pensamientos suicidas.\n"
        "Di claramente: «Lo que describes puede ser grave. Por favor ve al "
        "centro de salud más cercano ahora, o pide a alguien que te lleve.»\n\n"
        "Trata todo lo que comparta la persona como privado. Nunca la "
        "juzgues por fumar, su peso, su dieta o decisiones pasadas. "
        "Encuéntrala donde está."
    ),
    "sw": (
        "Wewe ni Genie AI, mwenza wa afya wa kuaminika kwa watu walioko "
        "Gambia. Unawasaidia watumiaji kuzuia na kudhibiti magonjwa "
        "yasiyoambukiza — hasa shinikizo la damu, kisukari, na utumiaji wa "
        "tumbaku — pamoja na tabia zinazochangia (lishe, mazoezi, tumbaku, "
        "msongo wa mawazo).\n\n"
        "Umetumwa na Wizara ya Afya na umejengwa kwa msingi wa miongozo ya "
        "Shirika la Afya Duniani (WHO), programu ya WHO–ITU Be He@lthy Be "
        "Mobile (BHBM), na miongozo ya kitaifa ya Gambia. Wewe SI daktari. "
        "Hutoi utambuzi, dawa, wala kubadilisha matibabu. Unawasaidia watu "
        "kuelewa afya yao, kubadilisha tabia, na kuamua wakati wa kutafuta "
        "huduma.\n\n"
        "HALI YA SAUTI — JINSI YA KUONGEA\n"
        "Uko kwenye simu na mtumiaji. Hii ni mazungumzo ya mdomo, sio "
        "maandishi.\n"
        "- Jibu KWA KISWAHILI tu.\n"
        "- Kila jibu liwe sentensi 1 au 2 fupi. Lugha rahisi ya kuongea. "
        "Kama simu halisi.\n"
        "- HAKUNA alama za risasi, HAKUNA orodha za nambari, HAKUNA markdown, "
        "HAKUNA vichwa, HAKUNA herufi nzito, HAKUNA emoji.\n"
        "- Hakuna maonyo marefu. Hakuna lugha ya kitabibu. Maneno rahisi ya "
        "kila siku.\n"
        "- Uliza zaidi swali MOJA tu fupi la kufuatilia kwa zamu. Usichunguze.\n"
        "- Mtazamo: joto, uvumilivu, bila kuhukumu — kama mfanyakazi wa "
        "afya wa jamii mwenye huruma kwenye simu. Usimhukumu, usimhubirie, "
        "wala usimwaibishe.\n"
        "- Tumia mifano ya Kigambia (soko, bantaba, attaya, domoda) tu "
        "inaposaidia — usibuni kamwe madai ya kitabibu kuhusu vyakula.\n\n"
        "UNAFANYA NINI\n"
        "Eleza hatari na uzuiaji wa magonjwa yasiyoambukiza kwa maneno "
        "rahisi. Toa hatua za kivitendo mtu anaweza kuchukua leo. Saidia "
        "mabadiliko ya tabia (tumbaku, shinikizo, kisukari, lishe, mazoezi). "
        "Mpeleke kwenye kliniki au mfanyakazi wa afya wa jamii pale ambapo "
        "huduma ya ana kwa ana inahitajika.\n\n"
        "USIYOFANYA\n"
        "USITOE utambuzi. USIANDIKE dawa, usipendekeze kipimo, wala usimwambie "
        "mtu yeyote kuanza, kusimamisha au kubadilisha dawa — kwa hilo, "
        "sema mtaalamu wa kliniki au mfanyakazi wa afya wa jamii anaweza "
        "kusaidia.\n"
        "USIJIBU nje ya magonjwa yasiyoambukiza: magonjwa ya kuambukiza, "
        "dharura za watoto, dharura za afya ya akili, majeraha, sumu, "
        "ushauri wa kisheria au kifedha. Sema kwa ufupi kuwa hili sio "
        "jukumu lako na umpeleke kwenye kliniki.\n"
        "USIBUNI ukweli, takwimu, utafiti, au vyanzo.\n\n"
        "USALAMA — DALILI ZA HATARI\n"
        "Ikiwa mtu ataeleza mojawapo ya yafuatayo, sitisha na mwambie kwa "
        "uwazi atafute huduma ya haraka: maumivu au mkazo wa kifua; "
        "udhaifu wa ghafla, ganzi, uso unaoanguka, au kushindwa kuongea "
        "(huenda kiharusi); upungufu mkubwa wa pumzi; kuzimia au kifafa; "
        "maumivu makali ya kichwa ya ghafla yasiyo ya kawaida; mawazo ya "
        "kujidhuru.\n"
        "Sema waziwazi: 'Hili unalolieleza linaweza kuwa la hatari. "
        "Tafadhali nenda kituo cha afya cha karibu sasa, au muulize mtu "
        "akupeleke.'\n\n"
        "Chukua kila kitu mtu anachoshiriki kama cha siri. Usimhukumu kamwe "
        "kwa kuvuta sigara, uzito, lishe, au maamuzi ya zamani. Mkutane "
        "alipo."
    ),
}

# Allow per-language override from env (single-line in .env, use \n for breaks).
# Empty string falls back to the in-code default.
def _load_prompt(lang: str, default: str) -> str:
    override = os.getenv(f"VOICE_SYSTEM_PROMPT_{lang.upper()}", "").strip()
    return override.replace("\\n", "\n") if override else default

SYSTEM_PROMPTS = {lang: _load_prompt(lang, default) for lang, default in _DEFAULT_SYSTEM_PROMPTS.items()}

SENTENCE_BOUNDARY = re.compile(r"(.+?[\.!\?\n])(\s+|$)", re.DOTALL)


app = FastAPI(title="GENIE.AI Voice Bridge")


@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse({"ok": True, "asr": ASR_URL, "tts": TTS_URL, "llm": LLM_ENDPOINT})


def pcm_to_wav_bytes(pcm: bytes, sample_rate: int = SAMPLE_RATE) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm)
    return buf.getvalue()


_arango_db_handle = None


def get_arango_db():
    """Lazy-init ArangoDB connection. Returns None if not configured so the
    voice bridge can still serve calls without persistence (degraded mode)."""
    global _arango_db_handle
    if _arango_db_handle is not None:
        return _arango_db_handle
    if not ARANGO_PASSWORD:
        logger.warning("[ARANGO] ARANGO_PASSWORD not set — call sessions will not be persisted")
        return None
    try:
        client = ArangoClient(hosts=ARANGO_URL)
        db = client.db(ARANGO_DB, username=ARANGO_USERNAME, password=ARANGO_PASSWORD)
        # Touch the connection so we fail fast on bad creds.
        db.version()
        _arango_db_handle = db
        logger.info("[ARANGO] connected url=%s db=%s", ARANGO_URL, ARANGO_DB)
        return db
    except Exception as exc:
        logger.exception("[ARANGO] connection failed: %s", exc)
        return None


def verify_voice_token(token: str) -> Optional[str]:
    """Verify the short-lived voice JWT minted by the backend. Returns
    the userId on success, None on failure."""
    if not token or not JWT_SECRET:
        return None
    try:
        claims = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception as exc:
        logger.warning("[AUTH] voice token rejected: %s", exc)
        return None
    user_id = claims.get("userId") or claims.get("sub")
    if not user_id:
        logger.warning("[AUTH] voice token missing userId/sub")
        return None
    return str(user_id)


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def _create_call_session_sync(user_id: str, language: str, gender: str) -> Optional[str]:
    db = get_arango_db()
    if db is None:
        return None
    now = _now_iso()
    doc = {
        "userId": str(user_id),
        "language": language,
        "gender": gender or "female",
        "startAt": now,
        "endAt": None,
        "durationSeconds": None,
        "createdAt": now,
    }
    try:
        meta = db.collection(CALL_SESSIONS_COLLECTION).insert(doc)
        return meta["_key"]
    except Exception as exc:
        logger.exception("[ARANGO] failed to create call session: %s", exc)
        return None


def _log_call_message_sync(session_id: str, content: str, is_assistant: bool) -> None:
    db = get_arango_db()
    if db is None or not session_id:
        return
    text = (content or "").strip()
    if not text:
        return
    try:
        db.collection(CALL_MESSAGES_COLLECTION).insert({
            "sessionId": str(session_id),
            "content": text,
            "isAssistant": bool(is_assistant),
            "createdAt": _now_iso(),
        })
    except Exception as exc:
        logger.warning("[ARANGO] failed to log call message: %s", exc)


def _end_call_session_sync(session_id: str) -> None:
    db = get_arango_db()
    if db is None or not session_id:
        return
    try:
        sessions = db.collection(CALL_SESSIONS_COLLECTION)
        existing = sessions.get(session_id)
        if not existing:
            return
        end_dt = datetime.datetime.now(datetime.timezone.utc)
        try:
            start_dt = datetime.datetime.fromisoformat(existing["startAt"].replace("Z", "+00:00"))
        except Exception:
            start_dt = end_dt
        duration = max(0, int((end_dt - start_dt).total_seconds()))
        sessions.update({
            "_key": session_id,
            "endAt": end_dt.isoformat().replace("+00:00", "Z"),
            "durationSeconds": duration,
        })
        logger.info("[ARANGO] call session ended _key=%s duration=%ds", session_id, duration)
    except Exception as exc:
        logger.warning("[ARANGO] failed to end call session: %s", exc)


async def create_call_session(user_id: str, language: str, gender: str) -> Optional[str]:
    return await asyncio.to_thread(_create_call_session_sync, user_id, language, gender)


async def log_call_message(session_id: Optional[str], content: str, is_assistant: bool) -> None:
    if not session_id:
        return
    await asyncio.to_thread(_log_call_message_sync, session_id, content, is_assistant)


async def end_call_session(session_id: Optional[str]) -> None:
    if not session_id:
        return
    await asyncio.to_thread(_end_call_session_sync, session_id)


async def transcribe(pcm: bytes, language: str) -> str:
    duration_s = len(pcm) / (SAMPLE_RATE * 2)
    logger.info("[ASR] start lang=%s pcm_bytes=%d duration=%.2fs", language, len(pcm), duration_s)
    wav_bytes = pcm_to_wav_bytes(pcm)
    t0 = asyncio.get_event_loop().time()
    async with httpx.AsyncClient(timeout=30) as client:
        files = {"file": ("audio.wav", wav_bytes, "audio/wav")}
        data = {"language": language}
        r = await client.post(f"{ASR_URL}/v1/microservice/asr", files=files, data=data)
        r.raise_for_status()
        text = (r.json().get("text") or "").strip()
    elapsed = asyncio.get_event_loop().time() - t0
    logger.info("[ASR] done elapsed=%.2fs text=%r", elapsed, text)
    return text


def _is_openai_compat(url: str) -> bool:
    """vLLM/OpenAI-compatible endpoints support real SSE streaming. chatqna
    returns a single JSON blob — we treat that as one big chunk."""
    return "chat/completions" in url


async def stream_llm_tokens(messages: list) -> AsyncIterator[str]:
    """Yield content tokens as the LLM produces them (vLLM SSE)."""
    last_user = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")
    logger.info("[LLM] stream start endpoint=%s user_msg=%r history_len=%d max_tokens=%d",
                LLM_ENDPOINT, last_user[:80], len(messages), LLM_MAX_TOKENS)
    payload = {
        "model": LLM_MODEL,
        "messages": messages,
        "stream": True,
        "max_tokens": LLM_MAX_TOKENS,
        "temperature": LLM_TEMPERATURE,
    }
    t0 = asyncio.get_event_loop().time()
    first_at = None
    chunks = 0
    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream("POST", LLM_ENDPOINT, json=payload) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if not line:
                    continue
                if line.startswith("data:"):
                    line = line[5:].strip()
                if line == "[DONE]":
                    break
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                choices = obj.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta", {}).get("content")
                if delta:
                    if first_at is None:
                        first_at = asyncio.get_event_loop().time()
                        logger.info("[LLM] first token after %.2fs", first_at - t0)
                    chunks += 1
                    yield delta
    elapsed = asyncio.get_event_loop().time() - t0
    logger.info("[LLM] stream done elapsed=%.2fs chunks=%d", elapsed, chunks)


async def call_llm(messages: list) -> str:
    """Non-streaming LLM call. Fallback path for chatqna. Supports both
    OpenAI-compatible (`{choices:[{message:{content}}]}`) and chatqna
    (`{response: "..."}`) shapes.
    """
    last_user = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")
    logger.info("[LLM] start endpoint=%s user_msg=%r history_len=%d max_tokens=%d",
                LLM_ENDPOINT, last_user[:80], len(messages), LLM_MAX_TOKENS)
    payload = {
        "model": LLM_MODEL,
        "messages": messages,
        "stream": False,
        "max_tokens": LLM_MAX_TOKENS,
        "temperature": LLM_TEMPERATURE,
    }
    t0 = asyncio.get_event_loop().time()
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(LLM_ENDPOINT, json=payload)
        r.raise_for_status()
        data = r.json()
    elapsed = asyncio.get_event_loop().time() - t0
    text = ""
    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        msg = choices[0].get("message") or {}
        text = (msg.get("content") or "").strip()
    if not text:
        text = (data.get("response") or data.get("text") or "").strip()
    logger.info("[LLM] done elapsed=%.2fs reply_len=%d preview=%r", elapsed, len(text), text[:120])
    return text


async def speak(ws: WebSocket, text: str, language: str, *, voice: Optional[str],
                session_id: Optional[str] = None) -> None:
    """Synthesize `text` via Piper TTS and stream PCM frames to the client."""
    if not text or not text.strip():
        return
    text = text.strip()
    logger.info("[TTS] start lang=%s voice=%s text=%r", language, voice, text[:120])
    await ws.send_text(json.dumps({"type": "agent_text", "text": text}))
    await log_call_message(session_id, text, is_assistant=True)
    t0 = asyncio.get_event_loop().time()
    chunks = 0
    bytes_sent = 0
    payload = {"text": text, "language": language}
    if voice:
        payload["voice"] = voice
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            async with client.stream(
                "POST",
                f"{TTS_URL}/v1/microservice/tts",
                json=payload,
            ) as r:
                r.raise_for_status()
                sample_rate = int(r.headers.get("x-sample-rate", "22050"))
                await ws.send_text(json.dumps({"type": "tts_start", "sample_rate": sample_rate}))
                async for chunk in r.aiter_bytes(chunk_size=4096):
                    if chunk:
                        await ws.send_bytes(chunk)
                        chunks += 1
                        bytes_sent += len(chunk)
        await ws.send_text(json.dumps({"type": "tts_end"}))
        elapsed = asyncio.get_event_loop().time() - t0
        logger.info("[TTS] done elapsed=%.2fs chunks=%d bytes=%d sample_rate=%d",
                    elapsed, chunks, bytes_sent, sample_rate)
    except Exception as exc:
        logger.exception("[TTS] failed: %s", exc)
        try:
            await ws.send_text(json.dumps({"type": "error", "message": "tts_failed"}))
        except Exception:
            pass


def split_sentences(buf: str) -> tuple[List[str], str]:
    """Pull out completed sentences from a streaming buffer.

    Returns (list_of_sentences, leftover_buffer)."""
    sentences: List[str] = []
    last = 0
    for m in SENTENCE_BOUNDARY.finditer(buf):
        sentence = m.group(1).strip()
        if sentence:
            sentences.append(sentence)
        last = m.end()
    return sentences, buf[last:]


async def process_utterance(ws: WebSocket, pcm: bytes, language: str, history: list,
                             *, voice: Optional[str],
                             session_id: Optional[str] = None) -> None:
    """Run ASR -> LLM -> TTS for one utterance.

    Wrapped in `asyncio.create_task` by the WS loop, so a `barge_in` message
    triggers `task.cancel()` and we exit cleanly between steps. Each `await`
    is a cancellation point.
    """
    logger.info("[PROCESS] start voice=%s lang=%s pcm_bytes=%d",
                voice, language, len(pcm))
    full_parts: List[str] = []
    sentence_buf = ""
    try:
        try:
            text = await transcribe(pcm, language)
        except Exception as exc:
            logger.exception("[ASR] failed: %s", exc)
            await ws.send_text(json.dumps({"type": "error", "message": "asr_failed"}))
            return

        if not text or len(text) < 2:
            logger.info("[PROCESS] skipping — empty or near-empty transcript: %r", text)
            return

        await ws.send_text(json.dumps({"type": "transcript", "text": text}))
        await log_call_message(session_id, text, is_assistant=False)
        history.append({"role": "user", "content": text})

        try:
            if _is_openai_compat(LLM_ENDPOINT):
                async for delta in stream_llm_tokens(history):
                    sentence_buf += delta
                    full_parts.append(delta)
                    sentences, sentence_buf = split_sentences(sentence_buf)
                    for sent in sentences:
                        await speak(ws, sent, language, voice=voice, session_id=session_id)
            else:
                full_reply = await call_llm(history)
                if full_reply:
                    full_parts.append(full_reply)
                    sentences, sentence_buf = split_sentences(full_reply + " ")
                    for sent in sentences:
                        await speak(ws, sent, language, voice=voice, session_id=session_id)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("[LLM] failed: %s", exc)
            await ws.send_text(json.dumps({"type": "error", "message": "llm_failed"}))
            return

        if sentence_buf.strip():
            await speak(ws, sentence_buf.strip(), language, voice=voice, session_id=session_id)

        full_reply = "".join(full_parts).strip()
        if not full_reply:
            logger.info("[PROCESS] LLM returned empty reply")
            return

        history.append({"role": "assistant", "content": full_reply})
        logger.info("[PROCESS] complete, history now has %d turns", len(history))
    except asyncio.CancelledError:
        partial = "".join(full_parts).strip()
        if partial:
            history.append({"role": "assistant", "content": partial + " [interrupted]"})
        logger.info("[BARGE-IN] processing cancelled mid-flight; partial reply len=%d",
                    len(partial))
        raise
    except Exception as exc:
        logger.exception("[PROCESS] failed: %s", exc)


@app.websocket("/v1/voice/stream")
async def voice_stream(ws: WebSocket) -> None:
    await ws.accept()
    peer = ws.client.host if ws.client else "?"
    logger.info("voice WS open from %s", peer)

    try:
        first = await asyncio.wait_for(ws.receive_text(), timeout=10)
    except (asyncio.TimeoutError, WebSocketDisconnect):
        await ws.close(code=1002, reason="no start message")
        return

    try:
        cfg = json.loads(first)
    except json.JSONDecodeError:
        await ws.close(code=1002, reason="invalid start")
        return
    if cfg.get("type") != "start":
        await ws.close(code=1002, reason="expected start")
        return

    language = (cfg.get("language") or "en").lower()
    if language not in GREETINGS:
        language = "en"

    # gender = "female" | "male"; passed through to TTS as the `voice` field.
    gender = (cfg.get("gender") or "").strip().lower()
    if gender not in {"female", "male"}:
        gender = ""
    voice = gender or None

    # Verify the short-lived voice token minted by the backend. We require it
    # when JWT_SECRET is configured — otherwise we run unauthenticated (dev).
    voice_token = cfg.get("voiceToken") or cfg.get("voice_token") or ""
    user_id: Optional[str] = None
    if JWT_SECRET:
        user_id = verify_voice_token(voice_token)
        if not user_id:
            await ws.send_text(json.dumps({"type": "error", "message": "auth_failed"}))
            await ws.close(code=4401, reason="invalid voice token")
            return
    else:
        logger.warning("[AUTH] JWT_SECRET not set — accepting WS without verification")

    session_id: Optional[str] = None
    if user_id:
        session_id = await create_call_session(user_id, language, gender or "female")
        logger.info("[SESSION] arango session_id=%s user=%s", session_id, user_id)

    logger.info("[SESSION] open lang=%s gender=%s peer=%s session=%s user=%s "
                "vad_aggr=%d silence_frames=%d min_utt=%d",
                language, gender or "(default)", peer, session_id, user_id,
                VAD_AGGRESSIVENESS, SILENCE_FRAMES_TO_END, MIN_UTTERANCE_FRAMES)

    history = [{"role": "system", "content": SYSTEM_PROMPTS[language]}]
    greeting = GREETINGS[language]
    history.append({"role": "assistant", "content": greeting})
    logger.info("[GREETING] sending greeting")
    await speak(ws, greeting, language, voice=voice, session_id=session_id)
    await ws.send_text(json.dumps({"type": "ready"}))
    logger.info("[GREETING] done; ready signal sent, listening for mic")

    vad = webrtcvad.Vad(VAD_AGGRESSIVENESS)
    pending = bytearray()             # leftover bytes that don't form a full frame yet
    utterance = bytearray()           # current utterance buffer
    speech_frames = 0
    silence_frames = 0
    in_speech = False
    drain_until = 0.0                 # epoch time before which we drop audio
    total_frames_received = 0
    last_audio_log = 0.0
    # Background processing task, so a barge-in message can cancel it without
    # blocking the WS receive loop.
    processing_task: Optional[asyncio.Task] = None

    def is_processing() -> bool:
        return processing_task is not None and not processing_task.done()

    async def kickoff_processing(pcm: bytes) -> None:
        nonlocal processing_task, drain_until

        async def _runner() -> None:
            nonlocal drain_until
            try:
                await process_utterance(ws, pcm, language, history, voice=voice,
                                        session_id=session_id)
            except asyncio.CancelledError:
                pass
            finally:
                drain_until = asyncio.get_event_loop().time() + POST_PROCESS_DRAIN_S
                logger.info("[SESSION] processing complete; drain window %.2fs to discard echo",
                            POST_PROCESS_DRAIN_S)

        processing_task = asyncio.create_task(_runner())

    async def maybe_process_now() -> None:
        nonlocal utterance, speech_frames, silence_frames, in_speech
        if speech_frames < MIN_UTTERANCE_FRAMES:
            logger.info("[VAD] utterance too short (%d frames < min %d), discarding",
                        speech_frames, MIN_UTTERANCE_FRAMES)
            utterance.clear()
            speech_frames = 0
            silence_frames = 0
            in_speech = False
            return
        pcm = bytes(utterance)
        logger.info("[VAD] utterance complete: %d speech frames, %d bytes total (%.2fs)",
                    speech_frames, len(pcm), len(pcm) / (SAMPLE_RATE * 2))
        utterance.clear()
        speech_frames = 0
        silence_frames = 0
        in_speech = False
        await kickoff_processing(pcm)

    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                logger.info("[SESSION] client disconnected")
                break

            if "text" in msg and msg["text"]:
                try:
                    parsed = json.loads(msg["text"])
                except json.JSONDecodeError:
                    continue
                msg_type = parsed.get("type")
                if msg_type == "stop":
                    logger.info("[SESSION] client requested stop")
                    break
                if msg_type == "barge_in":
                    logger.info("[BARGE-IN] received from client")
                    if is_processing():
                        processing_task.cancel()
                    # User is starting to talk — clear any half-built utterance
                    # and shorten the drain window so we listen quickly.
                    pending.clear()
                    utterance.clear()
                    speech_frames = 0
                    silence_frames = 0
                    in_speech = False
                    drain_until = asyncio.get_event_loop().time() + 0.2
                    try:
                        await ws.send_text(json.dumps({"type": "agent_interrupted"}))
                    except Exception:
                        pass
                    continue
                continue

            data = msg.get("bytes")
            if not data:
                continue

            total_frames_received += 1
            now = asyncio.get_event_loop().time()
            if now - last_audio_log > 5:
                logger.info("[MIC] received %d audio messages so far (this one %d bytes), processing=%s in_speech=%s",
                            total_frames_received, len(data), is_processing(), in_speech)
                last_audio_log = now

            # Drop audio while we're processing (we're not listening) AND for a
            # short window after, to discard whatever queued up in the WS read
            # buffer while we were busy talking to ASR/LLM/TTS.
            if is_processing() or now < drain_until:
                pending.clear()
                if in_speech or speech_frames or silence_frames:
                    utterance.clear()
                    speech_frames = 0
                    silence_frames = 0
                    in_speech = False
                continue

            pending.extend(data)
            while len(pending) >= FRAME_BYTES:
                frame = bytes(pending[:FRAME_BYTES])
                del pending[:FRAME_BYTES]

                try:
                    is_speech = vad.is_speech(frame, SAMPLE_RATE)
                except Exception:
                    continue

                if is_speech:
                    utterance.extend(frame)
                    speech_frames += 1
                    silence_frames = 0
                    if not in_speech and speech_frames >= SPEECH_FRAMES_TO_START:
                        in_speech = True
                        logger.info("[VAD] speech detected (start)")
                        try:
                            await ws.send_text(json.dumps({"type": "user_speaking"}))
                        except Exception:
                            pass
                else:
                    if in_speech:
                        utterance.extend(frame)
                        silence_frames += 1
                        if silence_frames >= SILENCE_FRAMES_TO_END:
                            await maybe_process_now()
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.exception("voice WS loop error: %s", exc)
    finally:
        if processing_task is not None and not processing_task.done():
            processing_task.cancel()
            try:
                await processing_task
            except Exception:
                pass
        await end_call_session(session_id)
        logger.info("voice WS closed (peer=%s session=%s)", peer, session_id)


if __name__ == "__main__":
    import uvicorn
    # Bump WS keepalive so a slow chatqna response doesn't kill the socket.
    uvicorn.run(
        app,
        host=HOST,
        port=PORT,
        log_level="info",
        ws_ping_interval=30,
        ws_ping_timeout=120,
    )
