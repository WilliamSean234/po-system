import { Prisma } from "../lib/generated/prisma";

type TransactionClient = Prisma.TransactionClient;

/**
 * Custom error untuk validasi prasyarat Invoice yang BUKAN soal qty/price
 * (itu sudah ditangani invoiceMatching.ts) — misal prasyarat dokumen,
 * seperti "PO harus punya GR dulu".
 */
export class InvoicePrerequisiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoicePrerequisiteError";
  }
}

/**
 * Cek apakah PO terkait sudah punya minimal 1 GoodsReceipt.
 *
 * Dipanggil HANYA saat transisi DRAFT -> SUBMITTED, BUKAN saat create
 * invoice (DRAFT) — sesuai keputusan desain: staf finance boleh input
 * data invoice dari kertas vendor duluan sebelum barang fisik sampai
 * gudang, tapi invoice itu "terkunci" di DRAFT sampai GR-nya settle.
 *
 * Ini mirip perilaku "GR-based Invoice Verification" di SAP MIRO, tapi
 * disederhanakan dari versi SAP yang per-PO-line (SAP bisa toggle flag
 * ini per line item) — di sini berlaku uniform untuk seluruh PO, cukup
 * untuk skala SME dan menghindari kompleksitas konfigurasi tambahan.
 */
export async function assertPurchaseOrderHasGoodsReceipt(
  tx: TransactionClient,
  poId: string
): Promise<void> {
  const grCount = await tx.goodsReceipt.count({
    where: { poId },
  });

  if (grCount === 0) {
    throw new InvoicePrerequisiteError(
      "PO belum punya Goods Receipt. Invoice tidak bisa disubmit sebelum ada barang yang diterima."
    );
  }
}