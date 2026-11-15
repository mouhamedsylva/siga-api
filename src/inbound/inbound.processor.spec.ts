import { Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import { eventKey } from '../common/hmac.util';
import type { InboundJob } from '../whatsapp/whatsapp.types';
import { InboundProcessor } from './inbound.processor';

function setup() {
  const seen = new Set<string>();
  const outbound = new Map<string, { status: string }>();
  const prisma = {
    inboundEvent: {
      create: jest.fn(({ data }: { data: { id: string } }) => {
        if (seen.has(data.id)) {
          return Promise.reject(
            new Prisma.PrismaClientKnownRequestError('dup', {
              code: 'P2002',
              clientVersion: 'test',
            }),
          );
        }
        seen.add(data.id);
        return Promise.resolve(data);
      }),
      delete: jest.fn(({ where }: { where: { id: string } }) => {
        seen.delete(where.id);
        return Promise.resolve();
      }),
    },
    outboundMessage: {
      findUnique: jest.fn(({ where }) =>
        Promise.resolve(outbound.get(where.wamid) ?? null),
      ),
      update: jest.fn(({ where, data }) => {
        outbound.set(where.wamid, data);
        return Promise.resolve();
      }),
    },
  };
  const conversation = { handle: jest.fn() };
  let hits = 0;
  const rateLimiter = {
    limit: 3,
    hit: jest.fn(() => {
      hits++;
      return Promise.resolve({ count: hits, limited: hits > 3 });
    }),
  };
  const wa = { sendText: jest.fn(() => Promise.resolve()) };
  const config = { get: () => 3 };
  const processor = new InboundProcessor(
    prisma as never,
    conversation as never,
    rateLimiter as never,
    wa as never,
    config as never,
  );
  return { processor, conversation, outbound, seen, wa };
}

const messageJob = (id: string): Job<InboundJob> =>
  ({
    attemptsMade: 0,
    data: {
      kind: 'message',
      message: { id, from: '221', timestamp: '0', type: 'text' },
    },
  }) as Job<InboundJob>;

const statusJob = (id: string, status: string): Job<InboundJob> =>
  ({
    attemptsMade: 0,
    data: {
      kind: 'status',
      status: { id, status, timestamp: '0', recipient_id: '221' },
    },
  }) as Job<InboundJob>;

describe('InboundProcessor', () => {
  it('un message rejoué par Meta ne produit aucun second traitement', async () => {
    const { processor, conversation } = setup();
    await processor.process(messageJob('wamid.A'));
    await processor.process(messageJob('wamid.A'));
    expect(conversation.handle).toHaveBeenCalledTimes(1);
  });

  it("libère l'identifiant si le traitement échoue, pour la nouvelle tentative", async () => {
    const { processor, conversation, seen } = setup();
    conversation.handle.mockRejectedValueOnce(new Error('panne'));
    await expect(processor.process(messageJob('wamid.B'))).rejects.toThrow();
    expect(seen.has(eventKey('wamid.B'))).toBe(false);

    await processor.process(messageJob('wamid.B'));
    expect(conversation.handle).toHaveBeenCalledTimes(2);
  });

  it('enregistre les accusés sans jamais régresser', async () => {
    const { processor, outbound } = setup();
    outbound.set('out.1', { status: 'sent' });
    await processor.process(statusJob('out.1', 'read'));
    await processor.process(statusJob('out.1', 'delivered'));
    expect(outbound.get('out.1')!.status).toBe('read');
  });

  it('au-delà de la limite : messages ignorés, un seul avertissement', async () => {
    const { processor, conversation, wa } = setup();
    for (const id of ['r1', 'r2', 'r3', 'r4', 'r5']) {
      await processor.process(messageJob(id));
    }
    expect(conversation.handle).toHaveBeenCalledTimes(3);
    expect(wa.sendText).toHaveBeenCalledTimes(1);
  });
});
