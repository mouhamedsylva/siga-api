import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';
import { WhatsappClient } from '../whatsapp/whatsapp.client';
import { AuditService } from './audit.service';
import { maskPhone } from './redact';

export type AdminAlert =
  'human_requested' | 'review_pending' | 'unknown_format' | 'technical_error';

export interface AlertSeller {
  id: bigint;
  waId: string;
}

/**
 * Prévient l'administrateur : journal d'audit (source de vérité du back-office)
 * et WhatsApp si ADMIN_WA_ID est défini. L'envoi WhatsApp n'est possible que
 * dans la fenêtre de 24 h de l'administrateur.
 */
@Injectable()
export class AdminNotifier {
  private readonly logger = new Logger(AdminNotifier.name);

  constructor(
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly wa: WhatsappClient,
  ) {}

  async alert(
    kind: AdminAlert,
    seller: AlertSeller,
    detail: Record<string, string | number | boolean> = {},
  ): Promise<void> {
    await this.audit.log(
      'system',
      `alert.${kind}`,
      `seller:${seller.id}`,
      detail,
    );
    this.logger.log(`Alerte ${kind} pour ${maskPhone(seller.waId)}`);

    const adminWaId = this.config.get('ADMIN_WA_ID');
    if (!adminWaId) return;
    try {
      await this.wa.sendText(
        adminWaId,
        `[SIGA] ${kind} — vendeur n°${seller.id} (${maskPhone(seller.waId)}). Voir le back-office.`,
      );
    } catch {
      this.logger.warn(`Alerte admin non envoyée par WhatsApp (${kind})`);
    }
  }
}
