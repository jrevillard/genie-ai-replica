"""
Community Support tool — Imam / Alkallo / CHW / Elder referral path.

When a patient shows reluctance to visit a clinic (permission barrier, stigma,
family dynamics, fear, cost), we bridge to the trusted local figure who can
legitimise the health decision.

This tool does NOT impose religious framing — it offers the patient an
appropriate local-trust channel only when they express hesitation.

For each barrier we return:
  - trusted_figure: who to involve
  - acknowledgement: validate the patient's feeling first
  - steps: numbered concrete steps (3-5)
  - scripts: what the patient can literally say
  - what_to_expect: what happens next so they aren't surprised
  - alternatives: a fallback if the first option isn't available
  - red_flags: when to skip this path and go straight to clinic
"""

from typing import Dict, Any, List, Optional
from src.tools.base import BaseTool


class CommunitySupportTool(BaseTool):
    name = "suggest_community_support"
    description = "Suggest a trusted community figure (Imam, Alkallo, elder, CHW) with detailed steps when the patient is hesitant to seek care"
    parameters = ["barrier_type", "religious_context"]

    SUPPORT_PATHS = {
        # ── PERMISSION BARRIER (women needing family approval) ─────────
        "permission": {
            "trusted_figure": "Alkallo (village head) or a respected elder the family already trusts",
            "acknowledgement": (
                "What you are feeling is real and common. In many Gambian families, "
                "health decisions are made together. That is not wrong — it is our culture. "
                "The goal is not to go around your family, but to bring a trusted voice "
                "to the same conversation."
            ),
            "steps": [
                "Identify one respected person your husband or family already listens to — this is usually the Alkallo, a senior aunt, or an elder from your compound.",
                "Speak with that person privately first. Explain calmly that you want to check your health so you can keep caring for the family.",
                "Ask them to speak to your husband (or the family decision-maker) on your behalf — not to pressure, but to reframe the visit as responsible care.",
                "Agree on a day that fits the family's routine. Avoid days of heavy work or travel so nobody feels rushed.",
                "Go with a family member if possible. Being accompanied is normal and often expected.",
            ],
            "scripts": [
                "To the Alkallo/elder: 'I want to stay strong for my family. I need to check my health. Could you speak with my husband so he understands this is responsible care, not illness?'",
                "For the elder to say to your husband: 'Going to the health centre is how our mothers and fathers stay strong. It is a normal check, not a sign of sickness. It is how she takes care of you and the children.'",
            ],
            "what_to_expect": (
                "Your husband may say yes straight away, or he may need a few days. That is "
                "normal. Do not argue — let the Alkallo's words work. In most cases, once a "
                "trusted voice reframes it, the answer changes within a week."
            ),
            "alternatives": [
                "If the Alkallo is not available, ask the imam's wife, a senior teacher, or the midwife everyone already trusts.",
                "A Community Health Worker (CHW) can also visit you at home privately, with no need for a clinic visit first.",
            ],
            "red_flags": (
                "If you have chest pain, trouble breathing, severe headache, vision changes, "
                "or any emergency sign — do NOT wait for permission. Call 199 or go to EFSTH "
                "immediately. Your life comes first."
            ),
        },

        # ── STIGMA BARRIER (shame about diagnosis) ─────────────────────
        "stigma": {
            "trusted_figure": "Community Health Worker (CHW) — trained for private, confidential visits",
            "acknowledgement": (
                "Feeling ashamed is one of the hardest parts of NCDs. You are not alone — "
                "many, many Gambians feel this exact way and never say it out loud. The "
                "condition is not your fault. It is not a punishment. It is something we can "
                "manage together, quietly, in a way that protects your privacy."
            ),
            "steps": [
                "Contact your local CHW — they visit homes every week and are trained to keep every conversation confidential.",
                "When you invite them, frame the visit in a neutral way the whole household can hear — 'a routine family wellness check.'",
                "Meet the CHW in a private space of your compound. You do not need to explain to neighbours.",
                "Ask the CHW directly: 'What do I need to know, and how do we keep this between us?' They will tell you their confidentiality rules.",
                "Build the habit slowly — one private visit per month is enough to stay on top of your health.",
            ],
            "scripts": [
                "To your household: 'The CHW is coming for a routine family wellness check this week.'",
                "To the CHW: 'I would like to talk privately. Please keep what we discuss between us.'",
                "If someone asks afterwards: 'It was a normal wellness check. I'm doing fine.'",
            ],
            "what_to_expect": (
                "The CHW will take your BP or sugar quietly, ask a few routine questions, and "
                "leave simple instructions. They will not broadcast anything. The conversation "
                "stays between you two. Over time, this becomes the easiest part of your week."
            ),
            "alternatives": [
                "If no CHW is nearby, the pharmacy nurse is also trained to be discreet — visit at a quiet hour.",
                "An anonymous conversation with Amina (this service) is another way to start without anyone knowing.",
            ],
            "red_flags": (
                "Shame should never keep you from emergency care. Chest pain, trouble breathing, "
                "very high sugar or BP — these need a facility now, not privacy."
            ),
        },

        # ── FEAR BARRIER (afraid of diagnosis, of clinic) ──────────────
        "fear": {
            "trusted_figure": "A CHW, a trusted elder, or a close friend who will accompany you",
            "acknowledgement": (
                "It is very normal to feel afraid of what we might hear at the health centre. "
                "This fear stops many people — and then the condition gets worse quietly. "
                "You are already brave for speaking about it. The next step is smaller than "
                "you think."
            ),
            "steps": [
                "Choose ONE person you trust — a CHW, a sister, an auntie, a close friend.",
                "Tell them honestly: 'I am afraid, and I would feel stronger if you came with me the first time.'",
                "Pick a specific day this week. Agree on a time. Write it down so it becomes real.",
                "Plan what you will do AFTER the visit — tea together, a walk, a quiet meal. Give yourself something to look forward to.",
                "On the day, go together. You do not have to do anything alone. They do not need to be in the room — just through the door with you.",
            ],
            "scripts": [
                "To your support person: 'I would feel stronger if you came with me to the health centre this week. You don't need to stay — just come with me through the door.'",
                "At the clinic, if you feel nervous: 'I am new here. Could you explain what you are going to do first?'",
                "To yourself, before you go: 'Whatever I find out, I can manage it. Knowing is better than not knowing.'",
            ],
            "what_to_expect": (
                "Most first visits are short — 20 to 40 minutes. They will measure your BP or sugar, "
                "ask routine questions, and give you a plan. Many patients say afterwards: 'I should "
                "have come sooner.' Whatever they tell you, it is something we can work on together."
            ),
            "alternatives": [
                "A CHW can come to YOU instead — no clinic visit needed the first time.",
                "Amina can walk you through what a first NCD visit looks like so you know exactly what happens.",
            ],
            "red_flags": (
                "Do not let fear delay emergency signs — chest pain, trouble breathing, fainting, "
                "sudden vision loss. Those need an ambulance (199) immediately, not a plan."
            ),
        },

        # ── COST BARRIER (money worries) ───────────────────────────────
        "cost": {
            "trusted_figure": "CHW (for free services info) or Alkallo (for community support)",
            "acknowledgement": (
                "Money worries are real and they stop many people from seeking care. The good "
                "news is that more is free than most people know. The CHW is your best source "
                "for what is actually free in YOUR area, not what is written on paper."
            ),
            "steps": [
                "Ask your CHW directly: 'What NCD services are free at my nearest health post?' Do not guess — ask.",
                "Find out which medications are covered or subsidised. Metformin, amlodipine, lisinopril are often free or very cheap at public facilities.",
                "Ask if your village has a health support group or community fund — the Alkallo usually knows.",
                "If transport is the problem, ask: 'When does the mobile clinic come nearest to us?' Mobile vans go further than people expect.",
                "Avoid private clinics for routine NCD care unless needed — public health centres are much cheaper for ongoing management.",
            ],
            "scripts": [
                "To the CHW: 'I want to manage my condition but I have money worries. What is actually free, and where?'",
                "To the Alkallo: 'Do you know of any community fund or support for people with diabetes/BP in our village?'",
                "At the health post: 'Which of these medicines are on the free list? Is there a cheaper alternative?'",
            ],
            "what_to_expect": (
                "You will probably discover that 50-70% of what you thought you'd pay for is "
                "already free or heavily subsidised. Medications like metformin and amlodipine "
                "are on the essential drug list. Ask by name."
            ),
            "alternatives": [
                "Group care visits (several patients together) sometimes cost less than individual.",
                "Some NGOs run free NCD screening days — the CHW will know the schedule.",
            ],
            "red_flags": (
                "Money worries should never delay emergency care. Emergency services at EFSTH "
                "will treat you regardless of payment. Call 199."
            ),
        },

        # ── RELIGIOUS (only when patient opts in first) ────────────────
        "religious": {
            "trusted_figure": "Your local Imam",
            "acknowledgement": (
                "Since you mentioned your faith, know that many Gambian Imams teach that "
                "caring for the body is itself a form of worship and responsibility. Seeking "
                "health is not against faith — it is part of it."
            ),
            "steps": [
                "Find a time after prayers when your Imam is available for a short private conversation.",
                "Explain briefly that you are considering health care and you would value his support.",
                "Ask specifically: 'Can you bless my decision to seek care, or share a teaching that supports this?'",
                "Take that blessing with you to the clinic — it changes how you feel walking through the door.",
                "If you want, share with your family that the Imam supports your decision. It can shift the household response.",
            ],
            "scripts": [
                "To your Imam: 'I am considering going to the health centre. Could you bless this decision and remind me of the teaching on caring for the body?'",
                "To your family: 'I spoke with the Imam. He supports that caring for the body is responsible, so I will go.'",
            ],
            "what_to_expect": (
                "Most Imams respond warmly to health questions — they encourage care because the "
                "community depends on healthy elders and parents. Expect kindness."
            ),
            "alternatives": [
                "If your Imam is not available, a respected senior teacher or religious scholar can offer the same support.",
            ],
            "red_flags": (
                "Emergencies need immediate medical care. Prayer and medical care work together — "
                "never wait for one before doing the other in an emergency."
            ),
        },
    }

    async def execute(
        self,
        barrier_type: str = "fear",
        religious_context: bool = False,
        **kwargs,
    ) -> Dict[str, Any]:
        """
        barrier_type: 'permission' | 'stigma' | 'fear' | 'cost' | 'religious'
        religious_context: True only if the user has mentioned religion first
        """
        key = (barrier_type or "fear").lower()
        # Guard: only offer the religious path if the user raised it
        if key == "religious" and not religious_context:
            key = "fear"
        if key not in self.SUPPORT_PATHS:
            key = "fear"

        path = self.SUPPORT_PATHS[key]

        return {
            "barrier": key,
            "trusted_figure": path["trusted_figure"],
            "acknowledgement": path["acknowledgement"],
            "steps": path["steps"],
            "scripts": path["scripts"],
            "what_to_expect": path["what_to_expect"],
            "alternatives": path["alternatives"],
            "red_flags": path["red_flags"],
            "principle": (
                "Health in The Gambia is communal. A trusted local voice can unlock care "
                "that a clinic alone cannot — but emergencies always go straight to the clinic."
            ),
        }
