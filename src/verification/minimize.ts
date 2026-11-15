import type { Prisma } from '@prisma/client';

type Db = Pick<Prisma.TransactionClient, 'verificationItem'>;

/**
 * Minimisation (§9) : le SMS collé contient des noms et des numéros de clients.
 * Il est conservé tant que la vérification peut être relue par un administrateur,
 * puis effacé dès la décision finale (verdict envoyé ou rejet).
 */
export function erasePastedText(db: Db, verificationId: bigint) {
  return db.verificationItem.updateMany({
    where: { verificationId, kind: 'text', text: { not: null } },
    data: { text: null },
  });
}
