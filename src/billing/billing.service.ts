import { Injectable } from '@nestjs/common';
import type { Plan, Prisma, Seller } from '@prisma/client';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';

export type Entitlement = 'subscription' | 'trial' | 'none';

export interface Usage {
  plan: Plan;
  freeLeft: number;
  paidUntil: Date | null;
  /** Vérifications décomptées depuis le début de la période payée */
  used: number;
  quota: number;
  /** Vérifications au-delà du quota (facturées OVERAGE_PRICE chacune) */
  overage: number;
}

type Tx = Prisma.TransactionClient;

/** Essais, abonnements et quotas (EF-40 à EF-46). */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  entitlement(
    seller: Pick<Seller, 'paidUntil' | 'freeLeft'>,
    now = new Date(),
  ): Entitlement {
    if (seller.paidUntil && seller.paidUntil > now) return 'subscription';
    if (seller.freeLeft > 0) return 'trial';
    return 'none';
  }

  /** Décompte une vérification envoyée (à appeler dans la transaction d'envoi). */
  async consume(tx: Tx, seller: Seller, now = new Date()): Promise<void> {
    if (this.entitlement(seller, now) === 'subscription') return;
    await tx.seller.updateMany({
      where: { id: seller.id, freeLeft: { gt: 0 } },
      data: { freeLeft: { decrement: 1 } },
    });
  }

  async usage(seller: Seller): Promise<Usage> {
    const quota = this.config.get('MONTHLY_QUOTA');
    let used = 0;
    if (seller.paidUntil && seller.paidUntil > new Date()) {
      const lastPayment = await this.prisma.payment.findFirst({
        where: { sellerId: seller.id },
        orderBy: { periodStart: 'desc' },
      });
      used = await this.prisma.verification.count({
        where: {
          sellerId: seller.id,
          counted: true,
          sentAt: { gte: lastPayment?.periodStart ?? seller.createdAt },
        },
      });
    }
    return {
      plan: seller.plan,
      freeLeft: seller.freeLeft,
      paidUntil: seller.paidUntil,
      used,
      quota,
      overage: Math.max(0, used - quota),
    };
  }

  /** Places restantes au tarif fondateur (EF-46). */
  async founderSlotsLeft(): Promise<number> {
    const taken = await this.prisma.payment.groupBy({
      by: ['sellerId'],
      where: { plan: 'founder' },
    });
    return Math.max(0, this.config.get('FOUNDER_SLOTS') - taken.length);
  }

  /** Message de fin d'essai ou d'abonnement expiré (EF-42). */
  async offerMessage(seller: Seller): Promise<string> {
    const slots = await this.founderSlotsLeft();
    const standard = this.config.get('STANDARD_PRICE');
    const intro =
      seller.plan === 'trial'
        ? `Tu as utilisé tes ${this.config.get('FREE_TRIALS')} tests gratuits.`
        : 'Ton abonnement SIGA est arrivé à échéance.';
    const price =
      slots > 0
        ? `Pour continuer : ${fmt(this.config.get('FOUNDER_PRICE'))} FCFA le premier mois (tarif fondateur, ${slots} place${slots > 1 ? 's' : ''} restante${slots > 1 ? 's' : ''}), puis ${fmt(standard)} FCFA par mois.`
        : `Pour continuer : ${fmt(standard)} FCFA par mois.`;
    return `${intro}\n${price}\n${this.config.get('PAYMENT_INSTRUCTIONS')}`;
  }

  /**
   * Enregistre un paiement manuel et active l'abonnement (EF-44, EF-64).
   * La période démarre à la fin de l'abonnement en cours, sinon aujourd'hui.
   */
  async recordPayment(
    sellerId: bigint,
    input: {
      amountXof: number;
      plan: Exclude<Plan, 'trial'>;
      months: number;
      method?: string;
      externalId?: string;
    },
    recordedBy: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const seller = await tx.seller.findUniqueOrThrow({
        where: { id: sellerId },
      });
      const now = new Date();
      const start =
        seller.paidUntil && seller.paidUntil > now ? seller.paidUntil : now;
      const end = addMonths(start, input.months);
      const payment = await tx.payment.create({
        data: {
          sellerId,
          amountXof: input.amountXof,
          plan: input.plan,
          method: input.method,
          externalId: input.externalId,
          periodStart: start,
          periodEnd: end,
          recordedBy,
        },
      });
      const updated = await tx.seller.update({
        where: { id: sellerId },
        data: { plan: input.plan, paidUntil: end },
      });
      return { payment, seller: updated };
    });
  }
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  // 31 janvier + 1 mois → dernier jour de février, pas 3 mars
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d;
}

export function fmt(n: number): string {
  return n.toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ');
}
