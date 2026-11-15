import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/**
 * Variables d'environnement (cahier des charges §8.3 + compléments).
 * Toute variable manquante ou invalide fait échouer le démarrage.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // WhatsApp Cloud API
  WHATSAPP_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_VERIFY_TOKEN: z.string().min(16),
  META_APP_SECRET: z.string().min(1),
  GRAPH_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default('v23.0'),

  // Infrastructure
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // Stockage S3 compatible (optionnel : sinon disque local)
  STORAGE_ENDPOINT: z.string().url().optional(),
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_KEY: z.string().optional(),
  STORAGE_SECRET: z.string().optional(),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),

  // Sécurité
  HASH_SECRET: z.string().min(32),
  /** Format : "login:hashBcrypt,login2:hashBcrypt" */
  ADMIN_USERS: z.string().default(''),
  SENTRY_DSN: z.string().url().optional(),

  // Paramètres métier
  IMAGE_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  SESSION_WINDOW_MINUTES: z.coerce.number().positive().default(10),
  /** Délai d'attente après une pièce, avant de juger la preuve complète ou non */
  PROOF_SETTLE_SECONDS: z.coerce.number().nonnegative().default(8),
  MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(5_000_000),
  REVIEW_MODE: bool.default('true'),
  TERMS_VERSION: z.string().default('2026-11-v1'),
  TERMS_URL: z.string().url().optional(),
  FREE_TRIALS: z.coerce.number().int().nonnegative().default(5),
  /** Numéro WhatsApp de l'administrateur, prévenu pour HUMAIN / relecture */
  ADMIN_WA_ID: z.string().optional(),

  // Extraction (J5)
  FORMATS_DIR: z.string().default('./config/formats'),
  OCR_LANG: z.string().default('fra'),
  OCR_CACHE_DIR: z.string().default('./tessdata'),
  /** Confiance OCR (0-100) sous laquelle la preuve est jugée douteuse */
  OCR_MIN_CONFIDENCE: z.coerce.number().min(0).max(100).default(60),
  /** Confiance OCR sous laquelle la capture est jugée illisible */
  OCR_UNREADABLE_CONFIDENCE: z.coerce.number().min(0).max(100).default(30),

  // Règles (J6)
  MAX_TIME_GAP_MINUTES: z.coerce.number().nonnegative().default(10),
  FUTURE_TOLERANCE_MINUTES: z.coerce.number().nonnegative().default(5),

  // Offre et abonnements (J7)
  FOUNDER_PRICE: z.coerce.number().int().positive().default(2000),
  STANDARD_PRICE: z.coerce.number().int().positive().default(3000),
  FOUNDER_SLOTS: z.coerce.number().int().nonnegative().default(20),
  MONTHLY_QUOTA: z.coerce.number().int().positive().default(60),
  OVERAGE_PRICE: z.coerce.number().int().nonnegative().default(50),
  /** Texte envoyé au vendeur : comment payer (numéro Wave / OM du service…) */
  PAYMENT_INSTRUCTIONS: z
    .string()
    .default(
      'Envoie le montant par Wave ou Orange Money au numéro du service SIGA, puis écris HUMAIN avec la référence du paiement.',
    ),

  // Modèles de message approuvés par Meta (hors fenêtre de 24 h)
  TEMPLATE_VERDICT_READY: z.string().default('siga_verdict_pret'),
  TEMPLATE_SUB_REMINDER: z.string().default('siga_rappel_abonnement'),

  // Pages légales (/legal/*) : brouillons à faire valider
  LEGAL_ENTITY_NAME: z.string().default('SIGA'),
  LEGAL_CONTACT_EMAIL: z.string().email().optional(),

  // Back-office
  /** Dossier du back-office compilé (siga-admin/dist), servi sous /backoffice */
  ADMIN_UI_DIR: z.string().default('../siga-admin/dist'),
  SESSION_TTL_HOURS: z.coerce.number().positive().max(72).default(8),

  // Exploitation (J9)
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  // Une variable présente mais vide (FOO=) est traitée comme absente
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== ''),
  );
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuration invalide :\n${issues}`);
  }
  return parsed.data;
}
