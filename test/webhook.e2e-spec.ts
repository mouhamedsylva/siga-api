import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppConfig } from '../src/config/app-config.service';
import { INBOUND_QUEUE } from '../src/queue/queues';
import { SignatureGuard } from '../src/whatsapp/signature.guard';
import { WebhookController } from '../src/whatsapp/webhook.controller';

const SECRET = 'meta-app-secret';
const VERIFY = 'verify-token-123456';

const payload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '1',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            contacts: [{ wa_id: '221770000001', profile: { name: 'Awa' } }],
            messages: [
              {
                id: 'wamid.X',
                from: '221770000001',
                timestamp: '1',
                type: 'text',
                text: { body: 'Bonjour' },
              },
            ],
            statuses: [
              {
                id: 'wamid.OUT',
                status: 'delivered',
                timestamp: '1',
                recipient_id: '221770000001',
              },
            ],
          },
        },
      ],
    },
  ],
};

const sign = (body: string) =>
  'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');

describe('Webhook (e2e)', () => {
  let app: INestApplication<App>;
  const queue = { addBulk: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        SignatureGuard,
        {
          provide: AppConfig,
          useValue: {
            get: (k: string) =>
              ({ META_APP_SECRET: SECRET, WHATSAPP_VERIFY_TOKEN: VERIFY })[k],
          },
        },
        { provide: getQueueToken(INBOUND_QUEUE), useValue: queue },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => queue.addBulk.mockReset());

  it('GET renvoie le défi avec le bon jeton', () =>
    request(app.getHttpServer())
      .get('/webhook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY,
        'hub.challenge': '42',
      })
      .expect(200)
      .expect('42'));

  it('GET refuse un mauvais jeton', () =>
    request(app.getHttpServer())
      .get('/webhook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'mauvais',
        'hub.challenge': '42',
      })
      .expect(403));

  it('POST signé : 200 et mise en file du message et du statut', async () => {
    const body = JSON.stringify(payload);
    await request(app.getHttpServer())
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(body))
      .send(body)
      .expect(200);

    const jobs = queue.addBulk.mock.calls[0][0];
    expect(jobs.map((j) => j.opts.jobId)).toEqual([
      'm_wamid.X',
      's_wamid.OUT_delivered',
    ]);
    expect(jobs[0].data.profileName).toBe('Awa');
  });

  it('POST avec signature falsifiée : 401, rien en file', async () => {
    const body = JSON.stringify(payload);
    await request(app.getHttpServer())
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', 'sha256=' + '0'.repeat(64))
      .send(body)
      .expect(401);
    expect(queue.addBulk).not.toHaveBeenCalled();
  });

  it('POST sans signature : 401', () =>
    request(app.getHttpServer()).post('/webhook').send(payload).expect(401));

  it('POST : file indisponible => 500 pour que Meta rejoue', async () => {
    queue.addBulk.mockRejectedValueOnce(new Error('redis down'));
    const body = JSON.stringify(payload);
    await request(app.getHttpServer())
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(body))
      .send(body)
      .expect(500);
  });
});
