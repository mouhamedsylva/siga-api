import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig } from '../config/app-config.service';

/**
 * Limitation de débit par numéro (§12) : fenêtre fixe d'une minute dans Redis.
 * Freine les fraudeurs qui testent l'outil en rafale.
 */
@Injectable()
export class RateLimiter implements OnModuleDestroy {
  private redis?: Redis;

  constructor(private readonly config: AppConfig) {}

  private client(): Redis {
    this.redis ??= new Redis(this.config.get('REDIS_URL'), {
      maxRetriesPerRequest: 2,
    });
    return this.redis;
  }

  /** Retourne le nombre de messages de ce numéro dans la minute, et s'il dépasse la limite. */
  async hit(waId: string): Promise<{ count: number; limited: boolean }> {
    const key = `siga:rl:${waId}:${Math.floor(Date.now() / 60_000)}`;
    const redis = this.client();
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 90);
    return { count, limited: count > this.config.get('RATE_LIMIT_PER_MINUTE') };
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit();
  }
}
