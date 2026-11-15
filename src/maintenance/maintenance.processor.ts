import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { AuditService } from '../common/audit.service';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { MAINTENANCE_QUEUE } from '../queue/queues';
import { StorageService } from '../storage/storage.service';
import { WhatsappClient } from '../whatsapp/whatsapp.client';

type TaskName = 'purge-images' | 'subscription-reminders' | 'review-backlog';

const DAY = 86_400_000;

/**
 * Tâches planifiées (heures UTC = heures de Dakar) :
 * - purge des images après IMAGE_RETENTION_DAYS (§9) et des anciens wamid ;
 * - rappel d'expiration d'abonnement par modèle approuvé (EF-45) ;
 * - alerte si la file de relecture n'est pas vidée (EF-66).
 */
@Processor(MAINTENANCE_QUEUE)
export class MaintenanceProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    @InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: AppConfig,
    private readonly wa: WhatsappClient,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    const opts = { removeOnComplete: 50, removeOnFail: 50 };
    await this.queue.upsertJobScheduler(
      'purge-images',
      { pattern: '0 3 * * *' },
      { name: 'purge-images', opts },
    );
    await this.queue.upsertJobScheduler(
      'subscription-reminders',
      { pattern: '0 9 * * *' },
      { name: 'subscription-reminders', opts },
    );
    await this.queue.upsertJobScheduler(
      'review-backlog',
      { pattern: '0 * * * *' },
      { name: 'review-backlog', opts },
    );
  }

  async process(job: Job<unknown, unknown, TaskName>): Promise<unknown> {
    switch (job.name) {
      case 'purge-images':
        return this.purgeImages();
      case 'subscription-reminders':
        return this.subscriptionReminders();
      case 'review-backlog':
        return this.reviewBacklog();
    }
  }

  async purgeImages(now = new Date()): Promise<{ images: number }> {
    const cutoff = new Date(
      now.getTime() - this.config.get('IMAGE_RETENTION_DAYS') * DAY,
    );
    let images = 0;
    for (;;) {
      const batch = await this.prisma.verificationItem.findMany({
        where: { receivedAt: { lt: cutoff }, storageKey: { not: null } },
        select: { id: true, storageKey: true },
        take: 200,
      });
      if (!batch.length) break;
      for (const item of batch) {
        try {
          await this.storage.delete(item.storageKey!);
        } catch (err) {
          this.logger.warn(`Purge : image non supprimée (${String(err)})`);
          continue;
        }
        await this.prisma.verificationItem.update({
          where: { id: item.id },
          data: { storageKey: null, text: null, deletedAt: now },
        });
        images++;
      }
      if (batch.length < 200) break;
    }
    // Filet de sécurité : SMS collés des vérifications terminées, ou trop anciens
    await this.prisma.verificationItem.updateMany({
      where: {
        kind: 'text',
        text: { not: null },
        OR: [
          { verification: { status: { in: ['sent', 'rejected', 'failed'] } } },
          { receivedAt: { lt: cutoff } },
        ],
      },
      data: { text: null },
    });
    // Les identifiants de messages ne servent qu'à l'idempotence : 30 jours suffisent
    await this.prisma.inboundEvent.deleteMany({
      where: { receivedAt: { lt: new Date(now.getTime() - 30 * DAY) } },
    });
    await this.audit.log('system', 'maintenance.purge', 'images', { images });
    return { images };
  }

  /** Rappel unique, 3 jours avant l'échéance. */
  async subscriptionReminders(now = new Date()): Promise<{ sent: number }> {
    const sellers = await this.prisma.seller.findMany({
      where: {
        paidUntil: {
          gte: new Date(now.getTime() + 2 * DAY),
          lt: new Date(now.getTime() + 3 * DAY),
        },
        stopped: false,
        blocked: false,
        deletedAt: null,
      },
    });
    let sent = 0;
    for (const s of sellers) {
      const until = s
        .paidUntil!.toISOString()
        .slice(0, 10)
        .split('-')
        .reverse()
        .join('/');
      try {
        await this.wa.sendTemplate(
          s.waId,
          this.config.get('TEMPLATE_SUB_REMINDER'),
          [until],
          s.id,
        );
        sent++;
      } catch {
        this.logger.warn(`Rappel d'abonnement non envoyé (vendeur ${s.id})`);
      }
    }
    return { sent };
  }

  /** Alerte si des cas attendent la relecture depuis plus de 2 heures. */
  async reviewBacklog(now = new Date()): Promise<{ waiting: number }> {
    const waiting = await this.prisma.verification.count({
      where: {
        status: 'in_review',
        createdAt: { lt: new Date(now.getTime() - 2 * 3_600_000) },
      },
    });
    if (waiting > 0) {
      await this.audit.log('system', 'alert.review_backlog', 'review', {
        waiting,
      });
      const adminWaId = this.config.get('ADMIN_WA_ID');
      if (adminWaId) {
        await this.wa
          .sendText(
            adminWaId,
            `[SIGA] ${waiting} vérification(s) attendent la relecture depuis plus de 2 h.`,
          )
          .catch(() => undefined);
      }
    }
    return { waiting };
  }
}
