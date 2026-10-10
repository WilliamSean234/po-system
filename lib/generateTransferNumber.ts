// lib/generateTransferNumber.ts
import { Prisma } from "./generated/prisma";

type TransactionClient = Prisma.TransactionClient;

/**
 * Generate nomor Stock Transfer otomatis per tenant, format: TRF-YYYYMM-0001
 * Reset ke 0001 tiap bulan (pola sama persis seperti generateGrNumber).
 *
 * WAJIB dipanggil dari dalam prisma.$transaction (terima `tx`, bukan
 * `prisma` global).
 *
 * StockTransfer TIDAK punya isDeleted (immutable, tidak ada endpoint
 * delete), jadi semua row yang ada otomatis ikut dihitung.
 */
export async function generateTransferNumber(
  tx: TransactionClient,
  tenantId: string
): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `TRF-${year}${month}-`;

  const countThisMonth = await tx.stockTransfer.count({
    where: {
      tenantId,
      transferNumber: { startsWith: prefix },
    },
  });

  return `${prefix}${String(countThisMonth + 1).padStart(4, "0")}`;
}

/**
 * Wrapper retry untuk collision (P2002 pada @@unique([tenantId, transferNumber])),
 * maksimal 3x — pola sama persis seperti generateGrNumberWithRetry.
 */
export async function generateTransferNumberWithRetry(
  tx: TransactionClient,
  tenantId: string,
  createFn: (transferNumber: string) => Promise<void>,
  maxRetries: number = 3
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const transferNumber = await generateTransferNumber(tx, tenantId);

    try {
      await createFn(transferNumber);
      return transferNumber;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}