import { Injectable, Logger } from '@nestjs/common';
import { maskPhone } from '../common/redact';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';

export interface DownloadedMedia {
  data: Buffer;
  mimeType: string;
}

/** Appels sortants vers l'API Graph (envoi de messages, médias). */
@Injectable()
export class WhatsappClient {
  private readonly logger = new Logger(WhatsappClient.name);

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  private get base(): string {
    return `https://graph.facebook.com/${this.config.get('GRAPH_API_VERSION')}`;
  }

  private get authHeader(): Record<string, string> {
    return { Authorization: `Bearer ${this.config.get('WHATSAPP_TOKEN')}` };
  }

  /** Message libre : uniquement dans la fenêtre de 24 h. */
  async sendText(to: string, body: string, sellerId?: bigint): Promise<void> {
    await this.send(
      to,
      { type: 'text', text: { body, preview_url: false } },
      { kind: 'text', sellerId },
    );
  }

  /** Modèle préapprouvé : obligatoire hors fenêtre de 24 h. */
  async sendTemplate(
    to: string,
    name: string,
    params: string[] = [],
    sellerId?: bigint,
    language = 'fr',
  ): Promise<void> {
    await this.send(
      to,
      {
        type: 'template',
        template: {
          name,
          language: { code: language },
          components: params.length
            ? [
                {
                  type: 'body',
                  parameters: params.map((text) => ({ type: 'text', text })),
                },
              ]
            : undefined,
        },
      },
      { kind: 'template', template: name, sellerId },
    );
  }

  private async send(
    to: string,
    content: Record<string, unknown>,
    meta: { kind: string; template?: string; sellerId?: bigint },
  ): Promise<void> {
    const res = await fetch(
      `${this.base}/${this.config.get('WHATSAPP_PHONE_NUMBER_ID')}/messages`,
      {
        method: 'POST',
        headers: { ...this.authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          ...content,
        }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id: string }>;
      error?: { message?: string; code?: number };
    };
    const wamid = json.messages?.[0]?.id ?? null;
    await this.prisma.outboundMessage.create({
      data: {
        sellerId: meta.sellerId,
        wamid,
        kind: meta.kind,
        template: meta.template,
        status: res.ok ? 'sent' : 'failed',
        error: res.ok ? null : String(json.error?.code ?? res.status),
      },
    });
    if (res.ok) {
      this.logger.log(`Message envoyé à ${maskPhone(to)} (${meta.kind})`);
    } else {
      this.logger.error(
        `Envoi échoué vers ${maskPhone(to)} : HTTP ${res.status}, code ${json.error?.code ?? '-'}`,
      );
      throw new Error(`WhatsApp send failed (${res.status})`);
    }
  }

  /**
   * Récupère l'URL d'un média puis le télécharge immédiatement
   * (l'URL fournie par Meta expire en quelques minutes).
   */
  async downloadMedia(mediaId: string): Promise<DownloadedMedia> {
    const metaRes = await fetch(`${this.base}/${mediaId}`, {
      headers: this.authHeader,
    });
    if (!metaRes.ok) throw new Error(`Media lookup failed (${metaRes.status})`);
    const info = (await metaRes.json()) as { url: string; mime_type: string };

    const fileRes = await fetch(info.url, { headers: this.authHeader });
    if (!fileRes.ok)
      throw new Error(`Media download failed (${fileRes.status})`);
    return {
      data: Buffer.from(await fileRes.arrayBuffer()),
      mimeType: info.mime_type,
    };
  }
}
