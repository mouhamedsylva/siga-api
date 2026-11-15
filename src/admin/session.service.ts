import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { randomBytes } from 'node:crypto';
import { AppConfig } from '../config/app-config.service';

const MAX_FAILURES = 5;
const LOCK_SECONDS = 15 * 60;

/**
 * Sessions du back-office dans Redis : identifiant aléatoire de 32 octets
 * → login, expiration glissante (SESSION_TTL_HOURS).
 * Gère aussi la limite de tentatives de connexion.
 */
@Injectable()
export class SessionService implements OnModuleDestroy {
  private redis?: Redis;

  constructor(private readonly config: AppConfig) {}

  private client(): Redis {
    this.redis ??= new Redis(this.config.get('REDIS_URL'), {
      maxRetriesPerRequest: 2,
    });
    return this.redis;
  }

  get ttlSeconds(): number {
    return Math.round(this.config.get('SESSION_TTL_HOURS') * 3600);
  }

  async create(login: string): Promise<string> {
    const id = randomBytes(32).toString('base64url');
    await this.client().set(key(id), login, 'EX', this.ttlSeconds);
    return id;
  }

  /** Login de la session, ou null si absente / expirée. Prolonge la session. */
  async get(id: string | undefined): Promise<string | null> {
    if (!id || !/^[A-Za-z0-9_-]{40,60}$/.test(id)) return null;
    const redis = this.client();
    const login = await redis.get(key(id));
    if (login) await redis.expire(key(id), this.ttlSeconds);
    return login;
  }

  async destroy(id: string | undefined): Promise<void> {
    if (id) await this.client().del(key(id));
  }

  /** Vrai si trop d'échecs récents pour ce couple adresse IP + login. */
  async isLocked(ip: string, login: string): Promise<boolean> {
    const n = Number(await this.client().get(failKey(ip, login)));
    return n >= MAX_FAILURES;
  }

  async recordFailure(ip: string, login: string): Promise<void> {
    const redis = this.client();
    const k = failKey(ip, login);
    const n = await redis.incr(k);
    if (n === 1) await redis.expire(k, LOCK_SECONDS);
  }

  async clearFailures(ip: string, login: string): Promise<void> {
    await this.client().del(failKey(ip, login));
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit();
  }
}

const key = (id: string) => `siga:sess:${id}`;
const failKey = (ip: string, login: string) =>
  `siga:login-fail:${ip}:${login.toLowerCase().slice(0, 40)}`;

export const SESSION_COOKIE = 'siga_admin';
/** En-tête exigé sur les requêtes du back-office qui modifient des données (anti-CSRF). */
export const ADMIN_HEADER = 'x-siga-admin';
