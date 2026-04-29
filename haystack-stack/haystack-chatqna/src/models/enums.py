from enum import Enum


class TriageLevel(str, Enum):
    SELF_CARE = "SELF_CARE"
    CHW_VISIT = "CHW_VISIT"
    FACILITY = "FACILITY"
    EMERGENCY = "EMERGENCY"


class Gender(str, Enum):
    MALE = "male"
    FEMALE = "female"
    OTHER = "other"


class Region(str, Enum):
    BANJUL = "Banjul"
    KANIFING = "Kanifing"
    WEST_COAST = "West Coast"
    NORTH_BANK = "North Bank"
    LOWER_RIVER = "Lower River"
    CENTRAL_RIVER = "Central River"
    UPPER_RIVER = "Upper River"


class NCDType(str, Enum):
    DIABETES = "diabetes"
    HYPERTENSION = "hypertension"
    HEART_DISEASE = "heart_disease"
    KIDNEY_DISEASE = "kidney_disease"
    RESPIRATORY = "respiratory"
    OTHER = "other"


class ConsultationStatus(str, Enum):
    ACTIVE = "active"
    COMPLETED = "completed"
    FOLLOW_UP = "follow_up"
    REFERRED = "referred"
    EMERGENCY = "emergency"
