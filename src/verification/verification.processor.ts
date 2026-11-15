import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AdminNotifier } from '../common/admin-notifier.service';
import { MSG } from '../conversation/messages.fr';
import { PrismaService } from '../prisma/prisma.service';
import { VERIFICATION_QUEUE } from '../queue/queues';
import { WhatsappClient } from '../whatsapp/whatsapp.client';
import { assess } from './grouping';
import { VerificationPipeline } from './verification-pipeline.service';
import {
  VerificationScheduler,
  type VerificationJob,
  type VerificationJobName,
} from './verification.scheduler';

type VJob = Job<VerificationJob, void, VerificationJobName>;

/**
 * Étapes d'une vérification :
 * - settle  : quelques secondes après la dernière pièce, juger si la preuve est complète ;
 * - expire  : fin de la fenêtre de regroupement, on analyse ce qu'on a (ex. R01 si SMS absent) ;
 * - process : extraction + règles + verdict.
 */
@Processor(VERIFICATION_QUEUE, { concurrency: 2 })
export class VerificationProcessor extends WorkerHost {
  private readonly logger = new Logger(VerificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wa: WhatsappClient,
    private readonly scheduler: VerificationScheduler,
    private readonly pipeline: VerificationPipeline,
    private readonly notifier: AdminNotifier,
  ) {
    super();
  }

  async process(job: VJob): Promise<void> {
    const id = BigInt(job.data.verificationId);
    switch (job.name) {
      case 'settle':
        return this.settle(id);
      case 'expire':
        return this.expire(id);
      case 'process':
        return this.pipeline.run(id);
    }
  }

  private async load(id: bigint) {
    const v = await this.prisma.verification.findUnique({
      where: { id },
      include: { seller: true, items: { select: { kind: true } } },
    });
    return v?.status === 'pending' ? v : null;
  }

  private async settle(id: bigint): Promise<void> {
    const v = await this.load(id);
    if (!v) return;
    const result = assess(countItems(v.items));

    if (result === 'too_many') return this.reject(id, v.seller, MSG.oneAtATime);
    if (result === 'complete') return this.start(id, v.seller);

    // Pièce manquante : on la demande, sans décompte (EF-12)
    if (v.seller.stopped || v.seller.blocked) return;
    await this.wa.sendText(
      v.seller.waId,
      result === 'missing_sms' ? MSG.missingSms : MSG.missingCapture,
      v.seller.id,
    );
  }

  private async expire(id: bigint): Promise<void> {
    const v = await this.load(id);
    if (!v) return;
    if (v.items.length === 0) {
      await this.prisma.verification.delete({ where: { id } });
      return;
    }
    const result = assess(countItems(v.items));
    if (result === 'too_many') return this.reject(id, v.seller, MSG.oneAtATime);
    // Preuve incomplète en fin de fenêtre : le moteur de règles tranchera (R01 / R07)
    return this.start(id, v.seller);
  }

  /** Passage pending → processing de façon atomique, puis analyse. */
  private async start(
    id: bigint,
    seller: { id: bigint; waId: string },
  ): Promise<void> {
    const { count } = await this.prisma.verification.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'processing' },
    });
    if (count === 0) return;
    await this.wa.sendText(seller.waId, MSG.received, seller.id);
    await this.scheduler.process(id);
  }

  private async reject(
    id: bigint,
    seller: { id: bigint; waId: string },
    message: string,
  ): Promise<void> {
    const { count } = await this.prisma.verification.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'rejected' },
    });
    if (count === 0) return;
    await this.scheduler.cancelAll(id);
    await this.wa.sendText(seller.waId, message, seller.id);
  }

  /** Échec définitif de l'analyse : excuse au vendeur, relecture, alerte (§13). */
  @OnWorkerEvent('failed')
  async onFailed(job: VJob, err: Error): Promise<void> {
    if (job.name !== 'process' || job.attemptsMade < (job.opts.attempts ?? 1))
      return;
    const id = BigInt(job.data.verificationId);
    this.logger.error(`Analyse ${id} en échec définitif : ${err.message}`);
    const v = await this.prisma.verification.update({
      where: { id },
      data: { status: 'in_review' },
      include: { seller: true },
    });
    await this.notifier.alert('technical_error', v.seller, {
      verificationId: id.toString(),
      stage: 'process',
    });
    await this.wa
      .sendText(v.seller.waId, MSG.technicalError, v.seller.id)
      .catch(() => undefined);
  }
}

function countItems(items: Array<{ kind: string }>) {
  return {
    images: items.filter((i) => i.kind === 'image').length,
    texts: items.filter((i) => i.kind === 'text').length,
  };
}
