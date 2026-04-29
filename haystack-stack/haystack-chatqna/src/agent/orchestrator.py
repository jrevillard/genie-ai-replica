from typing import Dict, Any, List, Optional
import logging
from src.tools.base import BaseTool
from src.tools.knowledge import KnowledgeTool
from src.tools.triage import TriageTool
from src.tools.referral import ReferralTool
from src.tools.medication import MedicationTool
from src.tools.diet import DietTool
from src.tools.emergency import EmergencyTool
from src.tools.patient import PatientTool, SaveConsultationTool
from src.tools.cultural import CulturalTool
from src.tools.followup import FollowupTool
from src.tools.vitals import VitalsTool
from src.tools.care_plan import CarePlanTool
from src.tools.ramadan import RamadanTool
from src.tools.cvd_risk import CVDRiskTool
from src.tools.who_diabetes import WHODiabetesTool
from src.tools.who_hypertension import WHOHypertensionTool
from src.tools.who_respiratory import WHORespiratoryTool
from src.tools.who_cancer_screening import WHOCancerScreeningTool
from src.tools.who_lifestyle import WHOLifestyleTool
from src.tools.prescription import PrescriptionTool
from src.tools.nudges import LifestyleNudgesTool
from src.tools.community_support import CommunitySupportTool

logger = logging.getLogger(__name__)


class ToolOrchestrator:
    def __init__(self):
        self.tools: Dict[str, BaseTool] = {}
        self._register_tools()

    def _register_tools(self):
        tools = [
            KnowledgeTool(),
            TriageTool(),
            ReferralTool(),
            MedicationTool(),
            DietTool(),
            EmergencyTool(),
            PatientTool(),
            SaveConsultationTool(),
            CulturalTool(),
            FollowupTool(),
            VitalsTool(),
            CarePlanTool(),
            RamadanTool(),
            CVDRiskTool(),
            WHODiabetesTool(),
            WHOHypertensionTool(),
            WHORespiratoryTool(),
            WHOCancerScreeningTool(),
            WHOLifestyleTool(),
            PrescriptionTool(),
            LifestyleNudgesTool(),
            CommunitySupportTool(),
        ]
        for tool in tools:
            self.tools[tool.name] = tool
            logger.info(f"Registered tool: {tool.name}")

    def get_tool(self, name: str) -> Optional[BaseTool]:
        return self.tools.get(name)

    def get_tool_descriptions(self) -> str:
        descriptions = []
        for name, tool in self.tools.items():
            params = ", ".join(tool.parameters) if tool.parameters else "none"
            descriptions.append(f"- {name}: {tool.description} (params: {params})")
        return "\n".join(descriptions)

    async def execute_tool(self, name: str, **kwargs) -> Dict[str, Any]:
        tool = self.get_tool(name)
        if not tool:
            return {"error": f"Tool '{name}' not found", "success": False}

        try:
            result = await tool.execute(**kwargs)
            return {"result": result, "success": True, "tool": name}
        except Exception as e:
            logger.error(f"Tool {name} execution failed: {e}")
            return {"error": str(e), "success": False, "tool": name}

    def list_tools(self) -> List[str]:
        return list(self.tools.keys())
