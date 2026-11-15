import { normalizeCommandText, parseCommand } from './commands';

describe('parseCommand', () => {
  it.each([
    ['stop', 'STOP'],
    ['  Stop ! ', 'STOP'],
    ['aide', 'AIDE'],
    ['Humain', 'HUMAIN'],
    ['oui', 'OUI'],
    ["J'accepte", 'OUI'],
    ['reprendre', 'REPRENDRE'],
    ['Supprimer mes données', 'SUPPRIMER'],
  ])('reconnaît %p comme %p (casse et accents ignorés)', (input, expected) => {
    expect(parseCommand(input)).toBe(expected);
  });

  it.each([
    'Transfert de 5000 FCFA reçu. Ref ABC123. Stop',
    'bonjour',
    '',
    undefined,
  ])('ignore %p (pas une commande seule)', (input) => {
    expect(parseCommand(input)).toBeNull();
  });
});

describe('normalizeCommandText', () => {
  it('retire accents, ponctuation et espaces multiples', () => {
    expect(normalizeCommandText('  Supprimer   mes données. ')).toBe(
      'SUPPRIMER MES DONNEES',
    );
  });
});
