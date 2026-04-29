import redis
import json
import hashlib
import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import List, Dict, Optional, Any
from datetime import datetime
import logging
import uuid

from src.config import settings
from src.models.memory import Memory, ConsultationRecord, PatientProfile, MemoryType
from src.utils.arcade_client import async_command_sql, extract_rows

logger = logging.getLogger(__name__)

# Thread pool for CPU-bound work (embeddings)
_executor = ThreadPoolExecutor(max_workers=2)


class MemoryManager:
    """
    Three-tier memory system for Amina:
      Tier 1 - Working Memory (Redis): current session state, TTL 24h
      Tier 2 - Episodic Memory (ArcadeDB): consultations linked to patients
      Tier 3 - Semantic Memory (ArcadeDB + vectors): facts, patterns, similarity search

    Performance notes:
      - All ArcadeDB calls use async httpx (non-blocking)
      - Embeddings run in a thread pool to avoid blocking the event loop
      - Summary/fact extraction designed to run as background tasks
    """

    def __init__(self):
        self._redis = redis.ConnectionPool(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            db=0,
            decode_responses=True,
            max_connections=20,
        )
        self.session_ttl = 86400  # 24 hours

        # Thread-safe embedder with lock
        self._embedder = None
        self._embedder_lock = threading.Lock()

    @property
    def redis(self):
        return redis.Redis(connection_pool=self._redis)


    # TIER 1: WORKING MEMORY (Redis)


    def _session_key(self, session_id: str) -> str:
        return f"session:{session_id}"

    def _patient_session_key(self, patient_id: str) -> str:
        return f"patient:{patient_id}:active_session"

    def _care_plan_key(self, session_id: str) -> str:
        return f"careplan:{session_id}"

    async def save_care_plan(self, session_id: str, plan: Dict) -> bool:
        """Cache a generated care plan. TTL = 7 days."""
        try:
            self.redis.setex(
                self._care_plan_key(session_id),
                7 * 86400,
                json.dumps(plan, default=str),
            )
            return True
        except Exception as e:
            logger.error(f"Failed to cache care plan: {e}")
            return False

    async def get_care_plan(self, session_id: str) -> Optional[Dict]:
        try:
            raw = self.redis.get(self._care_plan_key(session_id))
            if raw:
                return json.loads(raw)
        except Exception as e:
            logger.error(f"Failed to load care plan: {e}")
        return None

    async def save_session(self, session_id: str, data: Dict) -> bool:
        try:
            key = self._session_key(session_id)
            self.redis.setex(key, self.session_ttl, json.dumps(data, default=str))
            return True
        except Exception as e:
            logger.error(f"Failed to save session to Redis: {e}")
            return False

    async def get_session(self, session_id: str) -> Optional[Dict]:
        try:
            key = self._session_key(session_id)
            data = self.redis.get(key)
            return json.loads(data) if data else None
        except Exception as e:
            logger.error(f"Failed to get session from Redis: {e}")
            return None

    async def get_session_messages(self, session_id: str) -> List[Dict]:
        """Return the stored message history for a session (up to 20 messages)."""
        session = await self.get_session(session_id)
        if not session:
            return []
        return session.get("messages", [])


    # PATIENT RELATIONSHIP STATS (for trust-tier greetings)


    def _patient_stats_key(self, session_id: str) -> str:
        return f"stats:{session_id}"

    async def get_patient_stats(self, session_id: str) -> Dict[str, Any]:
        """Return persistent interaction counters for trust-tier greetings.

        Defaults are safe for new users. TTL: 365 days.
        """
        try:
            raw = self.redis.get(self._patient_stats_key(session_id))
            if raw:
                return json.loads(raw)
        except Exception as e:
            logger.warning(f"Failed to load patient stats: {e}")
        return {
            "interaction_count": 0,
            "first_call_at": None,
            "last_call_at": None,
        }

    # VITALS TRENDS (deterministic callbacks — safe, no LLM)


    def _vitals_key(self, session_id: str, vital_type: str) -> str:
        return f"vitals:{session_id}:{vital_type}"


    # RITUAL PHASE (cross-worker persistence)


    def _ritual_key(self, session_id: str) -> str:
        return f"ritual:{session_id}"

    async def get_ritual_phase(self, session_id: str) -> int:
        """Return current ritual phase (-1 if not started)."""
        try:
            raw = self.redis.get(self._ritual_key(session_id))
            return int(raw) if raw is not None else -1
        except Exception:
            return -1

    async def set_ritual_phase(self, session_id: str, phase: int) -> None:
        """Persist ritual phase so it survives across uvicorn workers."""
        try:
            # 24h TTL — ritual should complete within minutes, 24h is a safe cap
            self.redis.setex(self._ritual_key(session_id), 86400, str(phase))
        except Exception as e:
            logger.warning(f"Failed to persist ritual phase: {e}")

    async def get_ethnic_language(self, session_id: str) -> str:
        """Return stored ethnic language for the session, or 'english' if none."""
        try:
            raw = self.redis.get(f"ethnic:{session_id}")
            return raw if raw else "english"
        except Exception:
            return "english"

    async def set_ethnic_language(self, session_id: str, lang: str) -> None:
        """Persist detected ethnic language (24h TTL)."""
        try:
            self.redis.setex(f"ethnic:{session_id}", 86400, lang)
        except Exception:
            pass

    async def record_vital_reading(
        self, session_id: str, vital_type: str, value: str,
    ) -> bool:
        """Append a reading to the session's trend log. Redis list, capped at 20 entries.

        vital_type: 'bp' | 'glucose' | 'weight'
        """
        try:
            key = self._vitals_key(session_id, vital_type)
            entry = json.dumps({
                "value": value,
                "at": datetime.now().isoformat(),
            })
            self.redis.lpush(key, entry)
            self.redis.ltrim(key, 0, 19)  # keep last 20
            self.redis.expire(key, 180 * 86400)  # 6 months
            return True
        except Exception as e:
            logger.warning(f"Failed to record vital: {e}")
            return False

    async def get_vital_readings_raw(
        self, session_id: str, vital_type: str,
    ) -> List[Dict[str, Any]]:
        """Return all stored readings for the session (newest first).
        Used by journey callbacks that need to compare to the OLDEST reading."""
        try:
            key = self._vitals_key(session_id, vital_type)
            raw_list = self.redis.lrange(key, 0, -1) or []
            return [json.loads(r) for r in raw_list]
        except Exception as e:
            logger.warning(f"Failed to fetch vital readings: {e}")
            return []

    async def get_vital_trend(
        self, session_id: str, vital_type: str,
    ) -> Dict[str, Any]:
        """Return current vs. previous reading + delta (no LLM, fully deterministic).

        Returns:
          {
            "current": "145/90", "previous": "160/100",
            "count": 7,
            "delta_systolic": -15, "delta_diastolic": -10,   # for BP
            "delta": -25,                                     # for glucose
            "trend": "improving" | "worsening" | "stable" | "unknown",
            "first_at": "2025-12-01T...", "last_at": "2026-04-06T..."
          }
        """
        try:
            key = self._vitals_key(session_id, vital_type)
            raw_list = self.redis.lrange(key, 0, -1) or []
            readings = [json.loads(r) for r in raw_list]
            if not readings:
                return {"count": 0, "trend": "unknown"}
            current = readings[0]
            previous = readings[1] if len(readings) > 1 else None
            oldest = readings[-1]

            out = {
                "count": len(readings),
                "current": current["value"],
                "last_at": current["at"],
                "first_at": oldest["at"],
            }
            if previous:
                out["previous"] = previous["value"]
                out.update(self._compute_delta(vital_type, current["value"], previous["value"]))
                # Also compute delta vs oldest (the full journey)
                journey = self._compute_delta(vital_type, current["value"], oldest["value"])
                out["journey_delta"] = journey
            else:
                out["trend"] = "unknown"
            return out
        except Exception as e:
            logger.warning(f"Failed to compute vital trend: {e}")
            return {"count": 0, "trend": "unknown"}

    def _compute_delta(
        self, vital_type: str, current: str, previous: str,
    ) -> Dict[str, Any]:
        """Parse two readings and compute a typed delta. Never throws."""
        try:
            if vital_type == "bp":
                cs, cd = [int(x) for x in current.replace(" ", "").split("/")]
                ps, pd = [int(x) for x in previous.replace(" ", "").split("/")]
                ds, dd = cs - ps, cd - pd
                # Improving = both going down; worsening = both up
                if ds <= -3 and dd <= -3:
                    trend = "improving"
                elif ds >= 5 or dd >= 5:
                    trend = "worsening"
                else:
                    trend = "stable"
                return {"delta_systolic": ds, "delta_diastolic": dd, "trend": trend}
            if vital_type == "glucose":
                c = float(current.replace(" ", "").replace("mg/dL", "").replace("mg/dl", ""))
                p = float(previous.replace(" ", "").replace("mg/dL", "").replace("mg/dl", ""))
                d = c - p
                if d <= -10:
                    trend = "improving"
                elif d >= 15:
                    trend = "worsening"
                else:
                    trend = "stable"
                return {"delta": round(d, 1), "trend": trend}
            if vital_type == "weight":
                c = float(current.replace(" ", "").replace("kg", ""))
                p = float(previous.replace(" ", "").replace("kg", ""))
                d = c - p
                trend = "stable"
                return {"delta": round(d, 2), "trend": trend}
        except Exception:
            pass
        return {"trend": "unknown"}

    async def touch_patient_stats(self, session_id: str) -> Dict[str, Any]:
        """Increment interaction count + update last-call timestamp.
        Returns the computed trust-tier inputs in days.
        """
        stats = await self.get_patient_stats(session_id)
        now_iso = datetime.now().isoformat()

        if stats.get("first_call_at") is None:
            stats["first_call_at"] = now_iso
        last_call = stats.get("last_call_at")
        stats["last_call_at"] = now_iso
        stats["interaction_count"] = int(stats.get("interaction_count", 0)) + 1

        # Compute day deltas
        try:
            first = datetime.fromisoformat(stats["first_call_at"])
            days_since_first = max(0, (datetime.now() - first).days)
        except Exception:
            days_since_first = 0
        try:
            if last_call:
                last = datetime.fromisoformat(last_call)
                days_since_last = max(0, (datetime.now() - last).days)
            else:
                days_since_last = 0
        except Exception:
            days_since_last = 0

        # Persist (365 day TTL)
        try:
            self.redis.setex(
                self._patient_stats_key(session_id),
                365 * 86400,
                json.dumps(stats, default=str),
            )
        except Exception as e:
            logger.warning(f"Failed to save patient stats: {e}")

        return {
            "interaction_count": stats["interaction_count"],
            "days_since_first_call": days_since_first,
            "days_since_last_call": days_since_last,
        }

    async def add_message_to_session(
        self,
        session_id: str,
        role: str,
        content: str,
        tools_used: List[str] = None,
    ):
        session = await self.get_session(session_id) or {
            "messages": [],
            "started_at": datetime.now().isoformat(),
        }

        session["messages"].append({
            "role": role,
            "content": content,
            "tools_used": tools_used or [],
            "timestamp": datetime.now().isoformat(),
        })

        if len(session["messages"]) > 20:
            session["messages"] = session["messages"][-20:]

        await self.save_session(session_id, session)

    async def link_patient_to_session(self, patient_id: str, session_id: str):
        try:
            self.redis.setex(
                self._patient_session_key(patient_id),
                self.session_ttl,
                session_id,
            )
        except Exception as e:
            logger.error(f"Failed to link patient to session: {e}")

    async def get_active_session_for_patient(self, patient_id: str) -> Optional[str]:
        try:
            return self.redis.get(self._patient_session_key(patient_id))
        except Exception:
            return None


    # TIER 2: EPISODIC MEMORY (ArcadeDB — consultations)
    # All DB calls use async_command_sql (non-blocking httpx)


    async def save_consultation(self, consultation: ConsultationRecord) -> str:
        try:
            resp = await async_command_sql(
                "INSERT INTO ConsultationRecord SET "
                "id = :id, patient_id = :pid, session_id = :sid, "
                "started_at = :started, ended_at = :ended, "
                "messages = :messages, symptoms_reported = :symptoms, "
                "triage_level = :triage, tools_used = :tools, "
                "recommendations = :recs, followup_scheduled = :followup, "
                "summary = :summary",
                [
                    consultation.id,
                    consultation.patient_id,
                    consultation.session_id,
                    consultation.started_at.isoformat(),
                    consultation.ended_at.isoformat() if consultation.ended_at else "",
                    json.dumps(consultation.messages),
                    json.dumps(consultation.symptoms_reported),
                    consultation.triage_level or "",
                    json.dumps(consultation.tools_used),
                    json.dumps(consultation.recommendations),
                    consultation.followup_scheduled or "",
                    consultation.summary or "",
                ],
            )

            # Link to patient via edge (non-critical)
            try:
                await async_command_sql(
                    "CREATE EDGE HasConsultation FROM "
                    "(SELECT FROM PatientVertex WHERE id = :pid) TO "
                    "(SELECT FROM ConsultationRecord WHERE id = :cid)",
                    [consultation.patient_id, consultation.id],
                )
            except Exception as e:
                logger.debug(f"Edge creation warning: {e}")

            # Update patient consultation counter
            try:
                await async_command_sql(
                    "UPDATE PatientVertex SET "
                    "last_consultation = :now, "
                    "consultation_count = consultation_count + 1 "
                    "WHERE id = :pid",
                    [datetime.now().isoformat(), consultation.patient_id],
                )
            except Exception as e:
                logger.debug(f"Patient counter update warning: {e}")

            return consultation.id

        except Exception as e:
            logger.error(f"Failed to save consultation: {e}")
            raise

    async def get_patient_consultations(
        self, patient_id: str, limit: int = 10
    ) -> List[Dict]:
        try:
            resp = await async_command_sql(
                "SELECT * FROM ConsultationRecord "
                "WHERE patient_id = :pid "
                "ORDER BY started_at DESC LIMIT :limit",
                [patient_id, limit],
            )
            rows = extract_rows(resp)
            for row in rows:
                for field in ("messages", "symptoms_reported", "tools_used", "recommendations"):
                    val = row.get(field, "[]")
                    if isinstance(val, str):
                        row[field] = json.loads(val)
            return rows
        except Exception as e:
            logger.error(f"Failed to get consultations for {patient_id}: {e}")
            return []

    # ================================================================
    # TIER 3: SEMANTIC MEMORY (ArcadeDB + vector embeddings)
    # ================================================================

    async def save_memory(self, memory: Memory) -> str:
        if not memory.embedding:
            memory.embedding = await self._generate_embedding(memory.content)

        try:
            await async_command_sql(
                "INSERT INTO MemoryVertex SET "
                "id = :id, patient_id = :pid, type = :type, "
                "content = :content, metadata = :meta, "
                "embedding = :embedding, importance = :importance, "
                "created_at = :created",
                [
                    memory.id,
                    memory.patient_id,
                    memory.type.value,
                    memory.content,
                    json.dumps(memory.metadata),
                    memory.embedding,
                    memory.importance,
                    memory.created_at.isoformat(),
                ],
            )

            try:
                await async_command_sql(
                    "CREATE EDGE HasMemory FROM "
                    "(SELECT FROM PatientVertex WHERE id = :pid) TO "
                    "(SELECT FROM MemoryVertex WHERE id = :mid)",
                    [memory.patient_id, memory.id],
                )
            except Exception:
                pass

            return memory.id
        except Exception as e:
            logger.error(f"Failed to save memory: {e}")
            raise

    async def search_memories(
        self,
        patient_id: str,
        query: str,
        limit: int = 5,
    ) -> List[Memory]:
        try:
            query_embedding = await self._generate_embedding(query)

            try:
                resp = await async_command_sql(
                    "SELECT *, vectorDistance(embedding, :qemb, 'cosine') as score "
                    "FROM MemoryVertex "
                    "WHERE patient_id = :pid "
                    "ORDER BY score ASC LIMIT :limit",
                    [query_embedding, patient_id, limit],
                )
                rows = extract_rows(resp)
            except Exception:
                # Fallback to recency/importance if vector search unavailable
                resp = await async_command_sql(
                    "SELECT * FROM MemoryVertex "
                    "WHERE patient_id = :pid "
                    "ORDER BY importance DESC, created_at DESC LIMIT :limit",
                    [patient_id, limit],
                )
                rows = extract_rows(resp)

            memories = []
            for row in rows:
                meta = row.get("metadata", "{}")
                if isinstance(meta, str):
                    meta = json.loads(meta)
                memories.append(Memory(
                    id=row.get("id", ""),
                    patient_id=row.get("patient_id", ""),
                    type=MemoryType(row.get("type", "fact")),
                    content=row.get("content", ""),
                    metadata=meta,
                    importance=row.get("importance", 0.5),
                ))
            return memories

        except Exception as e:
            logger.error(f"Failed to search memories: {e}")
            return []

    async def extract_and_save_facts(
        self,
        patient_id: str,
        consultation: ConsultationRecord,
    ):
        """Extract key facts from a consultation and persist them with embeddings.
        Designed to be called as a fire-and-forget background task."""
        facts = await self._extract_facts(consultation)

        for fact in facts:
            memory = Memory(
                id=f"mem_{patient_id}_{uuid.uuid4().hex[:8]}",
                patient_id=patient_id,
                type=MemoryType.FACT,
                content=fact["content"],
                metadata=fact.get("metadata", {}),
                importance=fact.get("importance", 0.5),
            )
            try:
                await self.save_memory(memory)
            except Exception as e:
                logger.warning(f"Failed to save extracted fact: {e}")

    async def generate_and_save_summary(self, consultation: ConsultationRecord):
        """Generate consultation summary and update the record.
        Designed to be called as a fire-and-forget background task."""
        summary = await self._generate_summary(consultation)
        if summary:
            try:
                await async_command_sql(
                    "UPDATE ConsultationRecord SET summary = :summary WHERE id = :cid",
                    [summary, consultation.id],
                )
            except Exception as e:
                logger.warning(f"Failed to update consultation summary: {e}")


    # PATIENT PROFILE

    async def get_or_create_patient(self, phone: str) -> PatientProfile:
        try:
            resp = await async_command_sql(
                "SELECT * FROM PatientVertex WHERE phone = :phone LIMIT 1",
                [phone],
            )
            rows = extract_rows(resp)

            if rows:
                row = rows[0]
                for field in ("conditions", "medications", "allergies", "bp_readings",
                              "glucose_readings", "key_facts"):
                    val = row.get(field, "[]")
                    if isinstance(val, str):
                        row[field] = json.loads(val)
                return PatientProfile(**{
                    k: v for k, v in row.items()
                    if k in PatientProfile.model_fields
                })

            patient_id = f"P{hashlib.md5(phone.encode()).hexdigest()[:8].upper()}"
            patient = PatientProfile(id=patient_id, phone=phone)

            await async_command_sql(
                "INSERT INTO PatientVertex SET "
                "id = :id, phone = :phone, region = :region, "
                "conditions = :conditions, medications = :medications, "
                "allergies = :allergies, key_facts = :facts, "
                "bp_readings = :bp, glucose_readings = :glucose, "
                "consultation_count = 0, preferred_language = :lang, "
                "created_at = :created, updated_at = :updated",
                [
                    patient.id, patient.phone, patient.region,
                    "[]", "[]", "[]", "[]", "[]", "[]",
                    patient.preferred_language,
                    datetime.now().isoformat(),
                    datetime.now().isoformat(),
                ],
            )
            return patient

        except Exception as e:
            logger.error(f"Failed to get/create patient: {e}")
            raise

    async def update_patient(self, patient_id: str, updates: Dict) -> bool:
        try:
            set_parts = []
            params = []
            for key, value in updates.items():
                set_parts.append(f"{key} = ?")
                params.append(json.dumps(value) if isinstance(value, (list, dict)) else value)
            set_parts.append("updated_at = ?")
            params.append(datetime.now().isoformat())
            params.append(patient_id)

            await async_command_sql(
                f"UPDATE PatientVertex SET {', '.join(set_parts)} WHERE id = ?",
                params,
            )
            return True
        except Exception as e:
            logger.error(f"Failed to update patient: {e}")
            return False


    # CONTEXT BUILDING (combines all 3 tiers)

    async def build_context_for_query(
        self,
        patient_id: str,
        query: str,
    ) -> str:
        context_parts = []

        # Patient profile (Tier 3)
        try:
            resp = await async_command_sql(
                "SELECT * FROM PatientVertex WHERE id = :pid LIMIT 1",
                [patient_id],
            )
            rows = extract_rows(resp)
            if rows:
                p = rows[0]
                name = p.get("name", "Unknown")
                age = p.get("age", "?")
                gender = p.get("gender", "?")
                context_parts.append(f"PATIENT: {name}, {age}y {gender}")

                conditions = p.get("conditions", "[]")
                if isinstance(conditions, str):
                    conditions = json.loads(conditions)
                if conditions:
                    context_parts.append(f"CONDITIONS: {', '.join(conditions)}")

                medications = p.get("medications", "[]")
                if isinstance(medications, str):
                    medications = json.loads(medications)
                if medications:
                    meds = [m.get("name", str(m)) if isinstance(m, dict) else str(m) for m in medications]
                    context_parts.append(f"MEDICATIONS: {', '.join(meds)}")

                key_facts = p.get("key_facts", "[]")
                if isinstance(key_facts, str):
                    key_facts = json.loads(key_facts)
                if key_facts:
                    context_parts.append(f"KEY FACTS: {'; '.join(key_facts[:5])}")
        except Exception as e:
            logger.warning(f"Failed to load patient profile for context: {e}")

        # Relevant memories via vector search (Tier 3)
        relevant = await self.search_memories(patient_id, query, limit=3)
        if relevant:
            context_parts.append("RELEVANT HISTORY:")
            for mem in relevant:
                context_parts.append(f"  - {mem.content}")

        # Recent consultation summaries (Tier 2)
        consultations = await self.get_patient_consultations(patient_id, limit=3)
        if consultations:
            context_parts.append("RECENT VISITS:")
            for c in consultations:
                summary = c.get("summary", "")
                date = c.get("started_at", "")[:10]
                if summary:
                    context_parts.append(f"  - [{date}] {summary}")

        return "\n".join(context_parts)


    # PRIVATE HELPERS


    async def _generate_summary(self, consultation: ConsultationRecord) -> str:
        try:
            import google.generativeai as genai

            messages_text = "\n".join([
                f"{m.get('role', 'user')}: {m.get('content', '')}"
                for m in consultation.messages[-10:]
            ])

            prompt = (
                "Summarize this healthcare consultation in 1-2 sentences. "
                "Focus on: main complaint, diagnosis/triage, and key recommendation.\n\n"
                f"Consultation:\n{messages_text}\n\nSummary:"
            )

            model = genai.GenerativeModel(settings.LLM_MODEL_NAME)
            response = await asyncio.to_thread(model.generate_content, prompt)
            return response.text.strip()
        except Exception as e:
            logger.warning(f"Summary generation failed: {e}")
            return ""

    async def _extract_facts(self, consultation: ConsultationRecord) -> List[Dict]:
        try:
            import google.generativeai as genai
            import re

            messages_text = "\n".join([
                f"{m.get('role', 'user')}: {m.get('content', '')}"
                for m in consultation.messages[-10:]
            ])

            prompt = (
                "Extract key medical facts from this consultation that should be "
                "remembered for future visits. Return as JSON array of objects with "
                '"content" and "importance" (0-1) fields. Only include facts that '
                "would be useful to remember (symptoms, conditions, preferences, "
                "allergies, etc.)\n\n"
                f"Consultation:\n{messages_text}\n\nFacts (JSON array):"
            )

            model = genai.GenerativeModel(settings.LLM_MODEL_NAME)
            response = await asyncio.to_thread(model.generate_content, prompt)

            json_match = re.search(r'\[[\s\S]*\]', response.text)
            if json_match:
                return json.loads(json_match.group())
            return []
        except Exception as e:
            logger.warning(f"Fact extraction failed: {e}")
            return []

    async def _generate_embedding(self, text: str) -> List[float]:
        """Generate embedding in a thread pool — safe for concurrent access."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(_executor, self._generate_embedding_sync, text)

    def _generate_embedding_sync(self, text: str) -> List[float]:
        """Thread-safe synchronous embedding generation."""
        try:
            with self._embedder_lock:
                if self._embedder is None:
                    from haystack.components.embedders import SentenceTransformersTextEmbedder
                    from haystack.utils import ComponentDevice
                    self._embedder = SentenceTransformersTextEmbedder(
                        model=settings.EMBEDDING_MODEL,
                        device=ComponentDevice.from_str("cpu"),
                    )
                    self._embedder.warm_up()

            # Lock during inference too — SentenceTransformers is not thread-safe
            with self._embedder_lock:
                result = self._embedder.run(text)
                return result["embedding"]
        except Exception as e:
            logger.warning(f"Embedding generation failed: {e}")
            return [0.0] * 384


# Singleton
_memory_manager = None


def get_memory_manager() -> MemoryManager:
    global _memory_manager
    if _memory_manager is None:
        _memory_manager = MemoryManager()
    return _memory_manager
