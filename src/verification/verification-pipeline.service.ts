import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AdminNotifier } from '../common/admin-notifier.service';
import { AuditService } from '../common/audit.service';
import { refFingerprint } from '../common/hmac.util';
import { SettingsService } from '../common/settings.service';
import { AppConfig } from '../config/app-config.service';
import { MSG } from '../conversation/messages.fr';
import { ExtractionService } from '../extraction/extraction.service';
import { refKey } from '../extraction/normalize';
import type { ParsedPiece } from '../extraction/parser';
import { PrismaService } from '../prisma/prisma.service';
import { evaluate, type Decision } from '../rules/engine';
import { WhatsappClient } from '../whatsapp/whatsapp.client';
import { erasePastedText } from './minimize';
import { VerdictSender } from './verdict-sender.service';

/**
 * Analyse d'une preuve complète : extraction → empreinte de la référence →
 * historique (sous verrou) → règles → verdict envoyé, ou relecture, ou rejet.
 */
@Injectable()
export class VerificationPipeline {
  private readonly logger = new Logger(VerificationPipeline.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly wa: WhatsappClient,
    private readonly notifier: AdminNotifier,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly extraction: ExtractionService,
    private readonly sender: VerdictSender,
  ) {}

  async run(verificationId: bigint): Promise<void> {
    const v = await this.prisma.verification.findUnique({
      where: { id: verificationId },
      include: { seller: true, items: true },
    });
    if (!v || v.status !== 'processing') return;

    const started = Date.now();
    const { capture, sms } = await this.extraction.extract(v.items);

    const ref = capture?.ref ?? sms?.ref ?? null;
    const operator = capture?.operator ?? sms?.operator ?? null;
    const refHash = ref
      ? refFingerprint(refKey(ref), this.config.get('HASH_SECRET'))
      : null;

    const decision = await this.decideUnderLock(
      v.id,
      v.sellerId,
      refHash,
      operator,
      {
        capture,
        sms,
      },
    );

    // EF-33 : journal de chaque règle déclenchée
    await this.audit.log('system', 'verification.decided', v.id.toString(), {
      outcome: decision.outcome,
      rules: decision.triggered.map((t) => `${t.rule}:${t.effect}`),
      formats: [capture?.formatId ?? null, sms?.formatId ?? null],
      ms: Date.now() - started,
    });

    const seller = v.seller;
    if (decision.outcome === 'rejected') {
      // EF-15 : rien n'est décompté, on demande une meilleure pièce
      const noCapture = decision.primary?.note === 'capture absente';
      await this.wa.sendText(
        seller.waId,
        noCapture ? MSG.resendBoth : MSG.unreadable,
        seller.id,
      );
      return;
    }

    if (decision.triggered.some((t) => t.rule === 'R08')) {
      await this.notifier.alert('unknown_format', seller, {
        verificationId: v.id.toString(),
      });
    }

    if (decision.needsReview && (await this.settings.reviewMode())) {
      await this.prisma.verification.update({
        where: { id: v.id },
        data: { status: 'in_review' },
      });
      await this.notifier.alert('review_pending', seller, {
        verificationId: v.id.toString(),
      });
      await this.wa.sendText(seller.waId, MSG.inReview, seller.id);
      return;
    }

    await this.sender.send(v.id, { actor: 'system' });
  }

  /**
   * Le contrôle des doublons et l'enregistrement de l'empreinte se font sous un
   * verrou de ligne (ref_locks, SELECT … FOR UPDATE) tenu jusqu'au COMMIT, en
   * READ COMMITTED : deux vendeurs qui soumettent la même référence au même
   * instant sont traités l'un après l'autre, et le second voit la décision du premier.
   */
  private async decideUnderLock(
    id: bigint,
    sellerId: bigint,
    refHash: string | null,
    operator: string | null,
    pieces: { capture: ParsedPiece | null; sms: ParsedPiece | null },
  ): Promise<Decision> {
    return this.prisma.$transaction(
      async (tx) => {
        if (refHash) {
          await tx.$executeRaw`INSERT IGNORE INTO ref_locks (hash) VALUES (${refHash})`;
          await tx.$queryRaw`SELECT hash FROM ref_locks WHERE hash = ${refHash} FOR UPDATE`;
        }
        {
          const seen = refHash
            ? await tx.verification.findMany({
                where: {
                  id: { not: id },
                  txRefHash: refHash,
                  // processing : décidée mais pas encore envoyée — l'empreinte compte déjà
                  status: { in: ['processing', 'in_review', 'sent'] },
                  ...(operator ? { operator } : {}),
                },
                select: { sellerId: true },
              })
            : [];
          const decision = evaluate(
            {
              ...pieces,
              history: {
                otherSeller: seen.some((s) => s.sellerId !== sellerId),
                sameSeller: seen.some((s) => s.sellerId === sellerId),
              },
              now: new Date(),
            },
            {
              maxTimeGapMinutes: this.config.get('MAX_TIME_GAP_MINUTES'),
              futureToleranceMinutes: this.config.get(
                'FUTURE_TOLERANCE_MINUTES',
              ),
              ocrMinConfidence: this.config.get('OCR_MIN_CONFIDENCE'),
            },
          );
          const rejected = decision.outcome === 'rejected';
          const { capture, sms } = pieces;
          await tx.verification.update({
            where: { id },
            data: {
              status: rejected ? 'rejected' : 'processing',
              operator,
              amountXof: capture?.amount ?? sms?.amount ?? null,
              // Une preuve rejetée ne « réserve » pas sa référence
              txRefHash: rejected ? null : refHash,
              txDatetime: capture?.datetime ?? sms?.datetime ?? null,
              smsPresent: !!sms,
              verdict:
                decision.outcome === 'rejected' ? null : decision.outcome,
              reasons: decision.triggered as unknown as Prisma.InputJsonValue,
              // Seuls des scores : ni nom d'expéditeur, ni numéro (§9)
              confidence: {
                capture: capture?.confidence ?? null,
                sms: sms?.confidence ?? null,
                captureFormat: capture?.formatId ?? null,
                smsFormat: sms?.formatId ?? null,
              },
            },
          });
          // Rejet : décision finale, le SMS collé n'est plus conservé.
          // Sinon il reste lisible pour une éventuelle relecture (effacé à l'envoi).
          if (rejected) await erasePastedText(tx, id);
          return decision;
        }
      },
      {
        timeout: 20_000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }
}
