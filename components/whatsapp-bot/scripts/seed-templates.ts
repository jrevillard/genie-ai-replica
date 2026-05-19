/**
 * Register WhatsApp message templates with Meta.
 *
 * Usage: npx tsx scripts/seed-templates.ts
 *
 * Requires:
 *   WHATSAPP_BUSINESS_ACCOUNT_ID (your WABA ID)
 *   WHATSAPP_ACCESS_TOKEN
 *
 * Templates must be approved by Meta before they can be used.
 * See PRD.md section 7 for the full template catalog.
 */

import { request } from "undici";

const WABA_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const API_VERSION = process.env.WHATSAPP_API_VERSION ?? "v21.0";

if (!WABA_ID || !ACCESS_TOKEN) {
  console.error("Set WHATSAPP_BUSINESS_ACCOUNT_ID and WHATSAPP_ACCESS_TOKEN env vars");
  process.exit(1);
}

interface TemplateDefinition {
  name: string;
  category: "UTILITY" | "MARKETING";
  language: string;
  components: Array<{
    type: "BODY" | "BUTTONS";
    text?: string;
    buttons?: Array<{ type: "QUICK_REPLY"; text: string }>;
    example?: { body_text: string[][] };
  }>;
}

const templates: TemplateDefinition[] = [
  {
    name: "welcome_back",
    category: "MARKETING",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hello! 👋 It's been a while since we last chatted.\n\nI'm here whenever you need health advice or support.\nJust send me a message!\n\nReply STOP to unsubscribe.",
      },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Check my health risk" },
          { type: "QUICK_REPLY", text: "Ask a question" },
        ],
      },
    ],
  },
  {
    name: "opt_out_confirmation",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "You have been unsubscribed from all messages from the Genie AI Health Assistant.\n\nTo re-subscribe, simply send any message to this number.",
      },
    ],
  },
  {
    name: "daily_health_tip",
    category: "MARKETING",
    language: "en",
    components: [
      {
        type: "BODY",
        text: '💡 *Daily Health Tip*\n\n{{1}}\n\nReply with any question, or type "craving" if you need support right now.\n\nReply STOP to unsubscribe.',
        example: { body_text: [["Drink a glass of water when you feel like smoking. It helps reduce the urge."]] },
      },
    ],
  },
  {
    name: "medication_reminder",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "⏰ *Medication Reminder*\n\nIt's time to take your {{1}}.\n\nDid you take it?",
        example: { body_text: [["blood pressure medication"]] },
      },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Yes, taken" },
          { type: "QUICK_REPLY", text: "Skipped" },
        ],
      },
    ],
  },
  {
    name: "weekly_checkin",
    category: "MARKETING",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "📊 *Weekly Check-In*\n\nHi! How has your week been?\n\nLast week's goal: {{1}}\n\nHow did it go?",
        example: { body_text: [["Reduce smoking by 2 cigarettes per day"]] },
      },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Achieved" },
          { type: "QUICK_REPLY", text: "Partially" },
          { type: "QUICK_REPLY", text: "Not this week" },
        ],
      },
    ],
  },
  {
    name: "vital_reminder",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: '📋 It\'s time for your {{1}} check.\n\nIf you have your reading, send it to me now (e.g., "BP 130/85" or "sugar 6.5").\n\nReply STOP to unsubscribe.',
        example: { body_text: [["blood pressure"]] },
      },
    ],
  },
  {
    name: "screening_campaign",
    category: "MARKETING",
    language: "en",
    components: [
      {
        type: "BODY",
        text: '🏥 *Health Screening Event*\n\n{{1}} on {{2}} at {{3}}.\n\nFree screening — no appointment needed!\n\nReply "info" for more details or "remind" to get a reminder on the day.\n\nReply STOP to unsubscribe.',
        example: { body_text: [["Blood Pressure Screening Day", "May 15", "Brikama Health Centre"]] },
      },
    ],
  },
  {
    name: "public_health_announcement",
    category: "MARKETING",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "📢 *Health Announcement*\n\n{{1}}\n\nFor more information, send us a message.\n\nReply STOP to unsubscribe.",
        example: { body_text: [["National Immunization Week starts Monday. Visit your nearest health centre."]] },
      },
    ],
  },
  {
    name: "reengagement",
    category: "MARKETING",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hi! We haven't heard from you in a while. 🌿\n\nThe Genie AI Health Assistant is still here to help with:\n• Health questions\n• Habit tracking\n• Medication reminders\n\nWould you like to continue?\n\nReply STOP to unsubscribe.",
      },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Yes, I'm back!" },
          { type: "QUICK_REPLY", text: "Unsubscribe" },
        ],
      },
    ],
  },
  {
    name: "risk_reassessment",
    category: "MARKETING",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "📋 It's been {{1}} since your last health check.\n\nWould you like to do a quick update? It takes about 3 minutes and helps me give you better advice.\n\nReply STOP to unsubscribe.",
        example: { body_text: [["3 months"]] },
      },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Yes, let's update" },
          { type: "QUICK_REPLY", text: "Not now" },
        ],
      },
    ],
  },
];

async function createTemplate(template: TemplateDefinition): Promise<void> {
  const url = `https://graph.facebook.com/${API_VERSION}/${WABA_ID}/message_templates`;

  const { statusCode, body } = await request(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(template),
  });

  const data = await body.json();

  if (statusCode >= 400) {
    console.error(`  FAILED: ${template.name}`, data);
  } else {
    console.log(`  OK: ${template.name}`, data);
  }
}

async function main() {
  console.log(`Registering ${templates.length} templates with Meta...\n`);

  for (const template of templates) {
    await createTemplate(template);
  }

  console.log("\nDone. Templates may take up to 24h for Meta to review and approve.");
}

main().catch(console.error);
