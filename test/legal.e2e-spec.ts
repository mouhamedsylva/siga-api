import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppConfig } from '../src/config/app-config.service';
import { escapeHtml } from '../src/legal/legal.content';
import { LegalController } from '../src/legal/legal.controller';

/** Pages légales publiques (exigées par Meta pour publier l'app). */
describe('Pages légales (e2e)', () => {
  let app: INestApplication<App>;
  const env: Record<string, unknown> = {
    LEGAL_ENTITY_NAME: 'SIGA <test>',
    LEGAL_CONTACT_EMAIL: 'contact@example.com',
    IMAGE_RETENTION_DAYS: 30,
    TERMS_VERSION: '2026-11-v1',
    FREE_TRIALS: 5,
    FOUNDER_PRICE: 2000,
    STANDARD_PRICE: 3000,
    MONTHLY_QUOTA: 60,
    OVERAGE_PRICE: 50,
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LegalController],
      providers: [
        { provide: AppConfig, useValue: { get: (k: string) => env[k] } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  it.each([
    ['/legal/confidentialite', 'Politique de confidentialité'],
    ['/legal/cgu', "Conditions d'utilisation"],
    ['/legal/suppression-donnees', 'Suppression de tes données'],
  ])('%s : HTML public, sans authentification', async (path, title) => {
    const res = await request(app.getHttpServer()).get(path).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain(`<h1>${escapeHtml(title)}</h1>`);
    expect(res.text).toContain('en cours de validation juridique');
    expect(res.text).not.toMatch(/<script/i);
  });

  it('reprend la configuration réelle (rétention, tarifs, version)', async () => {
    const privacy = await request(app.getHttpServer()).get(
      '/legal/confidentialite',
    );
    expect(privacy.text).toContain('30 jours');
    expect(privacy.text).toContain('2008-12');
    const cgu = await request(app.getHttpServer()).get('/legal/cgu');
    expect(cgu.text).toContain('2026-11-v1');
    expect(cgu.text).toContain('3 000 FCFA');
    expect(cgu.text).toContain('ne confirme jamais');
    expect(cgu.text).toContain('code secret');
  });

  it('décrit la procédure de suppression du bot', async () => {
    const res = await request(app.getHttpServer()).get(
      '/legal/suppression-donnees',
    );
    expect(res.text).toContain('SUPPRIMER MES DONNÉES');
    expect(res.text).toContain('CONFIRMER');
  });

  it('échappe les valeurs de configuration', async () => {
    const res = await request(app.getHttpServer()).get('/legal/cgu');
    expect(res.text).toContain('SIGA &lt;test&gt;');
    expect(res.text).not.toContain('SIGA <test>');
  });

  it('/legal redirige vers la confidentialité', () =>
    request(app.getHttpServer())
      .get('/legal')
      .expect(302)
      .expect('Location', '/legal/confidentialite'));
});
