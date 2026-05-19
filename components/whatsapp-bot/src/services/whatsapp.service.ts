import { request } from "undici";
import { getConfig } from "../config.js";
import type {
  OutgoingMessage,
  SendMessageResponse,
  SendTextMessage,
  SendInteractiveButtons,
  SendInteractiveList,
  SendTemplateMessage,
  SendAudioMessage,
  TemplateComponent,
} from "../types/whatsapp.types.js";
import { logger } from "../logger.js";

function apiUrl(path: string): string {
  const cfg = getConfig();
  return `https://graph.facebook.com/${cfg.WHATSAPP_API_VERSION}/${cfg.WHATSAPP_PHONE_NUMBER_ID}${path}`;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${getConfig().WHATSAPP_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function sendMessage(body: OutgoingMessage): Promise<SendMessageResponse> {
  const url = apiUrl("/messages");
  const { statusCode, body: resBody } = await request(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  const data = (await resBody.json()) as SendMessageResponse;
  if (statusCode >= 400) {
    logger.error({ statusCode, data, to: "to" in body ? body.to : "unknown" }, "WhatsApp API error");
    throw new Error(`WhatsApp API error: ${statusCode}`);
  }
  return data;
}

export async function sendText(to: string, text: string): Promise<SendMessageResponse> {
  const msg: SendTextMessage = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };
  return sendMessage(msg);
}

export async function sendButtons(
  to: string,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>,
): Promise<SendMessageResponse> {
  const msg: SendInteractiveButtons = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: "reply" as const,
          reply: { id: b.id, title: b.title.slice(0, 20) },
        })),
      },
    },
  };
  return sendMessage(msg);
}

export async function sendList(
  to: string,
  bodyText: string,
  buttonLabel: string,
  sections: Array<{
    title: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>,
): Promise<SendMessageResponse> {
  const msg: SendInteractiveList = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: bodyText },
      action: { button: buttonLabel.slice(0, 20), sections },
    },
  };
  return sendMessage(msg);
}

export async function sendTemplate(
  to: string,
  templateName: string,
  languageCode: string,
  components?: TemplateComponent[],
): Promise<SendMessageResponse> {
  const msg: SendTemplateMessage = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      components,
    },
  };
  return sendMessage(msg);
}

export async function sendAudio(
  to: string,
  mediaId: string,
): Promise<SendMessageResponse> {
  const msg: SendAudioMessage = {
    messaging_product: "whatsapp",
    to,
    type: "audio",
    audio: { id: mediaId },
  };
  return sendMessage(msg);
}

export async function markAsRead(messageId: string): Promise<void> {
  const url = apiUrl("/messages");
  await request(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    }),
  });
}

export async function downloadMedia(mediaId: string): Promise<Buffer> {
  const cfg = getConfig();
  // Step 1: get media URL
  const metaUrl = `https://graph.facebook.com/${cfg.WHATSAPP_API_VERSION}/${mediaId}`;
  const { body: metaBody } = await request(metaUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${cfg.WHATSAPP_ACCESS_TOKEN}` },
  });
  const metaData = (await metaBody.json()) as { url: string };

  // Step 2: download from CDN
  const { body: mediaBody } = await request(metaData.url, {
    method: "GET",
    headers: { Authorization: `Bearer ${cfg.WHATSAPP_ACCESS_TOKEN}` },
  });
  const chunks: Uint8Array[] = [];
  for await (const chunk of mediaBody) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function uploadMedia(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<string> {
  const cfg = getConfig();
  const url = `https://graph.facebook.com/${cfg.WHATSAPP_API_VERSION}/${cfg.WHATSAPP_PHONE_NUMBER_ID}/media`;

  const boundary = `----formdata-${Date.now()}`;
  const bodyParts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="messaging_product"\r\n\r\nwhatsapp\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\n${mimeType}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
  ];
  const prefix = Buffer.from(bodyParts.join(""));
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  const fullBody = Buffer.concat([prefix, buffer, suffix]);

  const { body: resBody } = await request(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: fullBody,
  });
  const data = (await resBody.json()) as { id: string };
  return data.id;
}
