import { Prisma } from "../lib/generated/prisma";

/**
 * Custom error class untuk validasi qty Goods Receipt.
 * Dipisah dari Error biasa supaya API route bisa membedakan
 * "validasi qty gagal" (400 Bad Request) vs error lain (500).
 */
export class GoodsReceiptValidationError extends Error {
  constructor(
    message: string,
    public readonly poLineId: string,
    public readonly quantityOrdered: number,
    public readonly alreadyReceived: number,
    public readonly attemptedQuantity: number
  ) {
    super(message);
    this.name = "GoodsReceiptValidationError";
  }
}

/**
 * Tipe Prisma transaction client. Semua fungsi di sini menerima `tx`
 * (bukan `prisma` global) karena create GR HARUS dibungkus dalam satu
 * `prisma.$transaction` supaya create GoodsReceipt + GRLine + update
 * status PurchaseOrder (kalau jadi RECEIVED) atomic — kalau salah satu
 * gagal, semua di-rollback. Ini pola yang sama dipakai di generatePoNumber.
 */
type TransactionClient = Prisma.TransactionClient;

/**
 * Hitung total qty yang SUDAH diterima untuk satu PO Line tertentu,
 * dijumlahkan lintas SEMUA GoodsReceipt yang pernah dibuat untuk PO Line
 * ini (bisa dari GR berbeda, dan bisa beberapa baris/batch dalam 1 GR
 * yang sama — makanya harus di-SUM, bukan diambil dari 1 row saja).
 *
 * Dipakai baik untuk validasi (cek sebelum insert baru) maupun untuk
 * cek apakah PO Line sudah "tercukupi" (dipakai di isPurchaseOrderFullyReceived).
 */
export async function getTotalReceivedQuantity(
  tx: TransactionClient,
  poLineId: string
): Promise<number> {
  const result = await tx.gRLine.aggregate({
    where: { poLineId },
    _sum: { quantityReceived: true },
  });

  // Prisma aggregate return null kalau belum ada row sama sekali (belum pernah ada GR)
  return result._sum.quantityReceived
    ? Number(result._sum.quantityReceived)
    : 0;
}

/**
 * Validasi apakah qty yang mau diterima (attemptedQuantity) untuk satu
 * PO Line masih dalam batas wajar, dengan mempertimbangkan qty yang
 * SUDAH diterima sebelumnya (dari GR-GR lain) + tolerance.
 *
 * tolerancePercent: default 0 (tidak boleh over-receipt sama sekali).
 * Sengaja dibuat parameter, BUKAN hardcode 0 di dalam fungsi, supaya nanti
 * gampang diperluas jadi tolerance configurable per tenant/item TANPA
 * perlu refactor signature fungsi ini — tinggal isi angka lain saat manggil.
 *
 * Contoh: tolerancePercent = 5 artinya boleh over-receipt sampai 105% dari
 * quantityOrdered (umum di industri manufaktur untuk item dengan susut/spoilage).
 *
 * Throw GoodsReceiptValidationError kalau melebihi batas — TIDAK return
 * boolean, karena API route butuh detail lengkap (sudah diterima berapa,
 * dipesan berapa, dst) untuk pesan error yang jelas ke user.
 */
export async function validateReceiptQuantity(
  tx: TransactionClient,
  poLineId: string,
  quantityOrdered: number,
  attemptedQuantity: number,
  tolerancePercent: number = 0
): Promise<void> {
  if (attemptedQuantity <= 0) {
    throw new GoodsReceiptValidationError(
      "Qty yang diterima harus lebih besar dari 0",
      poLineId,
      quantityOrdered,
      0,
      attemptedQuantity
    );
  }

  const alreadyReceived = await getTotalReceivedQuantity(tx, poLineId);
  const maxAllowed = quantityOrdered * (1 + tolerancePercent / 100);
  const totalAfterThisReceipt = alreadyReceived + attemptedQuantity;

  if (totalAfterThisReceipt > maxAllowed) {
    const remaining = maxAllowed - alreadyReceived;
    throw new GoodsReceiptValidationError(
      `Qty melebihi batas. Sudah diterima ${alreadyReceived}, dipesan ${quantityOrdered}` +
        (tolerancePercent > 0 ? ` (toleransi +${tolerancePercent}%)` : "") +
        `. Sisa yang boleh diterima: ${remaining < 0 ? 0 : remaining}`,
      poLineId,
      quantityOrdered,
      alreadyReceived,
      attemptedQuantity
    );
  }
}

/**
 * Cek apakah SEMUA PO Line dari satu PurchaseOrder sudah tercukupi qty-nya
 * (total received >= quantity ordered, di semua line, tanpa terkecuali).
 *
 * Dipakai SETELAH GRLine baru berhasil di-insert, untuk menentukan apakah
 * status PurchaseOrder perlu di-auto-update ke "RECEIVED".
 *
 * PENTING: fungsi ini sengaja TIDAK menerima parameter tolerance terpisah
 * dari validateReceiptQuantity — "fully received" didefinisikan sebagai
 * received >= ordered (pakai qty asli, bukan qty+tolerance), supaya
 * status RECEIVED konsisten menandakan "barang yang DIPESAN sudah lengkap",
 * terlepas dari toleransi over-receipt yang mungkin diizinkan di validasi.
 */
export async function isPurchaseOrderFullyReceived(
  tx: TransactionClient,
  poId: string
): Promise<boolean> {
  const poLines = await tx.pOLine.findMany({
    where: { poId },
    select: { id: true, quantity: true },
  });

  for (const line of poLines) {
    const totalReceived = await getTotalReceivedQuantity(tx, line.id);
    if (totalReceived < Number(line.quantity)) {
      return false; // ada minimal 1 line yang belum tercukupi -> belum RECEIVED
    }
  }

  return true; // semua line sudah tercukupi
}