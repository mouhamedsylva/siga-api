import { createHmac } from 'node:crypto';
import { isValidSignature } from './signature';

const SECRET = 'app-secret';
const body = Buffer.from('{"object":"whatsapp_business_account"}');
const sign = (b: Buffer, s = SECRET) =>
  'sha256=' + createHmac('sha256', s).update(b).digest('hex');

describe('isValidSignature', () => {
  it('accepte une signature correcte', () => {
    expect(isValidSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('rejette une signature calculée avec un autre secret', () => {
    expect(isValidSignature(body, sign(body, 'autre'), SECRET)).toBe(false);
  });

  it('rejette un corps modifié', () => {
    const tampered = Buffer.from(body.toString().replace('}', ',"x":1}'));
    expect(isValidSignature(tampered, sign(body), SECRET)).toBe(false);
  });

  it.each([undefined, '', 'abc', 'sha1=deadbeef'])(
    'rejette un en-tête absent ou mal formé (%p)',
    (header) => {
      expect(isValidSignature(body, header, SECRET)).toBe(false);
    },
  );

  it('rejette un corps brut absent', () => {
    expect(isValidSignature(undefined, sign(body), SECRET)).toBe(false);
  });
});
