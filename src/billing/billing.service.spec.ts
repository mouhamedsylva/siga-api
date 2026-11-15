import type { Seller } from '@prisma/client';
import { addMonths, BillingService, fmt } from './billing.service';

const config = {
  get: (k: string) =>
    ({
      FREE_TRIALS: 5,
      FOUNDER_PRICE: 2000,
      STANDARD_PRICE: 3000,
      FOUNDER_SLOTS: 20,
      PAYMENT_INSTRUCTIONS: 'Paie au 77 000 00 00.',
    })[k],
};

function setup(foundersTaken = 0) {
  const prisma = {
    payment: {
      groupBy: jest.fn(() =>
        Promise.resolve(
          Array.from({ length: foundersTaken }, (_, i) => ({ sellerId: i })),
        ),
      ),
    },
  };
  return new BillingService(prisma as never, config as never);
}

const NOW = new Date('2026-11-13T12:00:00Z');
const seller = (over: Partial<Seller>) =>
  ({ plan: 'trial', freeLeft: 5, paidUntil: null, ...over }) as Seller;

describe('BillingService', () => {
  it('droits : abonnement actif > essais > aucun', () => {
    const b = setup();
    expect(
      b.entitlement(seller({ paidUntil: new Date('2026-12-01') }), NOW),
    ).toBe('subscription');
    expect(b.entitlement(seller({ freeLeft: 1 }), NOW)).toBe('trial');
    expect(b.entitlement(seller({ freeLeft: 0 }), NOW)).toBe('none');
    // Abonnement expiré en cours de journée : même comportement que les essais épuisés
    expect(
      b.entitlement(
        seller({ freeLeft: 0, paidUntil: new Date('2026-11-13T11:59:00Z') }),
        NOW,
      ),
    ).toBe('none');
  });

  it('offre fondateur avec compteur de places', async () => {
    const msg = await setup(17).offerMessage(seller({ freeLeft: 0 }));
    expect(msg).toContain('5 tests gratuits');
    expect(msg).toContain('2 000 FCFA le premier mois');
    expect(msg).toContain('3 places restantes');
    expect(msg).toContain('Paie au 77 000 00 00.');
  });

  it('plus de place fondateur : tarif standard seul', async () => {
    const msg = await setup(20).offerMessage(seller({ freeLeft: 0 }));
    expect(msg).not.toContain('fondateur');
    expect(msg).toContain('3 000 FCFA par mois');
  });

  it('abonnement expiré : message adapté', async () => {
    const msg = await setup().offerMessage(
      seller({ plan: 'standard', freeLeft: 0 }),
    );
    expect(msg).toContain('arrivé à échéance');
  });
});

describe('addMonths', () => {
  it('ajoute un mois', () => {
    expect(addMonths(new Date('2026-11-13T10:00:00Z'), 1).toISOString()).toBe(
      '2026-12-13T10:00:00.000Z',
    );
  });
  it('31 janvier + 1 mois = fin février', () => {
    expect(addMonths(new Date('2027-01-31T00:00:00Z'), 1).toISOString()).toBe(
      '2027-02-28T00:00:00.000Z',
    );
  });
});

describe('fmt', () => {
  it('espace les milliers', () => expect(fmt(15000)).toBe('15 000'));
});
