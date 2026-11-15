import '../src/common/bigint-json';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AdminCredentials } from '../src/admin/admin-credentials.service';
import { AdminController } from '../src/admin/admin.controller';
import { AdminGuard } from '../src/admin/admin.guard';
import { AdminService } from '../src/admin/admin.service';
import { AuthController } from '../src/admin/auth.controller';
import { SessionService } from '../src/admin/session.service';
import { AuditService } from '../src/common/audit.service';
import { AppConfig } from '../src/config/app-config.service';

/** Sessions en mémoire (même contrat que SessionService, sans Redis). */
class MemorySessions {
  ttlSeconds = 3600;
  private sessions = new Map<string, string>();
  private failures = new Map<string, number>();
  private n = 0;
  create(login: string) {
    const id = `sess${String(++this.n).padStart(44, '0')}`;
    this.sessions.set(id, login);
    return Promise.resolve(id);
  }
  get(id?: string) {
    return Promise.resolve((id && this.sessions.get(id)) ?? null);
  }
  destroy(id?: string) {
    if (id) this.sessions.delete(id);
    return Promise.resolve();
  }
  isLocked(ip: string, login: string) {
    return Promise.resolve((this.failures.get(ip + login) ?? 0) >= 5);
  }
  recordFailure(ip: string, login: string) {
    this.failures.set(ip + login, (this.failures.get(ip + login) ?? 0) + 1);
    return Promise.resolve();
  }
  clearFailures(ip: string, login: string) {
    this.failures.delete(ip + login);
    return Promise.resolve();
  }
}

describe('Admin (e2e)', () => {
  let app: INestApplication<App>;
  const service = {
    listVerifications: jest.fn(() => ({ total: 0, rows: [] })),
    review: jest.fn(() => ({ id: 1n, status: 'sent' })),
    recordPayment: jest.fn(() => ({ notified: true })),
    stats: jest.fn(() => ({ days: 30 })),
  };
  const audit = { log: jest.fn() };
  const basic = (login: string, pwd: string) =>
    'Basic ' + Buffer.from(`${login}:${pwd}`).toString('base64');
  const PASSWORD = 'mot-de-passe-solide';
  const AUTH = basic('awa', PASSWORD);

  beforeAll(async () => {
    const env: Record<string, unknown> = {
      ADMIN_USERS: `awa:${hashSync(PASSWORD, 4)}`,
      NODE_ENV: 'test',
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController, AdminController],
      providers: [
        AdminGuard,
        AdminCredentials,
        { provide: SessionService, useClass: MemorySessions },
        { provide: AdminService, useValue: service },
        { provide: AuditService, useValue: audit },
        { provide: AppConfig, useValue: { get: (k: string) => env[k] } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  describe('Basic auth (Bruno, scripts)', () => {
    it('refuse sans authentification (401 + WWW-Authenticate)', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/verifications')
        .expect(401);
      expect(res.headers['www-authenticate']).toContain('Basic');
      expect(service.listVerifications).not.toHaveBeenCalled();
    });

    it('pas de WWW-Authenticate pour le back-office (pas de fenêtre du navigateur)', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/stats')
        .set('X-SIGA-Admin', '1')
        .expect(401);
      expect(res.headers['www-authenticate']).toBeUndefined();
    });

    it.each([
      ['mauvais mot de passe', basic('awa', 'faux')],
      ['login inconnu', basic('inconnu', PASSWORD)],
      ['schéma non Basic', 'Bearer abc'],
    ])('refuse : %s', async (_label, header) => {
      await request(app.getHttpServer())
        .get('/admin/stats')
        .set('Authorization', header)
        .expect(401);
    });

    it('accepte un administrateur valide et transmet son identité', async () => {
      await request(app.getHttpServer())
        .post('/admin/review/12')
        .set('Authorization', AUTH)
        .send({
          action: 'send',
          verdict: 'douteux',
          reason: 'Montant illisible',
        })
        .expect(201);
      expect(service.review).toHaveBeenCalledWith(
        12n,
        { action: 'send', verdict: 'douteux', reason: 'Montant illisible' },
        'awa',
      );
    });
  });

  describe('Session (back-office)', () => {
    const login = async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/auth/login')
        .send({ login: 'awa', password: PASSWORD })
        .expect(200);
      const cookie = ([] as string[]).concat(
        res.headers['set-cookie'] ?? [],
      )[0];
      return { res, cookie: cookie.split(';')[0], raw: cookie };
    };

    it('connexion : cookie httpOnly, SameSite=Strict', async () => {
      const { res, raw } = await login();
      expect(res.body).toEqual({ login: 'awa' });
      expect(raw).toMatch(/^siga_admin=/);
      expect(raw).toMatch(/HttpOnly/i);
      expect(raw).toMatch(/SameSite=Strict/i);
      expect(audit.log).toHaveBeenCalledWith('awa', 'admin.login', 'auth');
    });

    it('/auth/me et lecture avec le cookie', async () => {
      const { cookie } = await login();
      await request(app.getHttpServer())
        .get('/admin/auth/me')
        .set('Cookie', cookie)
        .expect(200, { login: 'awa' });
      await request(app.getHttpServer())
        .get('/admin/stats')
        .set('Cookie', cookie)
        .expect(200);
    });

    it('CSRF : une modification par cookie exige X-SIGA-Admin', async () => {
      const { cookie } = await login();
      await request(app.getHttpServer())
        .post('/admin/review/12')
        .set('Cookie', cookie)
        .send({ action: 'reject' })
        .expect(403);
      expect(service.review).not.toHaveBeenCalled();
      await request(app.getHttpServer())
        .post('/admin/review/12')
        .set('Cookie', cookie)
        .set('X-SIGA-Admin', '1')
        .send({ action: 'reject' })
        .expect(201);
    });

    it('déconnexion : le cookie ne fonctionne plus', async () => {
      const { cookie } = await login();
      await request(app.getHttpServer())
        .post('/admin/auth/logout')
        .set('Cookie', cookie)
        .set('X-SIGA-Admin', '1')
        .expect(200);
      await request(app.getHttpServer())
        .get('/admin/auth/me')
        .set('Cookie', cookie)
        .expect(401);
    });

    it('cookie inventé : refusé', async () => {
      await request(app.getHttpServer())
        .get('/admin/auth/me')
        .set('Cookie', 'siga_admin=' + 'x'.repeat(43))
        .expect(401);
    });

    it('5 échecs : connexion bloquée (429), même avec le bon mot de passe', async () => {
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/admin/auth/login')
          .send({ login: 'bloque', password: 'faux' })
          .expect(401);
      }
      await request(app.getHttpServer())
        .post('/admin/auth/login')
        .send({ login: 'bloque', password: 'faux' })
        .expect(429);
    });
  });

  describe('Validation des entrées', () => {
    it('verdict inconnu → 400', async () => {
      await request(app.getHttpServer())
        .post('/admin/review/12')
        .set('Authorization', AUTH)
        .send({ action: 'send', verdict: 'valide' })
        .expect(400);
      expect(service.review).not.toHaveBeenCalled();
    });

    it('paiement : mois par défaut à 1, montant entier obligatoire', async () => {
      await request(app.getHttpServer())
        .post('/admin/sellers/3/payments')
        .set('Authorization', AUTH)
        .send({ amountXof: 2000, plan: 'founder' })
        .expect(201);
      expect(service.recordPayment).toHaveBeenCalledWith(
        3n,
        { amountXof: 2000, plan: 'founder', months: 1 },
        'awa',
      );
      await request(app.getHttpServer())
        .post('/admin/sellers/3/payments')
        .set('Authorization', AUTH)
        .send({ amountXof: 'deux mille', plan: 'founder' })
        .expect(400);
    });

    it('identifiant invalide → 400', async () => {
      await request(app.getHttpServer())
        .post('/admin/review/abc')
        .set('Authorization', AUTH)
        .send({ action: 'reject' })
        .expect(400);
    });
  });
});
