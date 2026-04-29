from dataclasses import dataclass, field
from typing import List, Dict, Optional
from datetime import datetime
from src.models.enums import NCDType


@dataclass
class CarePlanItem:
    category: str  # "medication", "diet", "exercise", "monitoring", "followup"
    description: str
    frequency: Optional[str] = None
    notes: Optional[str] = None


@dataclass
class CarePlan:
    plan_id: str
    patient_id: str
    condition: NCDType
    items: List[CarePlanItem] = field(default_factory=list)
    goals: List[str] = field(default_factory=list)
    created_by: str = "amina"
    reviewed_by: Optional[str] = None
    active: bool = True
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)

    def add_item(self, category: str, description: str, frequency: str = None):
        self.items.append(CarePlanItem(
            category=category,
            description=description,
            frequency=frequency,
        ))
        self.updated_at = datetime.now()

    def to_dict(self) -> Dict:
        return {
            "plan_id": self.plan_id,
            "patient_id": self.patient_id,
            "condition": self.condition.value,
            "items": [
                {
                    "category": item.category,
                    "description": item.description,
                    "frequency": item.frequency,
                    "notes": item.notes,
                }
                for item in self.items
            ],
            "goals": self.goals,
            "created_by": self.created_by,
            "reviewed_by": self.reviewed_by,
            "active": self.active,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "CarePlan":
        items = [
            CarePlanItem(
                category=i["category"],
                description=i["description"],
                frequency=i.get("frequency"),
                notes=i.get("notes"),
            )
            for i in data.get("items", [])
        ]
        return cls(
            plan_id=data["plan_id"],
            patient_id=data["patient_id"],
            condition=NCDType(data["condition"]),
            items=items,
            goals=data.get("goals", []),
            created_by=data.get("created_by", "amina"),
            reviewed_by=data.get("reviewed_by"),
            active=data.get("active", True),
        )
