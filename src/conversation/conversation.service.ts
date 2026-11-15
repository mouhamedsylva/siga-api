import { Injectable } from '@nestjs/common';
import type { Seller } from '@prisma/client';
import { AdminNotifier } from '../common/admin-notifier.service';
import { AuditService } from '../common/audit.service';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProofIntakeService } from '../verification/proof-intake.service';
import { WhatsappClient } from '../whatsapp/whatsapp.client';
import type { InboundMessage } from '../whatsapp/whatsapp.types';
import { AccountService, deletedWaId } from './account.service';
import { parseCommand } from './commands';
import { MSG } from './messages.fr';

const PROOF_TYPES = new Set(['text', 'image']);

/**
 * Parcours de conversation (§5) : accueil, conditions, commandes, routage des preuves.
 * L'état du vendeur ne décrit que l'onboarding ; le cycle d'une preuve
 * est porté par verifications.status.
 */
@Injectable()
export class ConversationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly wa: WhatsappClient,
    private readonly audit: AuditService,
    private readonly notifier: AdminNotifier,
    private readonly intake: ProofIntakeService,
    private readonly account: AccountService,
  ) {}

  async handle(message: InboundMessage, profileName?: string): Promise<void> {
    const seller = await this.findOrCreateSeller(message.from, profileName);

    // EF-07 : un numéro bloqué ne reçoit plus aucune réponse
    if (seller.blocked) return;

    const command =
      message.type === 'text' ? parseCommand(message.text?.body) : null;
    const actor = `seller:${seller.id}`;

    // Vendeur arrêté : réactivation seulement sur demande explicite (§13)
    if (seller.stopped) {
      if (command === 'REPRENDRE') {
        await this.prisma.seller.update({
          where: { id: seller.id },
          data: { stopped: false },
        });
        await this.audit.log(actor, 'seller.resumed', String(seller.id));
        if (seller.state === 'active') await this.reply(seller, MSG.resumed);
        else await this.startOnboarding(seller);
      } else {
        await this.reply(seller, MSG.stoppedReminder);
      }
      return;
    }

    // Commandes disponibles dans tous les états
    switch (command) {
      case 'STOP':
        await this.prisma.seller.update({
          where: { id: seller.id },
          data: { stopped: true },
        });
        await this.audit.log(actor, 'seller.stopped', String(seller.id));
        await this.reply(seller, MSG.stop);
        return;
      case 'HUMAIN':
        await this.notifier.alert('human_requested', seller);
        await this.reply(seller, MSG.human);
        return;
      case 'AIDE':
        await this.reply(seller, MSG.help);
        return;
      case 'SUPPRIMER':
        await this.reply(seller, await this.account.requestDeletion(seller));
        return;
      case 'CONFIRMER':
        if (await this.account.deletionPending(seller)) {
          await this.account.deleteData(seller);
          await this.reply(seller, MSG.deleted);
          return;
        }
        break;
    }

    if (seller.state === 'new') {
      await this.startOnboarding(seller);
      return;
    }

    if (seller.state === 'welcomed') {
      if (command === 'OUI') await this.acceptTerms(seller);
      else await this.reply(seller, MSG.askTerms(this.config.get('TERMS_URL')));
      return;
    }

    // Vendeur actif
    switch (command) {
      case 'HISTORIQUE':
        await this.reply(seller, await this.account.history(seller));
        return;
      case 'ABONNEMENT':
        await this.reply(seller, await this.account.subscription(seller));
        return;
      case null:
        break;
      default:
        await this.reply(seller, MSG.help);
        return;
    }
    if (!PROOF_TYPES.has(message.type)) {
      await this.reply(seller, MSG.unsupported);
      return;
    }
    await this.intake.receive(seller, message);
  }

  /**
   * Profil vendeur (EF-02). Un numéro qui a demandé la suppression de ses données
   * repart de zéro, mais sans nouveaux essais gratuits (anti-abus).
   */
  private async findOrCreateSeller(
    waId: string,
    profileName?: string,
  ): Promise<Seller> {
    const now = new Date();
    const existing = await this.prisma.seller.findUnique({ where: { waId } });
    if (existing) {
      return this.prisma.seller.update({
        where: { id: existing.id },
        data: { lastInboundAt: now },
      });
    }
    const wasDeleted = await this.prisma.seller.findUnique({
      where: { waId: deletedWaId(waId, this.config.get('HASH_SECRET')) },
      select: { id: true },
    });
    return this.prisma.seller.upsert({
      where: { waId },
      create: {
        waId,
        displayName: profileName,
        freeLeft: wasDeleted ? 0 : this.config.get('FREE_TRIALS'),
        lastInboundAt: now,
      },
      update: { lastInboundAt: now },
    });
  }

  private async startOnboarding(seller: Seller): Promise<void> {
    await this.reply(seller, MSG.welcome(seller.freeLeft));
    await this.reply(seller, MSG.askTerms(this.config.get('TERMS_URL')));
    await this.prisma.seller.update({
      where: { id: seller.id },
      data: { state: 'welcomed' },
    });
  }

  private async acceptTerms(seller: Seller): Promise<void> {
    const docVersion = this.config.get('TERMS_VERSION');
    await this.prisma.$transaction([
      this.prisma.consent.create({
        data: { sellerId: seller.id, docVersion },
      }),
      this.prisma.seller.update({
        where: { id: seller.id },
        data: { state: 'active' },
      }),
    ]);
    await this.audit.log(
      `seller:${seller.id}`,
      'consent.accepted',
      String(seller.id),
      {
        docVersion,
      },
    );
    await this.reply(seller, MSG.termsAccepted);
  }

  /** Toutes ces réponses suivent un message du vendeur : fenêtre de 24 h ouverte. */
  private reply(seller: Seller, body: string): Promise<void> {
    return this.wa.sendText(seller.waId, body, seller.id);
  }
}
