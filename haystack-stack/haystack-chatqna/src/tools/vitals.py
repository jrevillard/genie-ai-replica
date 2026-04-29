from typing import Dict, Any, Optional, List
from src.tools.base import BaseTool
from src.utils.arcade_client import async_command_sql, extract_rows
from datetime import datetime
import json
import logging

logger = logging.getLogger(__name__)


class VitalsTool(BaseTool):
    name = "record_vitals"
    description = "Record patient vital signs (blood pressure, blood glucose, weight) and check against safe ranges"
    parameters = ["patient_id", "vital_type", "value"]

    # Safe ranges for NCD patients
    SAFE_RANGES = {
        "blood_pressure": {
            "systolic": {"low": 90, "normal_low": 120, "normal_high": 140, "high": 180},
            "diastolic": {"low": 60, "normal_low": 80, "normal_high": 90, "high": 120},
            "unit": "mmHg",
        },
        "blood_glucose": {
            "fasting": {"low": 50, "normal_low": 70, "normal_high": 130, "high": 250, "critical": 400},
            "post_meal": {"low": 50, "normal_low": 70, "normal_high": 180, "high": 250, "critical": 400},
            "unit": "mg/dL",
        },
        "weight": {
            "unit": "kg",
        },
    }

    async def execute(
        self,
        patient_id: str = None,
        vital_type: str = "blood_pressure",
        value: str = "",
        **kwargs,
    ) -> Dict[str, Any]:
        if not patient_id:
            return {"error": "Patient ID required to record vitals"}

        result = {
            "patient_id": patient_id,
            "vital_type": vital_type,
            "value": value,
            "recorded_at": datetime.now().isoformat(),
            "status": "normal",
            "alerts": [],
        }

        # Parse and assess blood pressure
        if vital_type == "blood_pressure":
            result.update(self._assess_bp(value))

        # Parse and assess blood glucose
        elif vital_type == "blood_glucose":
            result.update(self._assess_glucose(value, kwargs.get("fasting", True)))

        # Weight — just record
        elif vital_type == "weight":
            result["unit"] = "kg"

        # Persist to ArcadeDB
        try:
            field = "last_bp" if vital_type == "blood_pressure" else "last_glucose"
            if vital_type in ("blood_pressure", "blood_glucose"):
                # Update the patient's latest reading
                await async_command_sql(
                    f"UPDATE PatientVertex SET {field} = :val, updated_at = :now WHERE id = :pid",
                    [value, datetime.now().isoformat(), patient_id],
                )

                # Append to readings history
                history_field = "bp_readings" if vital_type == "blood_pressure" else "glucose_readings"
                reading = json.dumps({"value": value, "date": datetime.now().isoformat()})
                try:
                    await async_command_sql(
                        f"UPDATE PatientVertex SET {history_field} = {history_field} || :reading WHERE id = :pid",
                        [reading, patient_id],
                    )
                except Exception:
                    pass  # Append may not work on all ArcadeDB versions

            result["saved"] = True
        except Exception as e:
            logger.warning(f"Failed to persist vital: {e}")
            result["saved"] = False

        return result

    def _assess_bp(self, value: str) -> Dict[str, Any]:
        """Parse BP like '140/90' and assess."""
        try:
            parts = value.replace(" ", "").split("/")
            systolic = int(parts[0])
            diastolic = int(parts[1]) if len(parts) > 1 else 0
        except (ValueError, IndexError):
            return {"status": "unknown", "alerts": ["Could not parse blood pressure value"]}

        alerts = []
        status = "normal"
        ranges = self.SAFE_RANGES["blood_pressure"]

        # Systolic assessment
        if systolic >= ranges["systolic"]["high"]:
            status = "critical"
            alerts.append(f"CRITICAL: Systolic BP {systolic} is dangerously high (>180). Seek emergency care NOW.")
        elif systolic >= ranges["systolic"]["normal_high"]:
            status = "high"
            alerts.append(f"HIGH: Systolic BP {systolic} is above normal (>140). Visit health center within 24 hours.")
        elif systolic < ranges["systolic"]["low"]:
            status = "low"
            alerts.append(f"LOW: Systolic BP {systolic} is below normal (<90). Rest and drink water.")

        # Diastolic assessment
        if diastolic >= ranges["diastolic"]["high"]:
            status = "critical"
            alerts.append(f"CRITICAL: Diastolic BP {diastolic} is dangerously high (>120). Seek emergency care NOW.")
        elif diastolic >= ranges["diastolic"]["normal_high"]:
            if status != "critical":
                status = "high"
            alerts.append(f"HIGH: Diastolic BP {diastolic} is above normal (>90).")

        if not alerts:
            alerts.append(f"Blood pressure {value} is within normal range. Keep it up!")

        return {
            "systolic": systolic,
            "diastolic": diastolic,
            "unit": "mmHg",
            "status": status,
            "alerts": alerts,
        }

    def _assess_glucose(self, value: str, fasting: bool = True) -> Dict[str, Any]:
        """Parse glucose value and assess."""
        try:
            glucose = float(value.replace(" ", "").replace("mg/dL", "").replace("mg/dl", ""))
        except ValueError:
            return {"status": "unknown", "alerts": ["Could not parse blood glucose value"]}

        alerts = []
        status = "normal"
        range_key = "fasting" if fasting else "post_meal"
        ranges = self.SAFE_RANGES["blood_glucose"][range_key]

        if glucose >= ranges.get("critical", 999):
            status = "critical"
            alerts.append(f"CRITICAL: Blood sugar {glucose} mg/dL is dangerously high (>400). GO TO HOSPITAL NOW.")
        elif glucose >= ranges["high"]:
            status = "high"
            alerts.append(f"HIGH: Blood sugar {glucose} mg/dL is high (>250). Contact your health provider today.")
        elif glucose >= ranges["normal_high"]:
            status = "elevated"
            alerts.append(f"ELEVATED: Blood sugar {glucose} mg/dL is above target. Review diet and medication.")
        elif glucose < ranges["low"]:
            status = "critical"
            alerts.append(f"CRITICAL: Blood sugar {glucose} mg/dL is dangerously LOW (<50). Eat sugar immediately!")
        elif glucose < ranges["normal_low"]:
            status = "low"
            alerts.append(f"LOW: Blood sugar {glucose} mg/dL. Eat something with sugar and monitor.")
        else:
            alerts.append(f"Blood sugar {glucose} mg/dL is within target range. Good job!")

        return {
            "glucose": glucose,
            "unit": "mg/dL",
            "fasting": fasting,
            "status": status,
            "alerts": alerts,
        }
