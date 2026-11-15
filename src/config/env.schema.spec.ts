import { validateEnv } from './env.schema';

const base = {
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: '123',
  WHATSAPP_VERIFY_TOKEN: 'v'.repeat(16),
  META_APP_SECRET: 's',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  HASH_SECRET: 'h'.repeat(32),
};

describe('validateEnv', () => {
  it('applique les valeurs par défaut', () => {
    const env = validateEnv(base);
    expect(env.SESSION_WINDOW_MINUTES).toBe(10);
    expect(env.IMAGE_RETENTION_DAYS).toBe(30);
    expect(env.REVIEW_MODE).toBe(true);
    expect(env.FREE_TRIALS).toBe(5);
  });

  it('traite les variables vides comme absentes', () => {
    expect(() =>
      validateEnv({ ...base, STORAGE_ENDPOINT: '', SENTRY_DSN: '' }),
    ).not.toThrow();
  });

  it('refuse un HASH_SECRET trop court et nomme la variable', () => {
    expect(() => validateEnv({ ...base, HASH_SECRET: 'court' })).toThrow(
      /HASH_SECRET/,
    );
  });

  it('convertit REVIEW_MODE', () => {
    expect(validateEnv({ ...base, REVIEW_MODE: 'false' }).REVIEW_MODE).toBe(
      false,
    );
  });
});
