import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Base MySQL de test : même serveur que DATABASE_URL (.env), base « siga_test ».
 * Les migrations y sont appliquées (prisma migrate deploy, non destructif) ; les tests
 * utilisent des identifiants uniques par exécution, sans jamais vider la base.
 */
export function testDatabaseUrl(): string | null {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    try {
      const env = readFileSync(join(__dirname, '../../.env'), 'utf8');
      const line = env
        .split(/\r?\n/)
        .find((l) => l.startsWith('DATABASE_URL='));
      url = line?.slice('DATABASE_URL='.length).trim();
    } catch {
      return null;
    }
  }
  if (!url) return null;
  const u = new URL(url);
  u.pathname = '/siga_test';
  return u.toString();
}

export function migrateTestDatabase(url: string): void {
  execSync('npx prisma migrate deploy', {
    cwd: join(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
