import { MaintenanceProcessor } from './maintenance.processor';

const NOW = new Date('2026-11-13T03:00:00Z');

function setup() {
  const items = [
    {
      id: 1n,
      storageKey: 'proofs/1/1/a.jpg',
      receivedAt: new Date('2026-10-01'),
    },
    {
      id: 2n,
      storageKey: 'proofs/1/2/b.jpg',
      receivedAt: new Date('2026-11-10'),
    },
  ];
  const updated: Record<string, unknown> = {};
  const prisma = {
    verificationItem: {
      updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
      findMany: jest.fn(({ where }) =>
        Promise.resolve(
          items.filter(
            (i) => i.receivedAt < where.receivedAt.lt && !updated[String(i.id)],
          ),
        ),
      ),
      update: jest.fn(({ where, data }) => {
        updated[String(where.id)] = data;
        return Promise.resolve();
      }),
    },
    inboundEvent: { deleteMany: jest.fn() },
    verification: { count: jest.fn(() => Promise.resolve(2)) },
  };
  const storage = { delete: jest.fn(() => Promise.resolve()) };
  const audit = { log: jest.fn() };
  const wa = { sendText: jest.fn(() => Promise.resolve()) };
  const config = {
    get: (k: string) =>
      ({ IMAGE_RETENTION_DAYS: 30, ADMIN_WA_ID: '221700000000' })[k],
  };
  const processor = new MaintenanceProcessor(
    {} as never,
    prisma as never,
    storage as never,
    config as never,
    wa as never,
    audit as never,
  );
  return { processor, storage, updated, wa, audit };
}

describe('MaintenanceProcessor', () => {
  it('supprime seulement les images plus vieilles que IMAGE_RETENTION_DAYS', async () => {
    const { processor, storage, updated } = setup();
    const res = await processor.purgeImages(NOW);
    expect(res).toEqual({ images: 1 });
    expect(storage.delete).toHaveBeenCalledWith('proofs/1/1/a.jpg');
    expect(storage.delete).not.toHaveBeenCalledWith('proofs/1/2/b.jpg');
    expect(updated['1']).toMatchObject({ storageKey: null });
  });

  it('alerte si la file de relecture attend depuis plus de 2 h', async () => {
    const { processor, wa, audit } = setup();
    expect(await processor.reviewBacklog(NOW)).toEqual({ waiting: 2 });
    expect(audit.log).toHaveBeenCalledWith(
      'system',
      'alert.review_backlog',
      'review',
      {
        waiting: 2,
      },
    );
    expect(wa.sendText).toHaveBeenCalled();
  });
});
