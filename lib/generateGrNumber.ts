import { Prisma } from "../lib/generated/prisma";

type TransactionClient = Prisma.TransactionClient;

/**
 * Generate nomor GR otomatis per tenant, format: GR-YYYYMM-0001
 * Reset ke 0001 tiap bulan (pola sama persis seperti generatePoNumber).
 *
 * WAJIB dipanggil dari dalam prisma.$transaction (terima `tx`, bukan
 * `prisma` global) — alasan sama seperti goodsReceiptValidation.ts:
 * mencegah race condition kalau 2 GR dibuat bersamaan di tenant yang
 * sama, keduanya bisa dapat nomor urut yang sama sebelum salah satu
 * sempat commit.
 *
 * CATATAN: GoodsReceipt TIDAK punya field isDeleted (karena tidak ada
 * endpoint delete sama sekali), jadi berbeda dengan generatePoNumber,
 * fungsi ini tidak perlu keputusan "apakah include yang soft-deleted
 * saat count" — semua row GoodsReceipt yang ada di DB otomatis
 * dihitung, tidak ada pengecualian.
 */
export async function generateGrNumber(
  tx: TransactionClient,
  tenantId: string
): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const yearMonth = `${year}${month}`;
  const prefix = `GR-${yearMonth}-`;

  // Hitung berapa GR yang sudah ada untuk tenant ini DI BULAN INI SAJA.
  // Pakai startsWith biar tidak perlu simpan kolom yearMonth terpisah.
  const countThisMonth = await tx.goodsReceipt.count({
    where: {
      tenantId,
      grNumber: { startsWith: prefix },
    },
  });

  const nextSequence = countThisMonth + 1;
  const grNumber = `${prefix}${String(nextSequence).padStart(4, "0")}`;

  return grNumber;
}

/**
 * Wrapper dengan retry logic untuk menangani race condition yang LOLOS
 * dari row lock transaction (kasus jarang, tapi bisa terjadi kalau 2
 * transaction jalan di connection/pool berbeda dan keduanya count()
 * sebelum salah satu insert). Kalau terjadi collision, Prisma akan
 * throw P2002 (unique constraint violation) karena @@unique([tenantId, grNumber]).
 *
 * Retry maksimal 3x — pola sama persis seperti generatePoNumber.
 * Kalau tetap gagal setelah 3x percobaan, kemungkinan besar ada masalah
 * lain (bukan sekadar race condition), jadi error dilempar ke pemanggil.
 */
export async function generateGrNumberWithRetry(
  tx: TransactionClient,
  tenantId: string,
  createFn: (grNumber: string) => Promise<void>,
  maxRetries: number = 3
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const grNumber = await generateGrNumber(tx, tenantId);

    try {
      await createFn(grNumber);
      return grNumber; // berhasil, langsung return
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