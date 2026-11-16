import { randomBytes } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';
import { migrateTestDatabase, testDatabaseUrl } from './helpers/test-db';

/** Stockage des images en base (STORAGE_BACKEND=db), sur MySQL réel (siga_test). */
const url = testDatabaseUrl();
const describeDb = url ? describe : describe.skip;

describeDb('StorageService en base (MySQL)', () => {
  let prisma: PrismaService;
  let storage: StorageService;
  const run = Date.now().toString(36);

  beforeAll(async () => {
    migrateTestDatabase(url!);
    process.env.DATABASE_URL = url!;
    prisma = new PrismaService();
    await prisma.onModuleInit();
    storage = new StorageService(
      {
        get: (k: string) =>
          ({ STORAGE_BACKEND: 'db', STORAGE_LOCAL_DIR: '.' })[k],
      } as never,
      prisma,
    );
  }, 120_000);

  afterAll(async () => {
    await prisma?.mediaBlob.deleteMany({
      where: { key: { startsWith: `test/${run}/` } },
    });
    await prisma?.$disconnect();
  });

  it('image de 1 Mo : écrite et relue à l’identique (MEDIUMBLOB)', async () => {
    const image = randomBytes(1024 * 1024);
    await storage.put(`test/${run}/a.jpg`, image, 'image/jpeg');
    const back = await storage.get(`test/${run}/a.jpg`);
    expect(back.length).toBe(image.length);
    expect(back.equals(image)).toBe(true);
  });

  it('réécriture de la même clé, puis suppression', async () => {
    await storage.put(`test/${run}/b.png`, Buffer.from('v1'), 'image/png');
    await storage.put(`test/${run}/b.png`, Buffer.from('v2'), 'image/png');
    expect((await storage.get(`test/${run}/b.png`)).toString()).toBe('v2');
    await storage.delete(`test/${run}/b.png`);
    await expect(storage.get(`test/${run}/b.png`)).rejects.toThrow(
      'Image introuvable',
    );
  });

  it('santé OK', async () => {
    expect(await storage.isHealthy()).toBe(true);
  });
});
