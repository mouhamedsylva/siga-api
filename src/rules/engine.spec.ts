import type { ParsedPiece } from '../extraction/parser';
import { evaluate, type RuleConfig, type RuleInput } from './engine';
import { buildVerdictMessage } from './verdict-message';

const NOW = new Date('2026-11-13T15:00:00Z');
const cfg: RuleConfig = {
  maxTimeGapMinutes: 10,
  futureToleranceMinutes: 5,
  ocrMinConfidence: 60,
};

const piece = (over: Partial<ParsedPiece> = {}): ParsedPiece => ({
  source: 'ocr',
  kind: 'capture',
  operator: 'wave',
  formatId: 'wave-capture-v1',
  amount: 15000,
  ref: 'TAB12CD34EF',
  datetime: new Date('2026-11-13T14:05:00Z'),
  sender: 'Moussa Diop',
  missing: [],
  confidence: 90,
  unreadable: false,
  ...over,
});
const capture = piece;
const sms = (over: Partial<ParsedPiece> = {}) =>
  piece({
    source: 'text',
    kind: 'sms',
    formatId: 'wave-sms-recu-v1',
    confidence: 100,
    ...over,
  });

const input = (over: Partial<RuleInput> = {}): RuleInput => ({
  capture: capture(),
  sms: sms(),
  history: { otherSeller: false, sameSeller: false },
  now: NOW,
  ...over,
});

const rules = (i: RuleInput) => evaluate(i, cfg).triggered.map((t) => t.rule);

describe('moteur de règles', () => {
  it('preuve cohérente : aucune règle, verdict cohérent, pas de relecture', () => {
    const d = evaluate(input(), cfg);
    expect(d.triggered).toEqual([]);
    expect(d.outcome).toBe('coherent');
    expect(d.needsReview).toBe(false);
  });

  describe('R01 SMS absent', () => {
    it('déclenchée → douteux', () => {
      const d = evaluate(input({ sms: null }), cfg);
      expect(rules(input({ sms: null }))).toContain('R01');
      expect(d.outcome).toBe('douteux');
    });
    it('non déclenchée avec SMS', () =>
      expect(rules(input())).not.toContain('R01'));
  });

  describe('R02 montants', () => {
    it('différents → faux probable', () => {
      const d = evaluate(input({ sms: sms({ amount: 150000 }) }), cfg);
      expect(d.outcome).toBe('faux_probable');
      expect(d.primary?.rule).toBe('R02');
    });
    it('identiques → rien', () => expect(rules(input())).not.toContain('R02'));
  });

  describe('R03 références', () => {
    it('très différentes → faux probable', () => {
      const d = evaluate(input({ sms: sms({ ref: 'XYZ98765432' }) }), cfg);
      expect(d.outcome).toBe('faux_probable');
      expect(d.primary?.rule).toBe('R03');
    });
    it('un caractère d’écart (faute de recopie) → douteux', () => {
      const d = evaluate(input({ sms: sms({ ref: 'TAB12CD34EG' }) }), cfg);
      expect(d.outcome).toBe('douteux');
    });
    it('confusion O/0 de l’OCR → aucune règle', () =>
      expect(
        rules(
          input({ capture: capture({ ref: 'TAB12CD34EF'.replace('0', 'O') }) }),
        ),
      ).not.toContain('R03'));
  });

  describe('R04 dates', () => {
    it('date dans le futur → douteux', () =>
      expect(
        rules(
          input({
            capture: capture({ datetime: new Date('2026-11-13T16:00:00Z') }),
          }),
        ),
      ).toContain('R04'));
    it('écart de 30 min entre capture et SMS → douteux', () =>
      expect(
        rules(
          input({ sms: sms({ datetime: new Date('2026-11-13T14:35:00Z') }) }),
        ),
      ).toContain('R04'));
    it('écart de 3 min → rien', () =>
      expect(
        rules(
          input({ sms: sms({ datetime: new Date('2026-11-13T14:08:00Z') }) }),
        ),
      ).not.toContain('R04'));
  });

  describe('R05 / R06 doublons', () => {
    it('vue chez un autre vendeur → faux probable', () => {
      const d = evaluate(
        input({ history: { otherSeller: true, sameSeller: false } }),
        cfg,
      );
      expect(d.outcome).toBe('faux_probable');
      expect(d.primary?.rule).toBe('R05');
    });
    it('déjà vérifiée par le même vendeur → avertissement seulement', () => {
      const d = evaluate(
        input({ history: { otherSeller: false, sameSeller: true } }),
        cfg,
      );
      expect(d.outcome).toBe('coherent');
      expect(d.triggered).toEqual([{ rule: 'R06', effect: 'warning' }]);
    });
    it('jamais vue → rien', () => {
      expect(rules(input())).not.toContain('R05');
      expect(rules(input())).not.toContain('R06');
    });
  });

  describe('R07 illisible / champ manquant', () => {
    it('capture illisible → rejet sans verdict', () => {
      const d = evaluate(
        input({ capture: capture({ unreadable: true }) }),
        cfg,
      );
      expect(d.outcome).toBe('rejected');
      expect(d.primary?.rule).toBe('R07');
    });
    it('référence manquante sur la capture → rejet', () =>
      expect(
        evaluate(
          input({ capture: capture({ ref: null, missing: ['ref'] }) }),
          cfg,
        ).outcome,
      ).toBe('rejected'));
    it('capture absente → rejet', () =>
      expect(evaluate(input({ capture: null }), cfg).outcome).toBe('rejected'));
    it('champ manquant dans le SMS → douteux (pas de rejet)', () =>
      expect(
        evaluate(input({ sms: sms({ ref: null, missing: ['ref'] }) }), cfg)
          .outcome,
      ).toBe('douteux'));
    it('capture complète → rien', () =>
      expect(rules(input())).not.toContain('R07'));
  });

  describe('R08 format inconnu', () => {
    it('capture inconnue → douteux + relecture', () => {
      const d = evaluate(
        input({
          capture: capture({
            kind: 'unknown',
            formatId: null,
            amount: null,
            ref: null,
          }),
        }),
        cfg,
      );
      expect(d.outcome).toBe('douteux');
      expect(d.needsReview).toBe(true);
      expect(d.triggered.map((t) => t.rule)).toContain('R08');
    });
    it('formats connus → rien', () =>
      expect(rules(input())).not.toContain('R08'));
  });

  describe('R09 expéditeur', () => {
    it('noms différents → douteux', () =>
      expect(rules(input({ sms: sms({ sender: 'Awa Ndiaye' }) }))).toContain(
        'R09',
      ));
    it('nom abrégé compatible → rien', () =>
      expect(rules(input({ sms: sms({ sender: 'M. DIOP' }) }))).not.toContain(
        'R09',
      ));
  });

  describe('R10 opérateurs', () => {
    it('différents → faux probable', () =>
      expect(
        evaluate(input({ sms: sms({ operator: 'orange_money' }) }), cfg)
          .outcome,
      ).toBe('faux_probable'));
    it('identiques → rien', () => expect(rules(input())).not.toContain('R10'));
  });

  describe('C01 confiance OCR', () => {
    it('faible → douteux + relecture', () => {
      const d = evaluate(input({ capture: capture({ confidence: 45 }) }), cfg);
      expect(d.outcome).toBe('douteux');
      expect(d.needsReview).toBe(true);
    });
    it('suffisante → rien', () => expect(rules(input())).not.toContain('C01'));
  });

  it('le plus sévère l’emporte : bloquant > doute', () => {
    const d = evaluate(
      input({ sms: sms({ amount: 1, sender: 'Awa Ndiaye' }) }),
      cfg,
    );
    expect(d.outcome).toBe('faux_probable');
  });

  it('garde-fou : jamais cohérent sans montant extrait', () => {
    const d = evaluate(
      input({ sms: sms({ formatId: null, kind: 'sms', amount: null }) }),
      cfg,
    );
    expect(d.outcome).not.toBe('coherent');
  });
});

describe('buildVerdictMessage', () => {
  it('cohérent : rappel de vérifier dans l’application, aucune confirmation de réception', () => {
    const m = buildVerdictMessage('coherent', [], null);
    expect(m).toMatch(/^✅ Cohérent/);
    expect(m).toContain('vérifie quand même');
    expect(m).not.toMatch(/paiement (est )?(bien )?(reçu|arrivé)/i);
    expect(m.split('\n').length).toBeLessThanOrEqual(5);
  });
  it('faux probable : raison générale, sans nom de règle', () => {
    const m = buildVerdictMessage(
      'faux_probable',
      [{ rule: 'R05', effect: 'blocking' }],
      'R05',
    );
    expect(m).toContain('déjà été utilisée');
    expect(m).not.toContain('R05');
  });
  it('ajoute l’avertissement de doublon interne', () => {
    const m = buildVerdictMessage(
      'coherent',
      [{ rule: 'R06', effect: 'warning' }],
      null,
    );
    expect(m).toContain('déjà vérifié cette référence');
  });
});
