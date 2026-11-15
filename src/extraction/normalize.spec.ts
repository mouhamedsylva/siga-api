import {
  editDistance,
  namesCompatible,
  normalizeName,
  normalizeRef,
  parseAmount,
  parseDateTime,
  refKey,
} from './normalize';

describe('parseAmount', () => {
  it.each([
    ['15.000F', 15000],
    ['15 000 FCFA', 15000],
    ['10000.00', 10000],
    ['10 000,00 F CFA', 10000],
    ['1.250.000', 1250000],
    ['15,000', 15000],
    ['500F', 500],
    ['5000 XOF', 5000],
  ])('%p → %p', (raw, expected) => expect(parseAmount(raw)).toBe(expected));

  it.each([null, '', 'abc', '0', '-'])('%p → null', (raw) =>
    expect(parseAmount(raw)).toBeNull(),
  );
});

describe('normalizeRef / refKey', () => {
  it('retire espaces, ponctuation et casse', () => {
    expect(normalizeRef(' ci 2301.01-ab12 ')).toBe('CI230101AB12');
  });
  it('refuse une référence trop courte', () => {
    expect(normalizeRef('A1')).toBeNull();
  });
  it('rend équivalentes les confusions O/0, I/1, S/5', () => {
    expect(refKey('ABO1SI')).toBe(refKey('AB0151'));
  });
});

describe('editDistance', () => {
  it('compte les modifications', () => {
    expect(editDistance('ABC123', 'ABC123')).toBe(0);
    expect(editDistance('ABC123', 'ABC124')).toBe(1);
    expect(editDistance('ABC123', 'AB123')).toBe(1);
    expect(editDistance('ABC123', 'XYZ999')).toBe(6);
  });
});

describe('noms', () => {
  it('normalise accents et casse', () => {
    expect(normalizeName('  Aïssatou  DIOP ')).toBe('aissatou diop');
  });
  it('compatibles si un mot commun', () => {
    expect(namesCompatible('aissatou diop', 'a diop')).toBe(true);
    expect(namesCompatible('moussa fall', 'awa ndiaye')).toBe(false);
  });
});

describe('parseDateTime (Africa/Dakar = UTC)', () => {
  it.each([
    ['13/11/2026 14:05', '2026-11-13T14:05:00.000Z'],
    ['13/11/26 à 14h05', '2026-11-13T14:05:00.000Z'],
    ['13-11-2026 14:05:33', '2026-11-13T14:05:33.000Z'],
    ['2026-11-13 09:30', '2026-11-13T09:30:00.000Z'],
    ['13.11.2026', '2026-11-13T00:00:00.000Z'],
  ])('%p', (raw, iso) => expect(parseDateTime(raw)?.toISOString()).toBe(iso));

  it.each(['31/02/2026 10:00', '13/13/2026', 'hier', null])(
    'invalide : %p',
    (raw) => expect(parseDateTime(raw)).toBeNull(),
  );
});
