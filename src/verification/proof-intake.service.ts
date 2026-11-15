import { Injectable, Logger } from '@nestjs/common';
import type { Seller, Verification } from '@prisma/client';
import { BillingService } from '../billing/billing.service';
import { AdminNotifier } from '../common/admin-notifier.service';
import { eventKey } from '../common/hmac.util';
import { AppConfig } from '../config/app-config.service';
import { MSG } from '../conversation/messages.fr';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { WhatsappClient } from '../whatsapp/whatsapp.client';
import type { InboundMessage } from '../whatsapp/whatsapp.types';
import { ACCEPTED_IMAGE_TYPES, looksLikeSms } from './grouping';
import { VerificationScheduler } from './verification.scheduler';

/**
 * Réception des pièces (capture / SMS) d'un vendeur actif :
 * téléchargement immédiat du média, stockage, rattachement à la vérification
 * ouverte, puis attente courte avant de juger si la preuve est complète.
 */
@Injectable()
export class ProofIntakeService {
  private readonly logger = new Logger(ProofIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly wa: WhatsappClient,
    private readonly storage: StorageService,
    private readonly scheduler: VerificationScheduler,
    private readonly notifier: AdminNotifier,
    private readonly billing: BillingService,
  ) {}

  async receive(seller: Seller, message: InboundMessage): Promise<void> {
    // Essais épuisés ou abonnement expiré : offre, aucune vérification (§13)
    if (
      this.billing.entitlement(seller) === 'none' &&
      !(await this.findOpen(seller))
    ) {
      await this.reply(seller, await this.billing.offerMessage(seller));
      return;
    }
    if (message.type === 'image' && message.image) {
      return this.receiveImage(seller, message, message.image);
    }
    if (message.type === 'text' && message.text) {
      return this.receiveText(seller, message, message.text.body);
    }
    await this.reply(seller, MSG.unsupported);
  }

  private async receiveImage(
    seller: Seller,
    message: InboundMessage,
    image: NonNullable<InboundMessage['image']>,
  ): Promise<void> {
    const ext = ACCEPTED_IMAGE_TYPES[image.mime_type];
    if (!ext) {
      await this.reply(seller, MSG.unsupported);
      return;
    }

    // L'adresse du média expire vite : téléchargement avant toute autre opération
    let data: Buffer;
    try {
      const media = await this.wa.downloadMedia(image.id);
      data = media.data;
    } catch (err) {
      this.logger.error(`Téléchargement du média échoué : ${String(err)}`);
      await this.reply(seller, MSG.mediaError);
      return;
    }
    if (data.length > this.config.get('MAX_IMAGE_BYTES')) {
      await this.reply(seller, MSG.unreadable);
      return;
    }

    const verification = await this.openVerification(seller);
    const key = `proofs/${seller.id}/${verification.id}/${eventKey(message.id).slice(0, 16)}.${ext}`;
    try {
      await this.storage.put(key, data, image.mime_type);
    } catch (err) {
      this.logger.error(`Stockage indisponible : ${String(err)}`);
      await this.notifier.alert('technical_error', seller, {
        stage: 'storage',
      });
      await this.reply(seller, MSG.technicalError);
      return;
    }

    await this.prisma.verificationItem.create({
      data: {
        verificationId: verification.id,
        wamid: message.id,
        kind: 'image',
        storageKey: key,
        mimeType: image.mime_type,
      },
    });
    await this.scheduler.settle(verification.id);
  }

  private async receiveText(
    seller: Seller,
    message: InboundMessage,
    body: string,
  ): Promise<void> {
    if (!looksLikeSms(body)) {
      await this.reply(seller, MSG.notAProof);
      return;
    }
    const verification = await this.openVerification(seller);
    await this.prisma.verificationItem.create({
      data: {
        verificationId: verification.id,
        wamid: message.id,
        kind: 'text',
        text: body.slice(0, 2000),
      },
    });
    await this.scheduler.settle(verification.id);
  }

  /**
   * Vérification en cours de collecte pour ce vendeur, ou nouvelle.
   * Le worker d'entrée a une concurrence de 1 : pas de création concurrente.
   */
  private async openVerification(seller: Seller): Promise<Verification> {
    const open = await this.findOpen(seller);
    if (open) return open;

    const created = await this.prisma.verification.create({
      data: { sellerId: seller.id, reasons: [] },
    });
    await this.scheduler.expire(created.id);
    return created;
  }

  private findOpen(seller: Seller): Promise<Verification | null> {
    const windowStart = new Date(
      Date.now() - this.config.get('SESSION_WINDOW_MINUTES') * 60_000,
    );
    return this.prisma.verification.findFirst({
      where: {
        sellerId: seller.id,
        status: 'pending',
        createdAt: { gte: windowStart },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private reply(seller: Seller, body: string): Promise<void> {
    return this.wa.sendText(seller.waId, body, seller.id);
  }
}
