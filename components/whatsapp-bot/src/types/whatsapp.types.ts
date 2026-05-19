/** Incoming webhook payload from Meta WhatsApp Cloud API */
export interface WebhookPayload {
  object: "whatsapp_business_account";
  entry: WebhookEntry[];
}

export interface WebhookEntry {
  id: string;
  changes: WebhookChange[];
}

export interface WebhookChange {
  value: WebhookValue;
  field: "messages";
}

export interface WebhookValue {
  messaging_product: "whatsapp";
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: WebhookContact[];
  messages?: IncomingMessage[];
  statuses?: MessageStatus[];
  errors?: WebhookError[];
}

export interface WebhookContact {
  profile: { name: string };
  wa_id: string;
}

export interface IncomingMessage {
  from: string;
  id: string;
  timestamp: string;
  type: MessageType;
  text?: { body: string };
  audio?: MediaInfo;
  image?: MediaInfo;
  document?: MediaInfo;
  interactive?: InteractiveReply;
  location?: LocationMessage;
  reaction?: ReactionMessage;
  sticker?: MediaInfo;
  contacts?: unknown[];
  button?: { payload: string; text: string };
}

export type MessageType =
  | "text"
  | "audio"
  | "image"
  | "document"
  | "interactive"
  | "location"
  | "reaction"
  | "sticker"
  | "contacts"
  | "button";

export interface MediaInfo {
  id: string;
  mime_type: string;
  sha256?: string;
  caption?: string;
}

export interface InteractiveReply {
  type: "button_reply" | "list_reply";
  button_reply?: { id: string; title: string };
  list_reply?: { id: string; title: string; description?: string };
}

export interface LocationMessage {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface ReactionMessage {
  message_id: string;
  emoji: string;
}

export interface MessageStatus {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  recipient_id: string;
  errors?: WebhookError[];
}

export interface WebhookError {
  code: number;
  title: string;
  message: string;
  error_data?: { details: string };
}

/** Outgoing message types */

export interface SendTextMessage {
  messaging_product: "whatsapp";
  to: string;
  type: "text";
  text: { body: string; preview_url?: boolean };
}

export interface SendInteractiveButtons {
  messaging_product: "whatsapp";
  to: string;
  type: "interactive";
  interactive: {
    type: "button";
    body: { text: string };
    action: {
      buttons: Array<{
        type: "reply";
        reply: { id: string; title: string };
      }>;
    };
  };
}

export interface SendInteractiveList {
  messaging_product: "whatsapp";
  to: string;
  type: "interactive";
  interactive: {
    type: "list";
    body: { text: string };
    action: {
      button: string;
      sections: Array<{
        title: string;
        rows: Array<{
          id: string;
          title: string;
          description?: string;
        }>;
      }>;
    };
  };
}

export interface SendTemplateMessage {
  messaging_product: "whatsapp";
  to: string;
  type: "template";
  template: {
    name: string;
    language: { code: string };
    components?: TemplateComponent[];
  };
}

export interface TemplateComponent {
  type: "body" | "button" | "header";
  parameters?: Array<{
    type: "text" | "image" | "document" | "video";
    text?: string;
  }>;
  sub_type?: "quick_reply";
  index?: number;
}

export interface SendAudioMessage {
  messaging_product: "whatsapp";
  to: string;
  type: "audio";
  audio: { id: string } | { link: string };
}

export interface SendMessageResponse {
  messaging_product: "whatsapp";
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

export type OutgoingMessage =
  | SendTextMessage
  | SendInteractiveButtons
  | SendInteractiveList
  | SendTemplateMessage
  | SendAudioMessage;
