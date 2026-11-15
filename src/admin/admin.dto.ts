import { BadRequestException, PipeTransform } from '@nestjs/common';
import { z, type ZodTypeAny } from 'zod';

/** Validation des entrées par schéma zod. */
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      );
    }
    return parsed.data as z.infer<T>;
  }
}

const verdict = z.enum(['coherent', 'douteux', 'faux_probable']);
const page = z.coerce.number().int().min(1).default(1);
const pageSize = z.coerce.number().int().min(1).max(200).default(50);

export const idParam = z.coerce.bigint().positive();

export const verificationFilter = z.object({
  status: z
    .enum(['pending', 'processing', 'in_review', 'sent', 'rejected', 'failed'])
    .optional(),
  verdict: verdict.optional(),
  sellerId: z.coerce.bigint().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page,
  pageSize,
});
export type VerificationFilter = z.infer<typeof verificationFilter>;

export const reviewDecision = z.union([
  z.object({
    action: z.literal('send'),
    /** Absent : le verdict calculé est confirmé */
    verdict: verdict.optional(),
    reason: z.string().trim().min(3).max(120).optional(),
  }),
  z.object({
    /** Preuve inexploitable : on demande une meilleure capture, sans décompte */
    action: z.literal('reject'),
  }),
]);
export type ReviewDecision = z.infer<typeof reviewDecision>;

export const sellerFilter = z.object({
  q: z.string().trim().max(40).optional(),
  plan: z.enum(['trial', 'founder', 'standard']).optional(),
  blocked: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  page,
  pageSize,
});
export type SellerFilter = z.infer<typeof sellerFilter>;

export const paymentInput = z.object({
  amountXof: z.number().int().positive(),
  plan: z.enum(['founder', 'standard']),
  months: z.number().int().min(1).max(12).default(1),
  method: z.string().trim().max(40).optional(),
  externalId: z.string().trim().max(80).optional(),
});
export type PaymentInput = z.infer<typeof paymentInput>;

export const blockInput = z.object({ blocked: z.boolean() });
export const settingsInput = z.object({ reviewMode: z.boolean() });
export const statsQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export const auditQuery = z.object({ page, pageSize });
