// WhatsApp is not connected on this deployment, so the UI must not present it
// as a working channel. Gate every WhatsApp element on this flag, including
// the Topic Module phone number, whose only channel is WhatsApp. Labels on
// existing WhatsApp sessions are deliberately left as they are. Set to true
// once the WhatsApp channel is live.
export const WHATSAPP_UI_ENABLED = false;
