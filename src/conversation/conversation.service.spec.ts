import type { Seller } from '@prisma/client';
import type { InboundMessage } from '../whatsapp/whatsapp.types';
import { deletedWaId } from './account.service';
import { ConversationService } from './conversation.service';
import { MSG } from './messages.fr';

/** Fausse base Prisma en mémoire, limitée à ce que le service utilise. */
function fakePrisma() {
  const sellers = new Map<string, Seller>();
  const consents: Array<{ sellerId: bigint; docVersion: string }> = [];
  let nextId = 1n;
  const byId = (id: bigint) => [...sellers.values()].find((s) => s.id === id)!;

  const prisma = {
    seller: {
      findUnique: jest.fn(({ where }) =>
        Promise.resolve(
          sellers.has(where.waId) ? { ...sellers.get(where.waId) } : null,
        ),
      ),
      upsert: jest.fn(({ where, create, update }) => {
        const existing = sellers.get(where.waId);
        if (existing) {
          Object.assign(existing, update);
          return Promise.resolve({ ...existing });
        }
        const s = {
          id: nextId++,
          plan: 'trial',
          paidUntil: null,
          state: 'new',
          stopped: false,
          blocked: false,
          createdAt: new Date(),
          deletedAt: null,
          displayName: null,
          ...create,
        } as Seller;
        sellers.set(s.waId, s);
        return Promise.resolve({ ...s });
      }),
      update: jest.fn(({ where, data }) => {
        const s = byId(where.id);
        Object.assign(s, data);
        return Promise.resolve({ ...s });
      }),
    },
    consent: {
      create: jest.fn(({ data }) => {
        consents.push(data);
        return Promise.resolve(data);
      }),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return { prisma, sellers, consents };
}

const WA = '221770000001';
let seq = 0;
const text = (body: string): InboundMessage => ({
  id: `wamid.${++seq}`,
  from: WA,
  timestamp: '0',
  type: 'text',
  text: { body },
});
const ofType = (type: string): InboundMessage => ({
  id: `wamid.${++seq}`,
  from: WA,
  timestamp: '0',
  type,
});

function setup() {
  const db = fakePrisma();
  const sent: string[] = [];
  const wa = { sendText: jest.fn((_to: string, b: string) => sent.push(b)) };
  const config = {
    get: (k: string) =>
      ({
        FREE_TRIALS: 5,
        TERMS_VERSION: 'v1',
        TERMS_URL: undefined,
        HASH_SECRET: 's'.repeat(32),
      })[k],
  };
  const audit = { log: jest.fn() };
  const notifier = { alert: jest.fn() };
  const intake = { receive: jest.fn() };
  const account = {
    history: jest.fn(() => Promise.resolve('historique')),
    subscription: jest.fn(() => Promise.resolve('abonnement')),
  };
  const service = new ConversationService(
    db.prisma as never,
    config as never,
    wa as never,
    audit as never,
    notifier as never,
    intake as never,
    account as never,
  );
  return { service, sent, db, notifier, intake };
}

describe('ConversationService', () => {
  it('premier message : crée le vendeur avec 5 essais, accueil + conditions', async () => {
    const { service, sent, db } = setup();
    await service.handle(text('Bonjour'), 'Awa');

    const seller = db.sellers.get(WA)!;
    expect(seller.freeLeft).toBe(5);
    expect(seller.state).toBe('welcomed');
    expect(sent[0]).toContain('5 premiers tests');
    expect(sent[0]).toContain('jamais ton code secret');
    expect(sent[1]).toContain('Réponds OUI');
  });

  it('enregistre la version acceptée des conditions puis invite à envoyer', async () => {
    const { service, sent, db } = setup();
    await service.handle(text('Bonjour'));
    await service.handle(text('oui'));

    expect(db.consents).toEqual([
      expect.objectContaining({ docVersion: 'v1' }),
    ]);
    expect(db.sellers.get(WA)!.state).toBe('active');
    expect(sent.at(-1)).toBe(MSG.termsAccepted);
  });

  it('ne traite pas de preuve tant que les conditions ne sont pas acceptées', async () => {
    const { service, sent, intake } = setup();
    await service.handle(text('Bonjour'));
    await service.handle(ofType('image'));

    expect(intake.receive).not.toHaveBeenCalled();
    expect(sent.at(-1)).toContain('Réponds OUI');
  });

  it('vendeur actif : transmet texte et image à la réception des preuves', async () => {
    const { service, intake } = setup();
    await service.handle(text('Bonjour'));
    await service.handle(text('OUI'));
    await service.handle(ofType('image'));
    await service.handle(text('Vous avez reçu 5000 F de ...'));

    expect(intake.receive).toHaveBeenCalledTimes(2);
  });

  it.each(['audio', 'video', 'document', 'sticker'])(
    'format %p refusé avec explication',
    async (type) => {
      const { service, sent, intake } = setup();
      await service.handle(text('Bonjour'));
      await service.handle(text('OUI'));
      await service.handle(ofType(type));

      expect(intake.receive).not.toHaveBeenCalled();
      expect(sent.at(-1)).toBe(MSG.unsupported);
    },
  );

  it('STOP arrête, puis seul REPRENDRE réactive', async () => {
    const { service, sent, db, intake } = setup();
    await service.handle(text('Bonjour'));
    await service.handle(text('OUI'));
    await service.handle(text('Stop'));
    expect(db.sellers.get(WA)!.stopped).toBe(true);
    expect(sent.at(-1)).toBe(MSG.stop);

    await service.handle(ofType('image'));
    expect(intake.receive).not.toHaveBeenCalled();
    expect(sent.at(-1)).toBe(MSG.stoppedReminder);

    await service.handle(text('reprendre'));
    expect(db.sellers.get(WA)!.stopped).toBe(false);
    expect(sent.at(-1)).toBe(MSG.resumed);
  });

  it("HUMAIN prévient l'administrateur sans changer l'état", async () => {
    const { service, sent, db, notifier } = setup();
    await service.handle(text('Bonjour'));
    await service.handle(text('humain'));

    expect(notifier.alert).toHaveBeenCalledWith(
      'human_requested',
      expect.objectContaining({ waId: WA }),
    );
    expect(sent.at(-1)).toBe(MSG.human);
    expect(db.sellers.get(WA)!.state).toBe('welcomed');
  });

  it('numéro bloqué : aucune réponse', async () => {
    const { service, sent, db } = setup();
    await service.handle(text('Bonjour'));
    db.sellers.get(WA)!.blocked = true;
    sent.length = 0;

    await service.handle(text('AIDE'));
    expect(sent).toHaveLength(0);
  });
});

describe('ConversationService — compte', () => {
  it('HISTORIQUE et ABONNEMENT répondent pour un vendeur actif', async () => {
    const { service, sent } = setup();
    await service.handle(text('Bonjour'));
    await service.handle(text('OUI'));
    await service.handle(text('historique'));
    await service.handle(text('Abonnement'));
    expect(sent.slice(-2)).toEqual(['historique', 'abonnement']);
  });

  it('un numéro qui a supprimé ses données revient sans essais gratuits', async () => {
    const { service, db, sent } = setup();
    const ghost = deletedWaId(WA, 's'.repeat(32));
    db.sellers.set(ghost, { id: 99n, waId: ghost } as Seller);

    await service.handle(text('Bonjour'));
    expect(db.sellers.get(WA)!.freeLeft).toBe(0);
    expect(sent[0]).toContain('0 premiers tests');
  });
});
