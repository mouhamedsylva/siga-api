import type { ErrorEvent } from '@sentry/node';
import { scrubEvent } from './sentry';

describe('scrubEvent (aucune donnée sensible vers Sentry)', () => {
  it('retire requête, utilisateur et extra, et masque les numéros', () => {
    const event = {
      type: undefined,
      message: 'Échec pour 221771234567',
      request: {
        data: '{"from":"221771234567"}',
        headers: { authorization: 'Basic xxx' },
        cookies: { a: 'b' },
        query_string: 'hub.verify_token=secret',
        url: '/webhook',
      },
      user: { id: '221771234567' },
      extra: { body: 'SMS complet' },
      exception: {
        values: [{ type: 'Error', value: 'wa_id 221771234567 inconnu' }],
      },
    } as unknown as ErrorEvent;

    const out = scrubEvent(event);
    const json = JSON.stringify(out);
    expect(json).not.toContain('221771234567');
    expect(json).not.toContain('Basic xxx');
    expect(json).not.toContain('SMS complet');
    expect(json).not.toContain('secret');
    expect(out.request?.url).toBe('/webhook');
  });
});
