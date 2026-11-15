import type { Seller } from '@prisma/client';
import { MSG } from '../conversation/messages.fr';
import type { InboundMessage } from '../whatsapp/whatsapp.types';
import { ProofIntakeService } from './proof-intake.service';
import { VerificationProcessor } from './verification.processor';

/**
 * Réception des pièces + étapes settle / expire, avec une fausse base
 * en mémoire et une file simulée (les jobs sont exécutés à la main).
 */
function setup() {
  type V = { id: bigint; sellerId: bigint; status: string; createdAt: Date };
  type Item = { verificationId: bigint; kind: string; wamid: string };
  const verifications: V[] = [];
  const items: Item[] = [];
  let nextId = 1n;

  const seller = {
    id: 7n,
    waId: '221770000001',
    stopped: false,
    blocked: false,
  } as Seller;

  const prisma = {
    verification: {
      findFirst: jest.fn(({ where }) =>
        Promise.resolve(
          verifications.find(
            (v) =>
              v.sellerId === where.sellerId &&
              v.status === where.status &&
              v.createdAt >= where.createdAt.gte,
          ) ?? null,
        ),
      ),
      findUnique: jest.fn(({ where }) => {
        const v = verifications.find((x) => x.id === where.id);
        if (!v) return Promise.resolve(null);
        return Promise.resolve({
          ...v,
          seller,
          items: items.filter((i) => i.verificationId === v.id),
        });
      }),
      create: jest.fn(({ data }) => {
        const v = {
          id: nextId++,
          status: 'pending',
          createdAt: new Date(),
          ...data,
        };
        verifications.push(v);
        return Promise.resolve(v);
      }),
      updateMany: jest.fn(({ where, data }) => {
        const v = verifications.find(
          (x) => x.id === where.id && x.status === where.status,
        );
        if (v) Object.assign(v, data);
        return Promise.resolve({ count: v ? 1 : 0 });
      }),
      delete: jest.fn(({ where }) => {
        verifications.splice(
          verifications.findIndex((v) => v.id === where.id),
          1,
        );
        return Promise.resolve();
      }),
    },
    verificationItem: {
      create: jest.fn(({ data }) => {
        items.push(data);
        return Promise.resolve(data);
      }),
    },
  };

  const sent: string[] = [];
  const wa = {
    sendText: jest.fn((_to: string, body: string) => {
      sent.push(body);
      return Promise.resolve();
    }),
    downloadMedia: jest.fn(() =>
      Promise.resolve({ data: Buffer.from('img'), mimeType: 'image/jpeg' }),
    ),
  };
  const storage = { put: jest.fn(() => Promise.resolve()) };
  const scheduler = {
    settle: jest.fn(),
    expire: jest.fn(),
    process: jest.fn(),
    cancelAll: jest.fn(),
  };
  const notifier = { alert: jest.fn() };
  const billing = {
    entitlement: jest.fn(() => 'trial'),
    offerMessage: jest.fn(() => Promise.resolve('OFFRE')),
  };
  const pipeline = { run: jest.fn() };
  const config = {
    get: (k: string) =>
      ({ SESSION_WINDOW_MINUTES: 10, MAX_IMAGE_BYTES: 1000 })[k],
  };

  const intake = new ProofIntakeService(
    prisma as never,
    config as never,
    wa as never,
    storage as never,
    scheduler as never,
    notifier as never,
    billing as never,
  );
  const processor = new VerificationProcessor(
    prisma as never,
    wa as never,
    scheduler as never,
    pipeline as never,
    notifier as never,
  );
  const run = (name: string, id = 1n) =>
    processor.process({
      name,
      data: { verificationId: id.toString() },
    } as never);

  return {
    seller,
    intake,
    run,
    verifications,
    items,
    sent,
    wa,
    storage,
    scheduler,
    notifier,
    billing,
  };
}

describe('Droits du vendeur', () => {
  it('essais épuisés : offre envoyée, aucune vérification ni téléchargement', async () => {
    const t = setup();
    t.billing.entitlement.mockReturnValue('none');
    await t.intake.receive(t.seller, image());
    expect(t.verifications).toHaveLength(0);
    expect(t.wa.downloadMedia).not.toHaveBeenCalled();
    expect(t.sent).toEqual(['OFFRE']);
  });
});

let seq = 0;
const image = (mime = 'image/jpeg'): InboundMessage => ({
  id: `wamid.${++seq}`,
  from: '221770000001',
  timestamp: '0',
  type: 'image',
  image: { id: `media.${seq}`, mime_type: mime },
});
const text = (body: string): InboundMessage => ({
  id: `wamid.${++seq}`,
  from: '221770000001',
  timestamp: '0',
  type: 'text',
  text: { body },
});
const SMS = 'Vous avez reçu 15000F de Moussa. Ref: AB12CD34. Solde 20000F';

describe('Réception des preuves', () => {
  it('capture puis SMS : une seule vérification, analyse lancée', async () => {
    const t = setup();
    await t.intake.receive(t.seller, image());
    await t.intake.receive(t.seller, text(SMS));

    expect(t.verifications).toHaveLength(1);
    expect(t.items.map((i) => i.kind)).toEqual(['image', 'text']);
    expect(t.storage.put).toHaveBeenCalledWith(
      expect.stringMatching(/^proofs\/7\/1\/[0-9a-f]{16}\.jpg$/),
      expect.any(Buffer),
      'image/jpeg',
    );
    expect(t.scheduler.expire).toHaveBeenCalledTimes(1);
    expect(t.scheduler.settle).toHaveBeenCalledTimes(2);

    await t.run('settle');
    expect(t.verifications[0].status).toBe('processing');
    expect(t.scheduler.process).toHaveBeenCalledWith(1n);
    expect(t.sent).toEqual([MSG.received]);
  });

  it('capture seule : demande le SMS, sans lancer d’analyse', async () => {
    const t = setup();
    await t.intake.receive(t.seller, image());
    await t.run('settle');

    expect(t.verifications[0].status).toBe('pending');
    expect(t.scheduler.process).not.toHaveBeenCalled();
    expect(t.sent).toEqual([MSG.missingSms]);
  });

  it('SMS seul : demande la capture', async () => {
    const t = setup();
    await t.intake.receive(t.seller, text(SMS));
    await t.run('settle');
    expect(t.sent).toEqual([MSG.missingCapture]);
  });

  it('fin de fenêtre avec une seule pièce : analyse quand même (R01 tranchera)', async () => {
    const t = setup();
    await t.intake.receive(t.seller, image());
    await t.run('expire');
    expect(t.verifications[0].status).toBe('processing');
  });

  it('trop de pièces : rejet sans analyse et message « une par une »', async () => {
    const t = setup();
    await t.intake.receive(t.seller, image());
    await t.intake.receive(t.seller, image());
    await t.intake.receive(t.seller, image());
    await t.run('settle');

    expect(t.verifications[0].status).toBe('rejected');
    expect(t.scheduler.process).not.toHaveBeenCalled();
    expect(t.sent).toEqual([MSG.oneAtATime]);
  });

  it('un texte qui n’est pas un SMS ne crée pas de vérification', async () => {
    const t = setup();
    await t.intake.receive(t.seller, text('bonjour'));
    expect(t.verifications).toHaveLength(0);
    expect(t.sent).toEqual([MSG.notAProof]);
  });

  it('image dans un format refusé (gif)', async () => {
    const t = setup();
    await t.intake.receive(t.seller, image('image/gif'));
    expect(t.wa.downloadMedia).not.toHaveBeenCalled();
    expect(t.sent).toEqual([MSG.unsupported]);
  });

  it('téléchargement du média impossible : redemande, rien de créé', async () => {
    const t = setup();
    t.wa.downloadMedia.mockRejectedValueOnce(new Error('expired'));
    await t.intake.receive(t.seller, image());
    expect(t.verifications).toHaveLength(0);
    expect(t.sent).toEqual([MSG.mediaError]);
  });

  it('stockage en panne : excuse et alerte administrateur', async () => {
    const t = setup();
    t.storage.put.mockRejectedValueOnce(new Error('down'));
    await t.intake.receive(t.seller, image());
    expect(t.items).toHaveLength(0);
    expect(t.notifier.alert).toHaveBeenCalledWith('technical_error', t.seller, {
      stage: 'storage',
    });
    expect(t.sent).toEqual([MSG.technicalError]);
  });

  it('settle rejoué après démarrage : aucun second lancement', async () => {
    const t = setup();
    await t.intake.receive(t.seller, image());
    await t.intake.receive(t.seller, text(SMS));
    await t.run('settle');
    await t.run('settle');
    await t.run('expire');
    expect(t.scheduler.process).toHaveBeenCalledTimes(1);
  });
});
