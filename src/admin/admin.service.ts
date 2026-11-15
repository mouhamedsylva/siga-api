import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { BillingService } from '../billing/billing.service';
import { AuditService } from '../common/audit.service';
import { maskPhone } from '../common/redact';
import { SettingsService } from '../common/settings.service';
import { isWithinSessionWindow } from '../conversation/session-window';
import { MSG } from '../conversation/messages.fr';
import { ExtractionService } from '../extraction/extraction.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { erasePastedText } from '../verification/minimize';
import { VerdictSender } from '../verification/verdict-sender.service';
import { WhatsappClient } from '../whatsapp/whatsapp.client';
import type {
  PaymentInput,
  ReviewDecision,
  SellerFilter,
  VerificationFilter,
} from './admin.dto';

/** Opérations du back-office (§4.7, §10). Toute action écrit dans audit_log. */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sender: VerdictSender,
    private readonly billing: BillingService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly extraction: ExtractionService,
    private readonly wa: WhatsappClient,
  ) {}

  // ---------- Vérifications ----------

  async listVerifications(f: VerificationFilter) {
    const where: Prisma.VerificationWhereInput = {
      status: f.status,
      verdict: f.verdict,
      sellerId: f.sellerId,
      createdAt: f.from || f.to ? { gte: f.from, lte: f.to } : undefined,
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.verification.count({ where }),
      this.prisma.verification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
        omit: { txRefHash: true },
      }),
    ]);
    return { total, page: f.page, pageSize: f.pageSize, rows };
  }

  async getVerification(id: bigint) {
    const v = await this.prisma.verification.findUnique({
      where: { id },
      omit: { txRefHash: true },
      include: VERIFICATION_DETAIL,
    });
    if (!v) throw new NotFoundException();
    return presentVerification(v);
  }

  async getItemImage(verificationId: bigint, itemId: bigint) {
    const item = await this.prisma.verificationItem.findFirst({
      where: { id: itemId, verificationId, storageKey: { not: null } },
    });
    if (!item?.storageKey) throw new NotFoundException();
    return {
      data: await this.storage.get(item.storageKey),
      mimeType: item.mimeType ?? 'application/octet-stream',
    };
  }

  /** File de relecture : les plus anciens d'abord, avec pièces et vendeur. */
  async reviewQueue() {
    const rows = await this.prisma.verification.findMany({
      where: { status: 'in_review' },
      orderBy: { createdAt: 'asc' },
      omit: { txRefHash: true },
      include: VERIFICATION_DETAIL,
      take: 100,
    });
    return rows.map(presentVerification);
  }

  async review(id: bigint, decision: ReviewDecision, admin: string) {
    const v = await this.prisma.verification.findUnique({
      where: { id },
      include: { seller: true },
    });
    if (!v) throw new NotFoundException();
    if (v.status !== 'in_review')
      throw new ConflictException(`Statut actuel : ${v.status}`);

    if (decision.action === 'reject') {
      await this.prisma.verification.update({
        where: { id },
        data: {
          status: 'rejected',
          txRefHash: null,
          reviewedBy: admin,
          reviewedAt: new Date(),
        },
      });
      await erasePastedText(this.prisma, id);
      if (isWithinSessionWindow(v.seller.lastInboundAt)) {
        await this.wa.sendText(v.seller.waId, MSG.unreadable, v.seller.id);
      }
    } else {
      if (!decision.verdict && !v.verdict)
        throw new BadRequestException(
          'Aucun verdict calculé : préciser le verdict à envoyer',
        );
      const sent = await this.sender.send(id, {
        actor: admin,
        verdict: decision.verdict,
        reason: decision.reason,
      });
      if (!sent) throw new ConflictException('Déjà traitée');
    }
    await this.audit.log(
      admin,
      `review.${decision.action}`,
      `verification:${id}`,
      {
        computed: v.verdict,
        ...(decision.action === 'send'
          ? {
              verdict: decision.verdict ?? v.verdict,
              reason: decision.reason ?? null,
            }
          : {}),
      },
    );
    return this.getVerification(id);
  }

  // ---------- Vendeurs ----------

  async listSellers(f: SellerFilter) {
    const where: Prisma.SellerWhereInput = {
      deletedAt: null,
      plan: f.plan,
      blocked: f.blocked,
      ...(f.q
        ? {
            OR: [
              { waId: { contains: f.q.replace(/\D/g, '') || f.q } },
              { displayName: { contains: f.q } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.seller.count({ where }),
      this.prisma.seller.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
      }),
    ]);
    return { total, page: f.page, pageSize: f.pageSize, rows };
  }

  async getSeller(id: bigint) {
    const seller = await this.prisma.seller.findUnique({
      where: { id },
      include: {
        payments: { orderBy: { paidAt: 'desc' } },
        consents: { orderBy: { acceptedAt: 'desc' }, take: 1 },
        verifications: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          omit: { txRefHash: true },
        },
      },
    });
    if (!seller) throw new NotFoundException();
    return {
      ...seller,
      entitlement: this.billing.entitlement(seller),
      usage: await this.billing.usage(seller),
    };
  }

  async recordPayment(sellerId: bigint, input: PaymentInput, admin: string) {
    const { payment, seller } = await this.billing
      .recordPayment(sellerId, input, admin)
      .catch((err: unknown) => {
        if ((err as { code?: string }).code === 'P2025')
          throw new NotFoundException();
        throw err;
      });
    await this.audit.log(admin, 'payment.recorded', `seller:${sellerId}`, {
      paymentId: payment.id.toString(),
      amountXof: input.amountXof,
      plan: input.plan,
      months: input.months,
    });

    // Confirmation au vendeur (EF-44) — message libre seulement dans la fenêtre de 24 h
    let notified = false;
    if (isWithinSessionWindow(seller.lastInboundAt) && !seller.blocked) {
      const until = seller
        .paidUntil!.toISOString()
        .slice(0, 10)
        .split('-')
        .reverse()
        .join('/');
      await this.wa.sendText(
        seller.waId,
        MSG.subscriptionActivated(until),
        seller.id,
      );
      notified = true;
    }
    return { payment, seller, notified };
  }

  async setBlocked(id: bigint, blocked: boolean, admin: string) {
    const seller = await this.prisma.seller
      .update({ where: { id }, data: { blocked } })
      .catch(() => {
        throw new NotFoundException();
      });
    await this.audit.log(
      admin,
      blocked ? 'seller.blocked' : 'seller.unblocked',
      `seller:${id}`,
    );
    return seller;
  }

  // ---------- Paramètres et exploitation ----------

  async setReviewMode(value: boolean, admin: string) {
    await this.settings.setReviewMode(value);
    await this.audit.log(admin, 'settings.review_mode', 'settings', { value });
    return { reviewMode: value };
  }

  async getSettings() {
    return { reviewMode: await this.settings.reviewMode() };
  }

  async reloadFormats(admin: string) {
    const count = this.extraction.reloadFormats();
    await this.audit.log(admin, 'formats.reloaded', 'formats', { count });
    return { formats: count };
  }

  auditLog(page: number, pageSize: number) {
    return this.prisma.auditLog.findMany({
      orderBy: { at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }

  /** Indicateurs (EF-65). */
  async stats(days: number) {
    const since = new Date(Date.now() - days * 86_400_000);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);

    const [perDay, verdicts, sellers, paying, active, reviewQueue, rejected] =
      await Promise.all([
        this.prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
          SELECT DATE(sent_at) AS day, COUNT(*) AS count
          FROM verifications
          WHERE status = 'sent' AND sent_at >= ${since}
          GROUP BY DATE(sent_at) ORDER BY day`,
        this.prisma.verification.groupBy({
          by: ['verdict'],
          where: { status: 'sent', sentAt: { gte: since } },
          _count: { _all: true },
        }),
        this.prisma.seller.count({ where: { deletedAt: null } }),
        this.prisma.payment.groupBy({ by: ['sellerId'] }),
        this.prisma.verification.groupBy({
          by: ['sellerId'],
          where: { status: 'sent', sentAt: { gte: weekAgo } },
        }),
        this.prisma.verification.count({ where: { status: 'in_review' } }),
        this.prisma.verification.count({
          where: { status: 'rejected', createdAt: { gte: since } },
        }),
      ]);

    return {
      days,
      perDay: perDay.map((r) => ({
        day: new Date(r.day).toISOString().slice(0, 10),
        count: Number(r.count),
      })),
      verdicts: Object.fromEntries(
        verdicts.map((v) => [v.verdict ?? 'aucun', v._count._all]),
      ),
      rejected,
      sellers,
      payingSellers: paying.length,
      trialToPaidRate: sellers ? +(paying.length / sellers).toFixed(3) : 0,
      activeSellers7d: active.length,
      reviewQueue,
      founderSlotsLeft: await this.billing.founderSlotsLeft(),
    };
  }
}

/** Données d'une vérification utiles au back-office. */
const VERIFICATION_DETAIL = {
  seller: {
    select: {
      id: true,
      waId: true,
      displayName: true,
      plan: true,
      blocked: true,
    },
  },
  items: {
    orderBy: { receivedAt: 'asc' },
    select: {
      id: true,
      kind: true,
      mimeType: true,
      receivedAt: true,
      deletedAt: true,
      storageKey: true,
      // SMS collé : disponible tant que la vérification n'est pas tranchée
      text: true,
    },
  },
} satisfies Prisma.VerificationInclude;

type VerificationWithDetail = Prisma.VerificationGetPayload<{
  include: typeof VERIFICATION_DETAIL;
  omit: { txRefHash: true };
}>;

function presentVerification(v: VerificationWithDetail) {
  return {
    ...v,
    seller: { ...v.seller, waId: maskPhone(v.seller.waId) },
    items: v.items.map(({ storageKey, ...item }) => ({
      ...item,
      image: storageKey
        ? `/admin/verifications/${v.id}/items/${item.id}/image`
        : null,
    })),
  };
}
