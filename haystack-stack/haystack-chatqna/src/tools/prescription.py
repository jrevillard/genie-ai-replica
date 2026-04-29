"""
Prescription analysis tool using OpenAI Vision.

Takes an uploaded prescription image (photo/scan), uses GPT-4o-mini's vision
capability to extract medications, dosages, and instructions, then flags
interactions, dosage concerns, and gives culturally-appropriate guidance
for the Gambian context.
"""

from typing import Dict, Any, Optional, List
import base64
import logging
import json
import re

from openai import AsyncOpenAI

from src.config import settings
from src.tools.base import BaseTool

logger = logging.getLogger(__name__)


PRESCRIPTION_EXTRACTION_PROMPT = """You are Amina, a Gambian healthcare assistant analyzing a prescription image.

The prescription may be written in ENGLISH, MANDINKA, or a mix of both.
Medication names are usually in English/Latin regardless of the surrounding language.
Doctor's notes, diagnosis, and instructions may be in Mandinka.

Read the prescription image carefully and extract structured information.

Return ONLY valid JSON in this exact format:
{
  "is_prescription": true,
  "detected_language": "en" | "ma" | "mixed",
  "doctor_name": "...",
  "clinic_name": "...",
  "date": "...",
  "patient_name": "...",
  "medications": [
    {
      "name": "medication name (English/Latin if possible)",
      "dosage": "e.g. 500mg",
      "frequency": "e.g. twice daily",
      "duration": "e.g. 7 days",
      "instructions": "e.g. after meals",
      "original_text": "what was actually written on the prescription, verbatim"
    }
  ],
  "diagnosis": "if written (translated to English if originally in Mandinka)",
  "diagnosis_original": "original Mandinka diagnosis if applicable",
  "notes": "other doctor notes (translated to English)",
  "notes_original": "original text if in Mandinka",
  "readable": true,
  "concerns": []
}

If the image is NOT a prescription, return: {"is_prescription": false, "readable": true, "reason": "..."}
If the image is too blurry/unreadable, return: {"is_prescription": false, "readable": false, "reason": "..."}

For "concerns", flag anything like:
- Handwriting unclear for drug name/dosage
- Dosage outside typical range
- Potentially conflicting medications
- Missing duration or frequency

Return ONLY the JSON, no markdown, no prose.
"""


PRESCRIPTION_GUIDANCE_PROMPT = """You are Amina, a warm Gambian healthcare assistant.

A patient uploaded a prescription. Here is what was extracted:
{extraction}

Patient context (if known):
- Conditions: {conditions}
- Current medications: {current_meds}
- Allergies: {allergies}

The prescription was written in: {detected_language}
The patient's preferred response language: {output_language}

Give the patient clear, friendly guidance in {output_language_name} in simple language:
1. Summary of what was prescribed (in plain words)
2. How to take each medicine (time of day, with/without food)
3. Any warnings based on their conditions or other medications
4. Common side effects to watch for
5. When to contact a health worker (CHW or health post)

Keep it conversational and culturally warm. Use Gambian context (CHW, health post, EFSTH, 199).
If any medication name is unclear from the prescription, tell them to double-check with the pharmacist.
Do NOT invent dosages — only use what was extracted.
Keep response under 300 words.

{bilingual_instruction}
"""


class PrescriptionTool(BaseTool):
    name = "analyze_prescription"
    description = "Analyze an uploaded prescription image (extract medications, dosages, instructions) and provide guidance"
    parameters = ["image_base64", "patient_context"]

    def __init__(self):
        self.client = AsyncOpenAI(
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.OPENAI_BASE_URL,
        )
        self.model_name = settings.OPENAI_MODEL

    async def execute(
        self,
        image_base64: str = "",
        image_url: Optional[str] = None,
        mime_type: str = "image/jpeg",
        patient_context: Optional[Dict[str, Any]] = None,
        output_language: str = "en",  # "en" (default) | "ma"
        **kwargs,
    ) -> Dict[str, Any]:
        if not image_base64 and not image_url:
            return {"error": "No image provided for prescription analysis"}

        # Build the image URL (data URL for base64, or direct URL)
        if image_base64:
            # Strip data URL prefix if present
            if image_base64.startswith("data:"):
                img_payload = image_base64
            else:
                img_payload = f"data:{mime_type};base64,{image_base64}"
        else:
            img_payload = image_url

        # Step 1: Extract structured data from the prescription image
        try:
            extraction_resp = await self.client.chat.completions.create(
                model=self.model_name,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": PRESCRIPTION_EXTRACTION_PROMPT},
                            {"type": "image_url", "image_url": {"url": img_payload}},
                        ],
                    },
                ],
                temperature=0.1,
                max_tokens=800,
            )
            extraction_text = extraction_resp.choices[0].message.content or "{}"
        except Exception as e:
            logger.error(f"Prescription extraction failed: {e}")
            return {
                "error": f"Could not analyze image: {e}",
                "is_prescription": False,
                "readable": False,
            }

        # Parse the JSON (strip any markdown fences)
        extraction_text = extraction_text.strip()
        if extraction_text.startswith("```"):
            extraction_text = re.sub(r"^```(?:json)?\s*", "", extraction_text)
            extraction_text = re.sub(r"```\s*$", "", extraction_text)

        try:
            extraction = json.loads(extraction_text)
        except json.JSONDecodeError:
            # Try to find JSON object in the text
            match = re.search(r"\{[\s\S]*\}", extraction_text)
            if match:
                try:
                    extraction = json.loads(match.group())
                except json.JSONDecodeError:
                    extraction = {
                        "is_prescription": False,
                        "readable": False,
                        "reason": "Could not parse extraction output",
                        "raw": extraction_text[:500],
                    }
            else:
                extraction = {
                    "is_prescription": False,
                    "readable": False,
                    "reason": "No structured output returned",
                    "raw": extraction_text[:500],
                }

        # If it's not a prescription or unreadable, return early
        if not extraction.get("is_prescription"):
            return {
                "is_prescription": False,
                "readable": extraction.get("readable", False),
                "reason": extraction.get("reason", "Image does not appear to be a prescription"),
            }

        # Step 2: Generate patient-friendly guidance
        ctx = patient_context or {}
        conditions = ", ".join(ctx.get("conditions", [])) or "none recorded"
        current_meds_raw = ctx.get("medications", [])
        if current_meds_raw and isinstance(current_meds_raw[0], dict):
            current_meds = ", ".join(m.get("name", "") for m in current_meds_raw)
        else:
            current_meds = ", ".join(current_meds_raw) if current_meds_raw else "none recorded"
        allergies = ", ".join(ctx.get("allergies", [])) or "none recorded"

        # Language handling — guidance is always in ONE language (output_language)
        lang_names = {"en": "English", "ma": "Mandinka"}
        detected_lang = extraction.get("detected_language", "en")
        output_lang_name = lang_names.get(output_language, "English")

        guidance_prompt = PRESCRIPTION_GUIDANCE_PROMPT.format(
            extraction=json.dumps(extraction, indent=2),
            conditions=conditions,
            current_meds=current_meds,
            allergies=allergies,
            detected_language=detected_lang,
            output_language=output_language,
            output_language_name=output_lang_name,
            bilingual_instruction="",  # no longer used
        )

        try:
            guidance_resp = await self.client.chat.completions.create(
                model=self.model_name,
                messages=[{"role": "user", "content": guidance_prompt}],
                temperature=0.7,
                max_tokens=600,
            )
            guidance = guidance_resp.choices[0].message.content or ""
        except Exception as e:
            logger.warning(f"Guidance generation failed: {e}")
            guidance = "I could read your prescription but couldn't generate full guidance. Please ask your pharmacist to walk you through each medicine."

        # Build medication summary list for quick frontend display
        medications = extraction.get("medications", [])
        med_summary = [
            f"{m.get('name', '?')} — {m.get('dosage', '')} {m.get('frequency', '')}".strip()
            for m in medications
        ]

        return {
            "is_prescription": True,
            "readable": extraction.get("readable", True),
            "detected_language": detected_lang,
            "extraction": extraction,
            "medications": medications,
            "medication_summary": med_summary,
            "doctor_name": extraction.get("doctor_name", ""),
            "clinic_name": extraction.get("clinic_name", ""),
            "date": extraction.get("date", ""),
            "diagnosis": extraction.get("diagnosis", ""),
            "diagnosis_original": extraction.get("diagnosis_original", ""),
            "concerns": extraction.get("concerns", []),
            "guidance": guidance,
        }
