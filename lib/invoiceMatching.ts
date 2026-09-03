import { Prisma } from "../lib/generated/prisma";
import { getTotalReceivedQuantity } from "./goodsReceiptValidation";
import { INVOICE_QUANTITY_LOCKED_STATUSES } from "./invoiceStatusFlow";

type TransactionClient = Prisma.TransactionClient;

/**
 * Custom error class untuk validasi qty Invoice. Pola sama persis seperti
 * GoodsReceiptValidationError — dipisah dari Error biasa supaya API route
 * bisa bedakan "validasi qty gagal" (400 Bad Request) vs error lain (500).
 *
 * BEDA PENTING dari GoodsReceiptValidationError: batas atas di sini adalah
 * quantityReceived (dari GRLine), BUKAN quantityOrdered (dari POLine).
 * Ini inti dari 3-way match: PO -> GR -> Invoice, tiap tahap dibatasi
 * oleh tahap sebelumnya, bukan oleh PO secara langsung.
 */
export class InvoiceValidationError extends Error {
  constructor(
    message: string,
    public readonly poLineId: string,
    public readonly quantityReceived: number,
    public readonly alreadyInvoiced: number,
    public readonly attemptedQuantity: number
  ) {
    super(message);
    this.name = "InvoiceValidationError";
  }
}

/**
 * Hitung total qty yang SUDAH diinvoice untuk satu PO Line tertentu,
 * dijumlahkan lintas SEMUA Invoice yang berstatus "locked"
 * (SUBMITTED/MATCHED/DISPUTED/PAID — lihat INVOICE_LINE_LOCKED_STATUSES
 * di invoiceStatusFlow.ts), TIDAK termasuk CANCELLED atau DRAFT.
 *
 * Kenapa DRAFT tidak dihitung: invoice DRAFT belum "resmi" masuk siklus
 * matching — lines-nya masih bisa diedit bebas, jadi tidak boleh
 * mengunci/mengurangi kuota invoice-able milik invoice lain. Baru
 * dihitung begitu invoice itu sendiri SUBMITTED.
 *
 * Kenapa CANCELLED tidak dihitung: invoice yang dibatalkan tidak pernah
 * jadi tagihan sungguhan, jadi tidak boleh mengunci kuota.
 */
export async function getTotalInvoicedQuantity(
  tx: TransactionClient,
  poLineId: string
): Promise<number> {
  const result = await tx.invoiceLine.aggregate({
    where: {
      poLineId,
      invoice: {
        status: { in: INVOICE_QUANTITY_LOCKED_STATUSES },
      },
    },
    _sum: { quantity: true },
  });

  return result._sum.quantity ? Number(result._sum.quantity) : 0;
}

/**
 * Validasi apakah qty yang mau diinvoice (attemptedQuantity) untuk satu
 * PO Line masih dalam batas qty yang SUDAH DITERIMA (GR), bukan batas
 * qty yang dipesan (PO). Ini bedanya invoice matching dari GR matching:
 * GR dibatasi oleh PO, Invoice dibatasi oleh GR.
 *
 * tolerancePercent: default 0, parameter (bukan hardcode) dengan alasan
 * yang sama seperti validateReceiptQuantity — supaya nanti gampang
 * diperluas jadi configurable per tenant/item tanpa refactor signature.
 *
 * Throw InvoiceValidationError kalau melebihi batas.
 */
export async function validateInvoiceQuantity(
  tx: TransactionClient,
  poLineId: string,
  attemptedQuantity: number,
  tolerancePercent: number = 0
): Promise<void> {
  if (attemptedQuantity <= 0) {
    throw new InvoiceValidationError(
      "Qty yang diinvoice harus lebih besar dari 0",
      poLineId,
      0,
      0,
      attemptedQuantity
    );
  }

  const quantityReceived = await getTotalReceivedQuantity(tx, poLineId);
  const alreadyInvoiced = await getTotalInvoicedQuantity(tx, poLineId);
  const maxAllowed = quantityReceived * (1 + tolerancePercent / 100);
  const totalAfterThisInvoice = alreadyInvoiced + attemptedQuantity;

  if (totalAfterThisInvoice > maxAllowed) {
    const remaining = maxAllowed - alreadyInvoiced;
    throw new InvoiceValidationError(
      `Qty melebihi batas. Sudah diinvoice ${alreadyInvoiced}, diterima (GR) ${quantityReceived}` +
        (tolerancePercent > 0 ? ` (toleransi +${tolerancePercent}%)` : "") +
        `. Sisa yang boleh diinvoice: ${remaining < 0 ? 0 : remaining}`,
      poLineId,
      quantityReceived,
      alreadyInvoiced,
      attemptedQuantity
    );
  }
}

/**
 * Cek apakah satu baris invoice punya price variance terhadap POLine.
 * TIDAK throw — return boolean, karena price variance BUKAN hard block
 * (beda dari quantity), melainkan penanda status DISPUTED. Keputusan
 * "apa yang terjadi kalau variance" ada di pemanggil (runInvoiceMatching),
 * bukan di fungsi ini — fungsi ini murni deteksi.
 *
 * tolerancePercent: default 0 (harus sama persis). Parameter, bukan
 * hardcode, dengan alasan sama seperti fungsi qty di atas.
 */
export function hasPriceVariance(
  poLineUnitPrice: number,
  invoiceLineUnitPrice: number,
  tolerancePercent: number = 0
): boolean {
  const maxAllowed = poLineUnitPrice * (1 + tolerancePercent / 100);
  const minAllowed = poLineUnitPrice * (1 - tolerancePercent / 100);
  return invoiceLineUnitPrice > maxAllowed || invoiceLineUnitPrice < minAllowed;
}

export type MatchResult = "MATCHED" | "DISPUTED";

/**
 * Jalankan matching penuh untuk satu Invoice: validasi qty SEMUA lines
 * (throw kalau ada yang melebihi batas GR — hard block, invoice tidak
 * bisa SUBMITTED sama sekali), lalu cek price variance di semua lines
 * (tidak throw — kalau ada satu saja yang variance, hasil akhirnya
 * DISPUTED; kalau semua match persis, hasilnya MATCHED).
 *
 * Dipanggil dari endpoint POST /api/invoices/[id]/submit, DI DALAM
 * transaction yang sama dengan update status, supaya validasi dan
 * commit status atomic (tidak ada invoice yang lolos ke SUBMITTED
 * dengan qty invalid karena race condition antar-request).
 *
 * quantity tolerance dan price tolerance DIPISAH parameternya secara
 * sengaja — SME mungkin mau toleransi qty 0% (ketat, tidak boleh over-
 * invoice sama sekali) tapi toleransi price beberapa persen (pembulatan
 * kecil dari vendor), atau sebaliknya. Tidak dipaksa satu angka untuk
 * keduanya.
 */
export async function runInvoiceMatching(
  tx: TransactionClient,
  invoiceId: string,
  quantityTolerancePercent: number = 0,
  priceTolerancePercent: number = 0
): Promise<MatchResult> {
  const invoiceLines = await tx.invoiceLine.findMany({
    where: { invoiceId },
    include: { poLine: { select: { unitPrice: true } } },
  });

  if (invoiceLines.length === 0) {
    throw new InvoiceValidationError(
      "Invoice tidak punya baris sama sekali, tidak bisa di-submit",
      "",
      0,
      0,
      0
    );
  }

  let hasVariance = false;

  // Validasi qty dulu untuk SEMUA lines sebelum putuskan hasil akhir —
  // kalau ada satu saja yang melebihi batas GR, langsung throw (hard
  // block), tidak lanjut ke pengecekan price sama sekali.
  for (const line of invoiceLines) {
    await validateInvoiceQuantity(
      tx,
      line.poLineId,
      Number(line.quantity),
      quantityTolerancePercent
    );

    if (
      hasPriceVariance(
        Number(line.poLine.unitPrice),
        Number(line.unitPrice),
        priceTolerancePercent
      )
    ) {
      hasVariance = true; // tetap lanjut cek line lain, tidak break —
                            // supaya validasi qty line berikutnya tetap jalan
    }
  }

  return hasVariance ? "DISPUTED" : "MATCHED";
}