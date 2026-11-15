import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { INBOUND_QUEUE } from '../queue/queues';
import { StorageService } from '../storage/storage.service';

/** Contrôle de disponibilité public, sans aucune donnée métier (§10). */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue(INBOUND_QUEUE) private readonly queue: Queue,
  ) {}

  @Get()
  async check(@Res() res: Response): Promise<void> {
    const [db, queue, storage] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.queue.client
        .then((c) => (c as unknown as { ping(): Promise<string> }).ping())
        .then(() => true)
        .catch(() => false),
      this.storage.isHealthy(),
    ]);
    const ok = db && queue && storage;
    res
      .status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
      .json({ status: ok ? 'ok' : 'degraded', db, queue, storage });
  }
}
