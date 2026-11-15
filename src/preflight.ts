import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

/**
 * Contrôle des dépendances avant le démarrage de Nest.
 * Sans cela, un Redis arrêté bloque le démarrage indéfiniment, sans message.
 * Aucune valeur secrète n'est affichée (seulement hôte et port).
 */
export async function preflight(env: NodeJS.ProcessEnv): Promise<void> {
  const errors: string[] = [];

  const redisUrl = env.REDIS_URL;
  if (redisUrl) {
    const redis = new Redis(redisUrl, {
      lazyConnect: true,
      connectTimeout: 3000,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    redis.on('error', () => undefined);
    try {
      await redis.connect();
      await redis.ping();
    } catch {
      errors.push(
        `Redis injoignable (${hostOf(redisUrl)}). Dans Laragon : Menu > Redis > Démarrer.`,
      );
    } finally {
      redis.disconnect();
    }
  }

  const dbUrl = env.DATABASE_URL;
  if (dbUrl) {
    const prisma = new PrismaClient({ datasourceUrl: dbUrl, log: [] });
    try {
      await withTimeout(prisma.$queryRaw`SELECT 1`, 5000);
    } catch {
      errors.push(
        `MySQL injoignable (${hostOf(dbUrl)}). Dans Laragon : « Démarrer tout », puis vérifier DATABASE_URL.`,
      );
    } finally {
      await prisma.$disconnect().catch(() => undefined);
    }
  }

  if (errors.length) {
    console.error('\n❌ Démarrage impossible :');
    for (const e of errors) console.error(`   - ${e}`);
    console.error('');
    process.exit(1);
  }
}

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || 'port par défaut'}`;
  } catch {
    return 'URL invalide';
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms),
    ),
  ]);
}
