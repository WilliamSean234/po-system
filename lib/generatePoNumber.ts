// lib/generatePoNumber.ts
import { prisma } from "@/lib/prisma";

/**
 * Generate nomor PO otomatis dengan format: PO-YYYYMM-0001
 * Penomoran reset tiap bulan, dihitung PER TENANT (tenant lain gak saling pengaruh).
 *
 * Dibungkus $transaction supaya aman dari race condition:
 * kalau ada 2 request create PO bersamaan di tenant yang sama,
 * mereka gak akan dapat nomor urut yang sama.
 */
export async function generatePoNumber(tenantId: string): Promise<string> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`; // contoh: "202607"
  const prefix = `PO-${yearMonth}-`;

  return prisma.$transaction(async (tx) => {
    // Cari PO dengan nomor prefix bulan ini yang terbesar, di tenant ini
    const lastPo = await tx.purchaseOrder.findFirst({
      where: {
        tenantId,
        poNumber: { startsWith: prefix },
      },
      orderBy: { poNumber: "desc" },
      select: { poNumber: true },
    });

    let nextSequence = 1;
    if (lastPo) {
      // Ambil 4 digit terakhir dari nomor sebelumnya, misal "PO-202607-0007" → 7
      const lastSequenceStr = lastPo.poNumber.split("-")[2];
      const lastSequence = parseInt(lastSequenceStr, 10);
      if (!isNaN(lastSequence)) {
        nextSequence = lastSequence + 1;
      }
    }

    const sequenceStr = String(nextSequence).padStart(4, "0"); // "0001", "0002", dst
    return `${prefix}${sequenceStr}`;
  });
}