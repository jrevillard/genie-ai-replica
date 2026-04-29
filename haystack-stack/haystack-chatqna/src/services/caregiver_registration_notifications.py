"""
AMINA Care — Caregiver Registration Notification Service
==========================================================
SMS-first notifications for the caregiver approval pipeline.
Most caregivers in The Gambia use basic phones without data.
"""
from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)


def _sms(to: str, body: str) -> bool:
    try:
        from src.services.caregiver_alerts import _route_sms
        ok, _ = _route_sms(to, body)
        return ok
    except Exception as e:
        logger.warning("SMS failed to %s: %s", to, e)
        return False


ROLE_LABELS = {
    "vhw": "Village Health Worker",
    "cbc": "Community Birth Companion",
    "chn": "Community Health Nurse",
    "tba": "Traditional Birth Attendant",
    "family": "Family Caregiver",
    "scout": "Youth Health Scout",
    "alkalo": "Village Head",
}


def on_registration(phone: str, reg_id: str, role: str, timeout_days: int) -> bool:
    label = ROLE_LABELS.get(role, role)
    return _sms(phone, (
        f"Your AMINA registration (ID: {reg_id}) as {label} has been received. "
        f"We will review it within {timeout_days} days. "
        f"You will receive an SMS when approved."
    ))


def on_admin_approved(phone: str, name: str, next_step: str) -> bool:
    if next_step == "alkalo_confirmation":
        return _sms(phone, (
            f"{name}, your registration has been reviewed and approved by admin. "
            f"We are now waiting for your village Alkalo to confirm. "
            f"You will receive an SMS once confirmed."
        ))
    return _sms(phone, (
        f"{name}, your registration has been reviewed. "
        f"Next step: {next_step}. We will SMS you with updates."
    ))


def on_admin_rejected(phone: str, name: str, reason: str) -> bool:
    return _sms(phone, (
        f"{name}, your AMINA registration was not approved. "
        f"Reason: {reason}. "
        f"Please contact the health centre for help."
    ))


def on_more_info_needed(phone: str, name: str, details: str) -> bool:
    return _sms(phone, (
        f"{name}, we need additional information to complete your registration: "
        f"{details}. Please bring the required documents to the health centre "
        f"or call for assistance."
    ))


def on_activation(phone: str, name: str, role: str) -> bool:
    label = ROLE_LABELS.get(role, role)
    return _sms(phone, (
        f"Congratulations {name}! Your AMINA account is now active as {label}. "
        f"Login with your phone number and PIN to get started."
    ))


def on_suspension(phone: str, name: str, reason: str) -> bool:
    return _sms(phone, (
        f"{name}, your AMINA account has been temporarily suspended. "
        f"Reason: {reason}. Contact the health centre for more information."
    ))


def on_patient_link_request(
    patient_phone: str,
    patient_name: str,
    caregiver_name: str,
    relationship: str,
) -> bool:
    return _sms(patient_phone, (
        f"{caregiver_name} ({relationship}) wants to be your caregiver on AMINA. "
        f"They can see your health readings and care plan. "
        f"Reply 1 to approve, 2 to decline."
    ))


def on_patient_link_approved(caregiver_phone: str, patient_name: str) -> bool:
    return _sms(caregiver_phone, (
        f"Your patient {patient_name} has approved you as their caregiver. "
        f"You can now view their health information on AMINA."
    ))


def notify_supervising_chn(
    chn_phone: str,
    vhw_name: str,
    village: str,
) -> bool:
    return _sms(chn_phone, (
        f"{vhw_name} in {village} has been activated on AMINA. "
        f"They are now in your supervisory circuit."
    ))
