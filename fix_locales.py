#!/usr/bin/env python3
"""Replace Kenya-specific quickhelp prompts with MEWA/Bangladesh content in all locale files."""

import os
import re

LOCALES_DIR = '/root/mewa_v2/components/gov-chat-frontend/src/i18n/locales'

MEWA_WELCOME = "Welcome! I\\'m MEWA, your agricultural early warning assistant for Bangladesh. How can I help you today?"

# Hidden LLM prompts (must be English - same across all locales)
PROMPT_REPLACEMENTS = {
    'applyForIDPrompt': "You are MEWA, an agricultural early warning assistant for Bangladesh. The user is asking about weather forecasts. Help them understand the current and upcoming weather conditions for their district and how it may affect their farming activities. If they mention a district name, focus on that area.",
    'payTaxesPrompt': "You are MEWA, an agricultural early warning assistant for Bangladesh. The user is asking about extreme weather or flood alerts. Provide clear, actionable information about severe weather events such as floods, cyclones, heavy rainfall, or storms. Advise on protective actions for crops and personal safety.",
    'startBusinessPrompt': "You are MEWA, an agricultural early warning assistant for Bangladesh. The user is asking about crop management advice. Provide practical guidance on crop selection, planting schedules, fertilization, irrigation, and pest management based on the current season and regional weather patterns in Bangladesh.",
    'findHealthcarePrompt': "You are MEWA, an agricultural early warning assistant for Bangladesh. The user is asking about crop alert thresholds. Explain the specific meteorological and soil conditions that trigger warnings for major Bangladesh crops such as rice, wheat, jute, and vegetables. Describe what protective actions farmers should take when thresholds are exceeded.",
    'educationServicesPrompt': "You are MEWA, an agricultural early warning assistant for Bangladesh. The user is asking about geospatial risk profiles. Explain flood-prone zones, cyclone-risk corridors, drought-susceptible areas, and how geographic location affects agricultural risk in Bangladesh districts.",
    'transportLicensesPrompt': "You are MEWA, an agricultural early warning assistant for Bangladesh. The user is asking for general agricultural reference information. Provide factual, practical information about Bangladesh agriculture, including crop calendars, common pests and diseases, soil types, and best practices for smallholder farmers.",
    'housingProgramsPrompt': "You are MEWA, an agricultural early warning assistant for Bangladesh. Help the user with any agriculture, weather, or early warning question they have. Be friendly, practical, and focused on information relevant to Bangladesh farmers and rural communities.",
    'findJobsPrompt': "You are MEWA, an agricultural early warning assistant for Bangladesh. Help the user with any agriculture, weather, or early warning question they have. Be friendly, practical, and focused on information relevant to Bangladesh farmers and rural communities.",
    'justChatPrompt': "You are MEWA, an agricultural early warning assistant for Bangladesh. Be friendly, helpful, and knowledgeable about Bangladesh agriculture, weather patterns, crop management, pest risks, and early warning systems. Your primary strength is helping farmers and citizens understand weather conditions and their impact on agricultural activities. Always refer to the application as 'MEWA'.",
}

# User-visible prompts (what the user sees posted to chat when clicking quick-help)
USER_PROMPT_REPLACEMENTS = {
    'justChatUserPrompt': "I\\'d like to ask about agriculture and weather in Bangladesh",
    'applyForIDUserPrompt': "What is the weather forecast for my district?",
    'payTaxesUserPrompt': "Are there any extreme weather or flood alerts I should know about?",
    'startBusinessUserPrompt': "What crops should I focus on this season and how do I manage them?",
    'findHealthcareUserPrompt': "What are the crop alert thresholds I need to watch for?",
    'educationServicesUserPrompt': "What is the flood or drought risk profile for my area?",
    'transportLicensesUserPrompt': "Where can I find general agricultural reference information?",
    'housingProgramsUserPrompt': "Tell me about agriculture support programs in Bangladesh",
    'findJobsUserPrompt': "What agricultural support and resources are available?",
}

# Keywords that indicate Kenya-specific content that needs replacing
KENYA_MARKERS = [
    'kenyan', 'kenya', 'kra ', 'kra)', 'ecitizen', 'ntsa', 'huduma', 'genie ai',
    'maisha namba', 'nhif', 'shif', 'kuccps', 'knec', 'tims', 'smart dl',
    'itax', 'kes ', 'swahili', 'kiswahili', 'kényan', 'keniyan', 'kenia',
    'local companion', 'government services like', 'ids, taxes',
    'services du gouvernement', 'servicios del gobierno', 'serviços do governo',
    'bürgerservices', 'kenpyan', 'keenia',
]


def has_kenya_content(text):
    lower = text.lower()
    return any(marker in lower for marker in KENYA_MARKERS)


def process_file(filepath, filename):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    original = content
    lines = content.split('\n')
    new_lines = []
    changed_keys = []

    for line in lines:
        replaced = False

        # Check hidden LLM prompts
        for key, new_value in PROMPT_REPLACEMENTS.items():
            if f'{key}:' in line and has_kenya_content(line):
                indent = len(line) - len(line.lstrip())
                trailing = ',' if line.rstrip().endswith(',') else ''
                new_lines.append(' ' * indent + f'{key}: "{new_value}"{trailing}')
                changed_keys.append(key)
                replaced = True
                break

        if not replaced:
            # Check user prompts
            for key, new_value in USER_PROMPT_REPLACEMENTS.items():
                if f'{key}:' in line and has_kenya_content(line):
                    indent = len(line) - len(line.lstrip())
                    trailing = ',' if line.rstrip().endswith(',') else ''
                    new_lines.append(' ' * indent + f'{key}: "{new_value}"{trailing}')
                    changed_keys.append(key)
                    replaced = True
                    break

        if not replaced:
            # Check welcome message
            if 'welcomeMessage:' in line and has_kenya_content(line):
                indent = len(line) - len(line.lstrip())
                trailing = ',' if line.rstrip().endswith(',') else ''
                new_lines.append(' ' * indent + f"welcomeMessage: '{MEWA_WELCOME}'{trailing}")
                changed_keys.append('welcomeMessage')
                replaced = True

        if not replaced:
            new_lines.append(line)

    new_content = '\n'.join(new_lines)
    if new_content != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"  Updated {filename}: {', '.join(changed_keys)}")
        return True
    else:
        print(f"  No changes: {filename}")
        return False


def main():
    print(f"Processing locale files in {LOCALES_DIR}\n")
    updated = 0
    for filename in sorted(os.listdir(LOCALES_DIR)):
        if not filename.endswith('.js'):
            continue
        filepath = os.path.join(LOCALES_DIR, filename)
        if process_file(filepath, filename):
            updated += 1

    print(f"\nDone. {updated} file(s) updated.")


if __name__ == '__main__':
    main()
