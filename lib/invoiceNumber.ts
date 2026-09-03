import { Prisma } from "../lib/generated/prisma";

type TransactionClient = Prisma.TransactionClient;

/**
 * Generate nomor Invoice otomatis per tenant, format: INV-YYYYMM-0001
 * Reset ke 0001 tiap bulan (pola sama persis seperti generateGrNumber /
 * generatePoNumber).
 *
 * WAJIB dipanggil dari dalam prisma.$transaction (terima `tx`, bukan
 * `prisma` global) — mencegah race condition kalau 2 invoice dibuat
 * bersamaan di tenant yang sama.
 *
 * CATATAN PENTING (beda dari generateGrNumber): Invoice PUNYA field
 * isDeleted (dipakai untuk hapus invoice yang masih DRAFT). Count di
 * bawah SENGAJA TIDAK memfilter isDeleted: false — semua invoiceNumber
 * yang pernah dibuat, termasuk yang sudah di-soft-delete, tetap dihitung
 * supaya nomor tidak pernah dipakai ulang. Ini pola yang sama seperti
 * poNumber (lihat insiden hard-delete PO di masa lalu yang menyebabkan
 * poNumber recycling) — audit trail nomor dokumen harus immutable.
 */
export async function generateInvoiceNumber(
  tx: TransactionClient,
  tenantId: string
): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const yearMonth = `${year}${month}`;
  const prefix = `INV-${yearMonth}-`;

  // Hitung SEMUA invoice untuk tenant ini di bulan ini, termasuk yang
  // isDeleted: true — lihat catatan di atas kenapa tidak difilter.
  const countThisMonth = await tx.invoice.count({
    where: {
      tenantId,
      invoiceNumber: { startsWith: prefix },
    },
  });

  const nextSequence = countThisMonth + 1;
  const invoiceNumber = `${prefix}${String(nextSequence).padStart(4, "0")}`;

  return invoiceNumber;
}

/**
 * Wrapper dengan retry logic untuk race condition yang lolos dari
 * transaction row lock. Kalau terjadi collision, Prisma throw P2002
 * karena @@unique([tenantId, invoiceNumber]).
 *
 * Retry maksimal 3x — pola sama persis seperti generateGrNumberWithRetry.
 */
export async function generateInvoiceNumberWithRetry(
  tx: TransactionClient,
  tenantId: string,
  createFn: (invoiceNumber: string) => Promise<void>,
  maxRetries: number = 3
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const invoiceNumber = await generateInvoiceNumber(tx, tenantId);

    try {
      await createFn(invoiceNumber);
      return invoiceNumber; // berhasil, langsung return
    } catch (error) {
      // P2002 = Prisma unique constraint violation
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        lastError = error;
        continue; // coba lagi dengan hitung ulang nextSequence
      }
      throw error; // error lain (bukan collision) -> langsung lempar, jangan retry
    }
  }

  throw lastError;
}