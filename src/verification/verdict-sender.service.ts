import { Injectable, Logger } from '@nestjs/common';
import { BillingService } from '../billing/billing.service';
import { AppConfig } from '../config/app-config.service';
import { isWithinSessionWindow } from '../conversation/session-window';
import { PrismaService } from '../prisma/prisma.service';
import { pickPrimary, type Triggered, type Verdict } from '../rules/engine';
import { buildVerdictMessage, VERDICT_LABEL } from '../rules/verdict-message';
import { WhatsappClient } from '../whatsapp/whatsapp.client';
import { erasePastedText } from './minimize';

export interface SendOptions {
  /** 'system' pour un envoi automatique, identifiant de l'admin sinon */
  actor: string;
  /** Verdict modifié par l'administrateur (EF-62) */
  verdict?: Verdict;
  /** Raison courte rédigée par l'administrateur */
  reason?: string;
}

/**
 * Envoi du verdict au vendeur et décompte (EF-32, EF-41).
 * Pas de décompte pour une référence déjà vérifiée par le même vendeur (§13).
 */
@Injectable()
export class VerdictSender {
  private readonly logger = new Logger(VerdictSender.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly wa: WhatsappClient,
    private readonly billing: BillingService,
  ) {}

  /** Retourne false si la vérification n'est pas (ou plus) envoyable. */
  async send(id: bigint, opts: SendOptions): Promise<boolean> {
    const v = await this.prisma.verification.findUnique({
      where: { id },
      include: { seller: true },
    });
    if (!v || !['processing', 'in_review'].includes(v.status)) return false;

    const verdict = opts.verdict ?? v.verdict;
    if (!verdict) throw new Error(`Vérification ${id} sans verdict`);
    const triggered = (v.reasons ?? []) as unknown as Triggered[];
    const primary = pickPrimary(triggered, verdict);
    const message = buildVerdictMessage(
      verdict,
      triggered,
      primary?.rule ?? null,
      opts.reason,
    );
    const counted = !triggered.some((t) => t.rule === 'R06');

    if (!v.seller.blocked) {
      if (isWithinSessionWindow(v.seller.lastInboundAt)) {
        await this.wa.sendText(v.seller.waId, message, v.seller.id);
      } else {
        // Hors fenêtre de 24 h (relecture tardive) : modèle approuvé obligatoire
        await this.wa.sendTemplate(
          v.seller.waId,
          this.config.get('TEMPLATE_VERDICT_READY'),
          [VERDICT_LABEL[verdict]],
          v.seller.id,
        );
      }
    }

    const human = opts.actor !== 'system';
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.verification.updateMany({
        where: { id, status: { in: ['processing', 'in_review'] } },
        data: {
          status: 'sent',
          sentAt: new Date(),
          verdict,
          counted,
          reviewedBy: human ? opts.actor : undefined,
          reviewedAt: human ? new Date() : undefined,
        },
      });
      if (count && counted) await this.billing.consume(tx, v.seller);
      // Décision finale : le SMS collé n'est plus conservé
      if (count) await erasePastedText(tx, id);
    });
    this.logger.log(`Verdict ${verdict} envoyé (vérification ${id})`);
    return true;
  }
}
