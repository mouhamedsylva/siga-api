import { join } from 'node:path';
import { compileFormat, loadFormats } from './formats';
import { guessOperator, parsePiece } from './parser';

/**
 * Cas construits à partir des formats EXEMPLES de config/formats.
 * À compléter avec les vrais SMS et captures de la phase 0 (anonymisés).
 */
const formats = loadFormats(join(__dirname, '../../config/formats'));

describe('loadFormats', () => {
  it('charge les formats fournis', () => {
    expect(formats.map((f) => f.id).sort()).toEqual([
      'om-capture-v1',
      'om-sms-recu-v1',
      'wave-capture-v1',
      'wave-sms-recu-v1',
    ]);
  });

  it('refuse un format mal décrit', () => {
    expect(() =>
      compileFormat({ id: 'x-v1', operator: 'mtn', kind: 'sms' }, 'x.yaml'),
    ).toThrow(/x\.yaml/);
  });

  it('refuse une expression invalide', () => {
    expect(() =>
      compileFormat({
        id: 'bad-v1',
        operator: 'wave',
        kind: 'sms',
        detect: ['(('],
        fields: { amount: 'a', ref: 'b' },
      }),
    ).toThrow(/bad-v1/);
  });
});

describe('parsePiece', () => {
  it('SMS Wave collé', () => {
    const p = parsePiece(
      'Wave: Vous avez reçu 15.000F de Moussa Diop (77 000 00 00) le 13/11/2026 à 14:05. ' +
        'Nouveau solde : 40.000F. ID de transaction: T_AB12CD34EF',
      formats,
      { source: 'text', preferKind: 'sms' },
    );
    expect(p).toMatchObject({
      kind: 'sms',
      operator: 'wave',
      formatId: 'wave-sms-recu-v1',
      amount: 15000,
      ref: 'TAB12CD34EF',
      sender: 'Moussa Diop',
      missing: [],
    });
    expect(p.datetime?.toISOString()).toBe('2026-11-13T14:05:00.000Z');
  });

  it('SMS Orange Money avec montant à décimales', () => {
    const p = parsePiece(
      'Orange Money: Vous avez recu un transfert de 10000.00 FCFA de AWA NDIAYE (771234567) ' +
        'le 13/11/2026 09:30. Ref: CI261113.0930.A12345',
      formats,
      { source: 'text', preferKind: 'sms' },
    );
    expect(p).toMatchObject({
      operator: 'orange_money',
      amount: 10000,
      ref: 'CI2611130930A12345',
      missing: [],
    });
  });

  it('capture Wave (texte OCR, espaces irréguliers)', () => {
    const p = parsePiece(
      'Wave\nTransfert envoyé\n Montant :  15 000 F\nDe : Moussa Diop\n13/11/2026 14:05\nID de transaction : T_AB12CD34EF',
      formats,
      { source: 'ocr', confidence: 88 },
    );
    expect(p).toMatchObject({
      kind: 'capture',
      operator: 'wave',
      amount: 15000,
      ref: 'TAB12CD34EF',
      confidence: 88,
    });
  });

  it('texte sans format connu : inconnu, opérateur deviné', () => {
    const p = parsePiece('Bienvenue sur Wave, votre solde', formats, {
      source: 'ocr',
    });
    expect(p.kind).toBe('unknown');
    expect(p.formatId).toBeNull();
    expect(p.operator).toBe('wave');
  });

  it('champ obligatoire absent : listé dans missing', () => {
    const p = parsePiece('Wave: Vous avez reçu 15.000F de Moussa', formats, {
      source: 'text',
      preferKind: 'sms',
    });
    expect(p.missing).toEqual(['ref']);
  });
});

describe('guessOperator', () => {
  it.each([
    ['Paiement WAVE', 'wave'],
    ['Orange Money', 'orange_money'],
    ['Max it', 'orange_money'],
    ['Free Money', null],
  ])('%p → %p', (t, op) => expect(guessOperator(t)).toBe(op));
});
