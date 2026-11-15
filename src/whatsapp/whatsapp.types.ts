/** Sous-ensemble utile du payload webhook de la WhatsApp Cloud API. */
export interface WebhookPayload {
  object: string;
  entry?: Array<{
    id: string;
    changes?: Array<{ field: string; value: WebhookValue }>;
  }>;
}

export interface WebhookValue {
  messaging_product: 'whatsapp';
  metadata?: { phone_number_id: string; display_phone_number?: string };
  contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
  messages?: InboundMessage[];
  statuses?: MessageStatus[];
}

export interface InboundMessage {
  id: string; // wamid
  from: string; // wa_id
  timestamp: string; // secondes epoch
  type: string; // text | image | audio | video | document | sticker | ...
  text?: { body: string };
  image?: { id: string; mime_type: string; sha256?: string; caption?: string };
}

export interface MessageStatus {
  id: string; // wamid du message sortant
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  errors?: Array<{ code: number; title: string }>;
}

/** Job placé dans la file d'entrée : un message ou un statut. */
export type InboundJob =
  | { kind: 'message'; message: InboundMessage; profileName?: string }
  | { kind: 'status'; status: MessageStatus };
