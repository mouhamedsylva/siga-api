import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import { eventKey } from '../common/hmac.util';
import { maskPhone } from '../common/redact';
import { AppConfig } from '../config/app-config.service';
import { MSG } from '../conversation/messages.fr';
import { WhatsappClient } from '../whatsapp/whatsapp.client';
import { RateLimiter } from './rate-limiter.service';
import { ConversationService } from '../conversation/conversation.service';
import { PrismaService } from '../prisma/prisma.service';
import { INBOUND_QUEUE } from '../queue/queues';
import type { InboundJob, MessageStatus } from '../whatsapp/whatsapp.types';

const STATUS_RANK: Record<string, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

/**
 * Traitement en arrière-plan des événements webhook.
 * Concurrence 1 : les messages d'un même vendeur restent dans l'ordre
 * (le traitement lourd — OCR — passe par une autre file).
 */
@Processor(INBOUND_QUEUE, { concurrency: 1 })
export class InboundProcessor extends WorkerHost {
  private readonly logger = new Logger(InboundProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversation: ConversationService,
    private readonly rateLimiter: RateLimiter,
    private readonly wa: WhatsappClient,
    private readonly config: AppConfig,
  ) {
    super();
  }

  async process(job: Job<InboundJob>): Promise<void> {
    const data = job.data;
    if (data.kind === 'status')
      return this.handleStatus(data.status, job.attemptsMade);

    const eventId = eventKey(data.message.id);
    if (!(await this.markSeen(eventId))) {
      this.logger.debug('Message rejoué ignoré');
      return;
    }

    // Limitation de débit : au-delà du seuil, messages ignorés (un seul avertissement)
    const { count, limited } = await this.rateLimiter.hit(data.message.from);
    if (limited) {
      if (count === this.config.get('RATE_LIMIT_PER_MINUTE') + 1) {
        this.logger.warn(
          `Limite de débit atteinte pour ${maskPhone(data.message.from)}`,
        );
        await this.wa
          .sendText(data.message.from, MSG.slowDown)
          .catch(() => undefined);
      }
      return;
    }

    try {
      await this.conversation.handle(data.message, data.profileName);
    } catch (err) {
      // On libère l'identifiant pour que la nouvelle tentative BullMQ soit traitée
      await this.prisma.inboundEvent
        .delete({ where: { id: eventId } })
        .catch(() => undefined);
      throw err;
    }
  }

  /** Enregistre l'identifiant ; false s'il a déjà été vu (idempotence). */
  private async markSeen(id: string): Promise<boolean> {
    try {
      await this.prisma.inboundEvent.create({ data: { id } });
      return true;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return false;
      }
      throw err;
    }
  }

  private async handleStatus(
    status: MessageStatus,
    attemptsMade: number,
  ): Promise<void> {
    const current = await this.prisma.outboundMessage.findUnique({
      where: { wamid: status.id },
      select: { status: true },
    });
    if (!current) {
      // L'accusé peut précéder l'enregistrement de l'envoi : une nouvelle tentative suffit
      if (attemptsMade < 2)
        throw new Error('Outbound message not recorded yet');
      return;
    }
    // Les accusés peuvent arriver dans le désordre : on ne régresse jamais
    if ((STATUS_RANK[status.status] ?? 0) <= (STATUS_RANK[current.status] ?? 0))
      return;
    await this.prisma.outboundMessage.update({
      where: { wamid: status.id },
      data: {
        status: status.status,
        error: status.errors?.[0]?.code?.toString() ?? null,
      },
    });
  }
}
