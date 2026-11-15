import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { JobsOptions, Queue } from 'bullmq';
import { AppConfig } from '../config/app-config.service';
import { VERIFICATION_QUEUE } from '../queue/queues';

export type VerificationJobName = 'settle' | 'expire' | 'process';
export interface VerificationJob {
  verificationId: string; // BigInt sérialisé
}

/** Planification des étapes d'une vérification dans BullMQ. */
@Injectable()
export class VerificationScheduler {
  constructor(
    @InjectQueue(VERIFICATION_QUEUE)
    private readonly queue: Queue<VerificationJob, void, VerificationJobName>,
    private readonly config: AppConfig,
  ) {}

  /** (Re)lance l'attente courte après chaque pièce reçue. */
  async settle(id: bigint): Promise<void> {
    await this.replace('settle', id, {
      delay: this.config.get('PROOF_SETTLE_SECONDS') * 1000,
    });
  }

  /** Fin de la fenêtre de regroupement (SESSION_WINDOW_MINUTES). */
  async expire(id: bigint): Promise<void> {
    await this.replace('expire', id, {
      delay: this.config.get('SESSION_WINDOW_MINUTES') * 60_000,
    });
  }

  async process(id: bigint): Promise<void> {
    await Promise.all([this.cancel('settle', id), this.cancel('expire', id)]);
    await this.queue.add(
      'process',
      { verificationId: id.toString() },
      {
        jobId: jobId('process', id),
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
  }

  async cancelAll(id: bigint): Promise<void> {
    await Promise.all([this.cancel('settle', id), this.cancel('expire', id)]);
  }

  private async replace(
    name: VerificationJobName,
    id: bigint,
    opts: JobsOptions,
  ): Promise<void> {
    await this.cancel(name, id);
    await this.queue.add(
      name,
      { verificationId: id.toString() },
      {
        ...opts,
        jobId: jobId(name, id),
        attempts: 3,
        backoff: { type: 'fixed', delay: 2000 },
        // Indispensable : un jobId déjà présent (même terminé) serait ignoré par BullMQ
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  private async cancel(name: VerificationJobName, id: bigint): Promise<void> {
    // remove() ne fait rien si le job est en cours d'exécution : sans danger
    await this.queue.remove(jobId(name, id));
  }
}

function jobId(name: VerificationJobName, id: bigint): string {
  return `${name}_${id}`;
}
