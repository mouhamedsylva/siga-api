import { InjectQueue } from '@nestjs/bullmq';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { safeEqual } from '../common/hmac.util';
import { AppConfig } from '../config/app-config.service';
import { INBOUND_QUEUE } from '../queue/queues';
import { SignatureGuard } from './signature.guard';
import type { InboundJob, WebhookPayload } from './whatsapp.types';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly config: AppConfig,
    @InjectQueue(INBOUND_QUEUE) private readonly inbound: Queue<InboundJob>,
  ) {}

  /** Vérification de l'abonnement par Meta. */
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    if (
      mode === 'subscribe' &&
      typeof token === 'string' &&
      safeEqual(token, this.config.get('WHATSAPP_VERIFY_TOKEN'))
    ) {
      return challenge;
    }
    throw new ForbiddenException();
  }

  /**
   * Réception : signature vérifiée par le guard, mise en file, puis 200 immédiat.
   * Si Redis est indisponible, la réponse est 500 et Meta rejouera (aucun message perdu).
   */
  @Post()
  @HttpCode(200)
  @UseGuards(SignatureGuard)
  async receive(@Body() payload: WebhookPayload): Promise<{ ok: true }> {
    const jobs = extractJobs(payload);
    // Trace de chaque appel de Meta (sans contenu ni numéro) : indispensable pour diagnostiquer
    const messages = jobs.filter((j) => j.kind === 'message').length;
    this.logger.log(
      `Webhook Meta : ${messages} message(s), ${jobs.length - messages} statut(s)` +
        (payload?.object !== 'whatsapp_business_account'
          ? ` (objet inattendu : ${String(payload?.object)})`
          : ''),
    );
    if (jobs.length) {
      await this.inbound.addBulk(
        jobs.map((data) => ({
          name: data.kind,
          data,
          opts: {
            // Déduplication côté file, en plus de inbound_events
            jobId:
              data.kind === 'message'
                ? `m_${data.message.id}`
                : `s_${data.status.id}_${data.status.status}`,
            attempts: 5,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          },
        })),
      );
    }
    return { ok: true };
  }
}

export function extractJobs(payload: WebhookPayload): InboundJob[] {
  if (payload?.object !== 'whatsapp_business_account') return [];
  const jobs: InboundJob[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const v = change.value;
      for (const message of v.messages ?? []) {
        const profileName = v.contacts?.find((c) => c.wa_id === message.from)
          ?.profile?.name;
        jobs.push({ kind: 'message', message, profileName });
      }
      for (const status of v.statuses ?? []) {
        jobs.push({ kind: 'status', status });
      }
    }
  }
  return jobs;
}
