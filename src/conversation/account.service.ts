import { Injectable, Logger } from '@nestjs/common';
import type { Seller } from '@prisma/client';
import { BillingService, fmt } from '../billing/billing.service';
import { AuditService } from '../common/audit.service';
import { refFingerprint } from '../common/hmac.util';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { VERDICT_LABEL } from '../rules/verdict-message';
import { StorageService } from '../storage/storage.service';

const CONFIRM_WINDOW_MS = 10 * 60_000;

/** Commandes HISTORIQUE, ABONNEMENT, SUPPRIMER MES DONNÉES (EF-06, EF-51, EF-52). */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly billing: BillingService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** 10 dernières vérifications : date, montant, verdict. */
  async history(seller: Seller): Promise<string> {
    const rows = await this.prisma.verification.findMany({
      where: { sellerId: seller.id, status: 'sent' },
      orderBy: { sentAt: 'desc' },
      take: 10,
      select: { sentAt: true, amountXof: true, verdict: true },
    });
    if (!rows.length) return "Tu n'as encore aucune vérification.";
    const lines = rows.map((r) => {
      const d = r.sentAt!;
      const date = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}h${pad(d.getUTCMinutes())}`;
      const amount = r.amountXof ? `${fmt(r.amountXof)} F` : '—';
      return `${date} · ${amount} · ${r.verdict ? VERDICT_LABEL[r.verdict] : '—'}`;
    });
    return `Tes dernières vérifications :\n${lines.join('\n')}`;
  }

  async subscription(seller: Seller): Promise<string> {
    const ent = this.billing.entitlement(seller);
    if (ent === 'none') return this.billing.offerMessage(seller);
    if (ent === 'trial') {
      return `Il te reste ${seller.freeLeft} test${seller.freeLeft > 1 ? 's' : ''} gratuit${seller.freeLeft > 1 ? 's' : ''}.`;
    }
    const u = await this.billing.usage(seller);
    const until = seller.paidUntil!;
    const over = u.overage
      ? `\n${u.overage} vérification(s) au-delà du forfait, à ${fmt(this.config.get('OVERAGE_PRICE'))} F l'une.`
      : '';
    return (
      `Abonnement actif jusqu'au ${pad(until.getUTCDate())}/${pad(until.getUTCMonth() + 1)}/${until.getUTCFullYear()}.\n` +
      `${u.used} vérification(s) utilisée(s) sur ${u.quota} ce mois-ci.` +
      over
    );
  }

  async requestDeletion(seller: Seller): Promise<string> {
    await this.audit.log(
      `seller:${seller.id}`,
      'privacy.requested',
      String(seller.id),
    );
    return (
      `Je vais effacer ton profil et tes captures. Cette action est définitive.\n` +
      `Écris CONFIRMER dans les 10 minutes pour valider.`
    );
  }

  /** Vrai si une demande de suppression attend confirmation. */
  async deletionPending(seller: Seller): Promise<boolean> {
    const req = await this.prisma.auditLog.findFirst({
      where: {
        action: 'privacy.requested',
        target: String(seller.id),
        at: { gte: new Date(Date.now() - CONFIRM_WINDOW_MS) },
      },
    });
    return !!req;
  }

  /**
   * Efface les données personnelles et les images du vendeur.
   * Conservé : empreintes HMAC, montants et verdicts, pour la détection de
   * doublons (à valider juridiquement, EF-51), et l'empreinte du numéro pour
   * ne pas offrir de nouveaux essais gratuits après suppression.
   */
  async deleteData(seller: Seller): Promise<void> {
    const items = await this.prisma.verificationItem.findMany({
      where: {
        verification: { sellerId: seller.id },
        storageKey: { not: null },
      },
      select: { id: true, storageKey: true },
    });
    for (const item of items) {
      await this.storage.delete(item.storageKey!).catch((err: unknown) => {
        this.logger.warn(`Image non supprimée : ${String(err)}`);
      });
    }
    await this.prisma.$transaction([
      this.prisma.verificationItem.updateMany({
        where: { verification: { sellerId: seller.id } },
        data: { storageKey: null, text: null, deletedAt: new Date() },
      }),
      this.prisma.seller.update({
        where: { id: seller.id },
        data: {
          waId: deletedWaId(seller.waId, this.config.get('HASH_SECRET')),
          displayName: null,
          deletedAt: new Date(),
          stopped: true,
        },
      }),
    ]);
    await this.audit.log(
      `seller:${seller.id}`,
      'privacy.deleted',
      String(seller.id),
      {
        images: items.length,
      },
    );
  }
}

/** Identifiant anonymisé d'un numéro supprimé. */
export function deletedWaId(waId: string, secret: string): string {
  return `del:${refFingerprint(waId, secret)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
