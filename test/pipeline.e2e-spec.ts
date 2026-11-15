import '../src/common/bigint-json';
import { BillingService } from '../src/billing/billing.service';
import { AuditService } from '../src/common/audit.service';
import { SettingsService } from '../src/common/settings.service';
import type { ExtractedProof } from '../src/extraction/extraction.service';
import type { ParsedPiece } from '../src/extraction/parser';
import { PrismaService } from '../src/prisma/prisma.service';
import { VerdictSender } from '../src/verification/verdict-sender.service';
import { VerificationPipeline } from '../src/verification/verification-pipeline.service';
import { migrateTestDatabase, testDatabaseUrl } from './helpers/test-db';

/**
 * Intégration sur une vraie base MySQL (siga_test) : doublons, verrou,
 * décompte des essais, relecture, rejet. L'OCR et WhatsApp sont simulés.
 */
const url = testDatabaseUrl();
const describeDb = url ? describe : describe.skip;

const config = {
  get: (k: string) =>
    ({
      HASH_SECRET: 'h'.repeat(32),
      MAX_TIME_GAP_MINUTES: 10,
      FUTURE_TOLERANCE_MINUTES: 5,
      OCR_MIN_CONFIDENCE: 60,
      REVIEW_MODE: false,
      MONTHLY_QUOTA: 60,
      FREE_TRIALS: 5,
      TEMPLATE_VERDICT_READY: 'siga_verdict_pret',
    })[k],
};

const piece = (over: Partial<ParsedPiece>): ParsedPiece => ({
  source: 'ocr',
  kind: 'capture',
  operator: 'wave',
  formatId: 'wave-capture-v1',
  amount: 15000,
  ref: 'TAB12CD34EF',
  datetime: new Date(Date.now() - 30 * 60_000),
  sender: 'Moussa Diop',
  missing: [],
  confidence: 90,
  unreadable: false,
  ...over,
});
const proof = (
  ref: string,
  over: Partial<ExtractedProof> = {},
): ExtractedProof => ({
  capture: piece({ ref }),
  sms: piece({
    ref,
    source: 'text',
    kind: 'sms',
    formatId: 'wave-sms-recu-v1',
    confidence: 100,
  }),
  extra: [],
  ...over,
});

describeDb('Pipeline de vérification (MySQL)', () => {
  let prisma: PrismaService;
  let pipeline: VerificationPipeline;
  let settings: SettingsService;
  const sent: Array<{ to: string; body: string }> = [];
  const extraction = { extract: jest.fn<Promise<ExtractedProof>, [unknown]>() };

  beforeAll(async () => {
    migrateTestDatabase(url!);
    process.env.DATABASE_URL = url!;
    prisma = new PrismaService();
    await prisma.onModuleInit();
    await prisma.setting.deleteMany({ where: { key: 'review_mode' } });

    const wa = {
      sendText: jest.fn((to: string, body: string) => {
        sent.push({ to, body });
        return Promise.resolve();
      }),
      sendTemplate: jest.fn(() => Promise.resolve()),
    };
    const audit = new AuditService(prisma);
    settings = new SettingsService(prisma, config as never);
    const billing = new BillingService(prisma, config as never);
    const sender = new VerdictSender(
      prisma,
      config as never,
      wa as never,
      billing,
    );
    pipeline = new VerificationPipeline(
      prisma,
      config as never,
      wa as never,
      { alert: jest.fn() } as never,
      audit,
      settings,
      extraction as never,
      sender,
    );
  }, 120_000);

  afterAll(() => prisma?.$disconnect());

  /** Suffixe unique : la base de test n'est jamais vidée */
  const run = Date.now().toString(36).toUpperCase();
  let n = 0;
  async function seller() {
    n++;
    return prisma.seller.create({
      data: {
        waId: `test-${run}-${n}`,
        state: 'active',
        freeLeft: 5,
        lastInboundAt: new Date(),
      },
    });
  }

  /** Référence unique à cette exécution */
  const R = (ref: string) => ref + run;

  async function verify(sellerId: bigint, extracted: ExtractedProof) {
    const v = await prisma.verification.create({
      data: { sellerId, status: 'processing', reasons: [] },
    });
    extraction.extract.mockResolvedValueOnce(extracted);
    await pipeline.run(v.id);
    return prisma.verification.findUniqueOrThrow({ where: { id: v.id } });
  }

  const freeLeft = async (id: bigint) =>
    (await prisma.seller.findUniqueOrThrow({ where: { id } })).freeLeft;

  it('preuve cohérente : envoyée et décomptée, empreinte HMAC stockée', async () => {
    const a = await seller();
    const v = await verify(a.id, proof(R('REF0001AAAA')));
    expect(v).toMatchObject({
      status: 'sent',
      verdict: 'coherent',
      counted: true,
    });
    expect(v.txRefHash).toMatch(/^[0-9a-f]{64}$/);
    expect(v.txRefHash).not.toContain('REF0001');
    expect(await freeLeft(a.id)).toBe(4);
    expect(sent.at(-1)!.body).toMatch(/^✅ Cohérent/);
  });

  it('même référence, même vendeur : avertissement R06, pas de nouveau décompte', async () => {
    const a = await seller();
    await verify(a.id, proof(R('REF0002BBBB')));
    const v = await verify(a.id, proof(R('REF0002BBBB')));
    expect(v).toMatchObject({ verdict: 'coherent', counted: false });
    expect(v.reasons).toEqual([{ rule: 'R06', effect: 'warning' }]);
    expect(await freeLeft(a.id)).toBe(4);
    expect(sent.at(-1)!.body).toContain('déjà vérifié cette référence');
  });

  it('même référence chez un autre vendeur : faux probable (R05)', async () => {
    const a = await seller();
    const b = await seller();
    await verify(a.id, proof(R('REF0003CCCC')));
    const v = await verify(b.id, proof(R('REF0003CCCC')));
    expect(v.verdict).toBe('faux_probable');
    expect(sent.at(-1)!.body).toContain('déjà été utilisée');
  });

  it('confusion OCR O/0 : la référence est quand même reconnue comme réutilisée', async () => {
    const a = await seller();
    const b = await seller();
    await verify(a.id, proof(R('REF0004DDDD')));
    const v = await verify(b.id, proof(R('REFOOO4DDDD')));
    expect(v.verdict).toBe('faux_probable');
  });

  it('deux vendeurs, même référence au même instant : un seul passe (verrou)', async () => {
    const c = await seller();
    const d = await seller();
    const [v1, v2] = await Promise.all([
      verify(c.id, proof(R('REF0005EEEE'))),
      verify(d.id, proof(R('REF0005EEEE'))),
    ]);
    expect([v1.verdict, v2.verdict].sort()).toEqual([
      'coherent',
      'faux_probable',
    ]);
  });

  it('capture illisible : rejet, rien de décompté, référence non réservée', async () => {
    const a = await seller();
    const v = await verify(
      a.id,
      proof(R('REF0006FFFF'), {
        capture: piece({ unreadable: true, ref: R('REF0006FFFF') }),
      }),
    );
    expect(v).toMatchObject({
      status: 'rejected',
      verdict: null,
      txRefHash: null,
    });
    expect(await freeLeft(a.id)).toBe(5);
    expect(sent.at(-1)!.body).toContain("n'arrive pas à lire");
  });

  it('mode relecture : un cas douteux attend l’administrateur, sans décompte', async () => {
    await settings.setReviewMode(true);
    const a = await seller();
    const v = await verify(a.id, proof(R('REF0007GGGG'), { sms: null }));
    expect(v).toMatchObject({
      status: 'in_review',
      verdict: 'douteux',
      counted: false,
    });
    expect(await freeLeft(a.id)).toBe(5);
    await settings.setReviewMode(false);
  });

  it('le SMS collé n’est plus conservé après analyse', async () => {
    const a = await seller();
    const v = await prisma.verification.create({
      data: {
        sellerId: a.id,
        status: 'processing',
        reasons: [],
        items: {
          create: {
            wamid: `wamid.sms.${run}`,
            kind: 'text',
            text: 'SMS de Moussa 770000000',
          },
        },
      },
    });
    extraction.extract.mockResolvedValueOnce(proof(R('REF0008HHHH')));
    await pipeline.run(v.id);
    const item = await prisma.verificationItem.findUniqueOrThrow({
      where: { wamid: `wamid.sms.${run}` },
    });
    expect(item.text).toBeNull();
  });

  it('en relecture, le SMS collé reste lisible pour l’administrateur', async () => {
    await settings.setReviewMode(true);
    const a = await seller();
    const wamid = 'wamid.sms.review.' + run;
    const v = await prisma.verification.create({
      data: {
        sellerId: a.id,
        status: 'processing',
        reasons: [],
        items: { create: { wamid, kind: 'text', text: 'SMS à relire' } },
      },
    });
    // SMS absent côté extraction → Douteux → relecture
    extraction.extract.mockResolvedValueOnce(
      proof(R('REF0009IIII'), { sms: null }),
    );
    await pipeline.run(v.id);
    const after = await prisma.verification.findUniqueOrThrow({
      where: { id: v.id },
    });
    expect(after.status).toBe('in_review');
    const item = await prisma.verificationItem.findUniqueOrThrow({
      where: { wamid },
    });
    expect(item.text).toBe('SMS à relire');
    await settings.setReviewMode(false);
  });
});
