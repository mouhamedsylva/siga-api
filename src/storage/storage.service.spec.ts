import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageService } from './storage.service';

const config = (env: Record<string, unknown>) => ({
  get: (k: string) => env[k],
});

describe('StorageService (disque local)', () => {
  let dir: string;
  let storage: StorageService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'siga-storage-'));
    storage = new StorageService(
      config({ STORAGE_LOCAL_DIR: dir, STORAGE_BACKEND: 'auto' }) as never,
      {} as never,
    );
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('écrit, relit puis supprime une image', async () => {
    await storage.put('proofs/1/2/a.jpg', Buffer.from('img'), 'image/jpeg');
    expect((await storage.get('proofs/1/2/a.jpg')).toString()).toBe('img');
    await storage.delete('proofs/1/2/a.jpg');
    await expect(storage.get('proofs/1/2/a.jpg')).rejects.toThrow();
  });

  it('refuse une clé qui sort du dossier', async () => {
    await expect(
      storage.put('../../evil.txt', Buffer.from('x'), 'text/plain'),
    ).rejects.toThrow('Clé de stockage invalide');
  });

  it('est en bonne santé', async () => {
    expect(storage.backend).toBe('local');
    expect(await storage.isHealthy()).toBe(true);
  });
});

describe('StorageService (base de données)', () => {
  function setup() {
    const rows = new Map<string, { mimeType: string; data: Uint8Array }>();
    const prisma = {
      mediaBlob: {
        upsert: jest.fn(({ where, create }) => {
          rows.set(where.key, { mimeType: create.mimeType, data: create.data });
          return Promise.resolve();
        }),
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(
            rows.has(where.key) ? { data: rows.get(where.key)!.data } : null,
          ),
        ),
        deleteMany: jest.fn(({ where }) => {
          rows.delete(where.key);
          return Promise.resolve({ count: 1 });
        }),
        count: jest.fn(() => Promise.resolve(rows.size)),
      },
    };
    const storage = new StorageService(
      config({
        STORAGE_LOCAL_DIR: './storage',
        STORAGE_BACKEND: 'db',
      }) as never,
      prisma as never,
    );
    return { storage, rows, prisma };
  }

  it('choisit le mode db', () => {
    expect(setup().storage.backend).toBe('db');
  });

  it('écrit, relit puis supprime une image en base', async () => {
    const { storage, rows } = setup();
    await storage.put('proofs/1/2/a.jpg', Buffer.from('image'), 'image/jpeg');
    expect(rows.get('proofs/1/2/a.jpg')?.mimeType).toBe('image/jpeg');
    const back = await storage.get('proofs/1/2/a.jpg');
    expect(Buffer.isBuffer(back)).toBe(true);
    expect(back.toString()).toBe('image');
    await storage.delete('proofs/1/2/a.jpg');
    await expect(storage.get('proofs/1/2/a.jpg')).rejects.toThrow(
      'Image introuvable',
    );
  });

  it('refuse une clé invalide', async () => {
    await expect(
      setup().storage.put('../x', Buffer.from('x'), 'image/jpeg'),
    ).rejects.toThrow('Clé de stockage invalide');
  });

  it('santé : interroge la table', async () => {
    const { storage, prisma } = setup();
    expect(await storage.isHealthy()).toBe(true);
    prisma.mediaBlob.count.mockRejectedValueOnce(new Error('down'));
    expect(await storage.isHealthy()).toBe(false);
  });
});

describe('StorageService (S3)', () => {
  it('exige toutes les variables S3', () => {
    expect(
      () =>
        new StorageService(
          config({ STORAGE_BACKEND: 's3', STORAGE_LOCAL_DIR: '.' }) as never,
          {} as never,
        ),
    ).toThrow(/STORAGE_ENDPOINT/);
  });
});
