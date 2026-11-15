import { isWithinSessionWindow } from '../conversation/session-window';
import { refFingerprint } from './hmac.util';
import { maskPhone, redactText } from './redact';

describe('maskPhone', () => {
  it('ne garde que le début et la fin du numéro', () => {
    expect(maskPhone('221771234567')).toBe('2217******67');
  });
  it('gère les valeurs vides ou courtes', () => {
    expect(maskPhone(undefined)).toBe('-');
    expect(maskPhone('1234')).toBe('***');
  });
});

describe('redactText', () => {
  it('masque les numéros dans un texte libre', () => {
    const out = redactText('Reçu de 77 123 45 67 pour 5000');
    expect(out).not.toContain('123 45');
    expect(out).toContain('5000');
  });
});

describe('refFingerprint', () => {
  it('est stable et dépend du secret', () => {
    const a = refFingerprint('ABC123', 's'.repeat(32));
    expect(a).toBe(refFingerprint('ABC123', 's'.repeat(32)));
    expect(a).not.toBe(refFingerprint('ABC123', 't'.repeat(32)));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('isWithinSessionWindow', () => {
  const now = new Date('2026-11-13T12:00:00Z');
  it('ouverte si le vendeur a écrit il y a 1 h', () => {
    expect(isWithinSessionWindow(new Date('2026-11-13T11:00:00Z'), now)).toBe(
      true,
    );
  });
  it('fermée après 24 h ou sans message', () => {
    expect(isWithinSessionWindow(new Date('2026-11-12T11:59:00Z'), now)).toBe(
      false,
    );
    expect(isWithinSessionWindow(null, now)).toBe(false);
  });
});
