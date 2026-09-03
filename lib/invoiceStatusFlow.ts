// lib/invoiceStatusFlow.ts
// Konfigurasi status flow Invoice — pola SAP MIRO (Logistics Invoice
// Verification). Ditulis sebagai konstanta di kode (bukan Prisma enum),
// konsisten dengan poStatusFlow.ts, untuk alasan yang sama: nambah/ubah
// status gak perlu migration, dan siap untuk custom flow per tenant nanti.

// Alur utama Invoice (linear)
export const INVOICE_MAIN_FLOW = [
  "DRAFT",
  "SUBMITTED",
  "MATCHED",
  "PAID",
] as const;

// Status cabang, di luar alur utama
export const INVOICE_BRANCH_STATUSES = ["DISPUTED", "CANCELLED"] as const;

export const ALL_INVOICE_STATUSES = [
  ...INVOICE_MAIN_FLOW,
  ...INVOICE_BRANCH_STATUSES,
] as const;

export type InvoiceStatus = (typeof ALL_INVOICE_STATUSES)[number];

// Peta transisi valid: key = status sekarang, value = status yang boleh dituju.
//
// CATATAN KHUSUS: DISPUTED -> MATCHED ADA di peta ini (transisi-nya memang
// valid secara flow), TAPI endpoint generic "update status" tidak boleh
// mengizinkan transisi ini langsung dari user manapun — hanya endpoint
// khusus /resolve-dispute yang boleh melakukannya, dan endpoint itu WAJIB
// cek permission "invoice.resolve_dispute" (lewat hasPermission) SEBELUM
// panggil isValidTransition. isValidTransition di sini cuma menjawab
// "apakah alurnya sah", bukan "apakah user ini berwenang" — otorisasi
// tetap tanggung jawab endpoint, bukan file ini.
export const VALID_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["MATCHED", "DISPUTED", "CANCELLED"], // hasil auto-match saat submit
  DISPUTED: ["MATCHED", "CANCELLED"], // MATCHED di sini hanya lewat endpoint resolve
  MATCHED: ["PAID", "CANCELLED"],
  PAID: [], // status akhir — pembatalan invoice yang sudah dibayar butuh
             // proses accounting terpisah (credit note dll), didefer
  CANCELLED: [], // status akhir
};

/**
 * Cek apakah transisi dari satu status ke status lain itu valid.
 * Dipakai di handler PUT/POST endpoint Invoice sebelum update status.
 */
export function isValidTransition(from: string, to: string): boolean {
  if (!ALL_INVOICE_STATUSES.includes(from as InvoiceStatus)) return false;
  if (!ALL_INVOICE_STATUSES.includes(to as InvoiceStatus)) return false;
  return VALID_TRANSITIONS[from as InvoiceStatus].includes(to as InvoiceStatus);
}

/**
 * Cek apakah suatu string adalah status Invoice yang valid/dikenal sistem.
 * Dipakai buat validasi Zod & guard sebelum create.
 */
export function isKnownInvoiceStatus(status: string): status is InvoiceStatus {
  return ALL_INVOICE_STATUSES.includes(status as InvoiceStatus);
}

// Status di mana lines (baris invoice) SUDAH TERKUNCI, tidak boleh diubah
// lagi. Beda dari PO: DRAFT invoice masih BOLEH edit lines bebas (staf
// finance masih input data dari kertas invoice), lines baru dikunci begitu
// SUBMITTED — karena submit memicu matching otomatis yang harus dijalankan
// terhadap snapshot lines yang stabil.
//
// PAKAI INI HANYA untuk pertanyaan "boleh diedit atau tidak" (areInvoiceLinesLocked).
// JANGAN dipakai untuk menghitung cumulative qty invoiced — untuk itu pakai
// INVOICE_QUANTITY_LOCKED_STATUSES di bawah, yang SENGAJA beda isinya.
export const INVOICE_LINE_LOCKED_STATUSES: InvoiceStatus[] = [
  "SUBMITTED",
  "MATCHED",
  "DISPUTED",
  "PAID",
  "CANCELLED",
];

export function areInvoiceLinesLocked(status: string): boolean {
  return INVOICE_LINE_LOCKED_STATUSES.includes(status as InvoiceStatus);
}


// Status yang IKUT DIHITUNG sebagai qty "sudah diinvoice" saat validasi
// cumulative terhadap GR (dipakai HANYA di invoiceMatching.ts,
// getTotalInvoicedQuantity). SENGAJA TIDAK termasuk CANCELLED, berbeda
// dari INVOICE_LINE_LOCKED_STATUSES di atas — invoice yang dibatalkan
// tidak pernah jadi tagihan sungguhan, jadi tidak boleh mengunci kuota
// qty milik PO Line ini untuk invoice lain. Ini bug yang pernah kejadian:
// sebelumnya invoiceMatching.ts salah reuse INVOICE_LINE_LOCKED_STATUSES
// (yang isinya termasuk CANCELLED) untuk keperluan ini, akibatnya invoice
// yang sudah di-cancel tetap "mengunci" qty selamanya.
export const INVOICE_QUANTITY_LOCKED_STATUSES: InvoiceStatus[] = [
  "SUBMITTED",
  "MATCHED",
  "DISPUTED",
  "PAID",
];

/**
 * Helper khusus: apakah invoice pada status ini boleh di-cancel?
 * Dipakai di endpoint cancel untuk pesan error yang lebih spesifik
 * daripada generic "transisi tidak diizinkan".
 */
export function canCancelInvoice(status: string): boolean {
  return isValidTransition(status, "CANCELLED");
}

/**
 * Helper khusus: apakah invoice pada status ini boleh di-soft-delete?
 * BEDA dari cancel — delete hanya untuk DRAFT (kesalahan input sebelum
 * submit, belum pernah masuk siklus matching), sedangkan cancel untuk
 * SUBMITTED/DISPUTED/MATCHED yang sudah "resmi" tapi dibatalkan.
 */
export function canDeleteInvoice(status: string): boolean {
  return status === "DRAFT";
}