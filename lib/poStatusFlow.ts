// lib/poStatusFlow.ts
// Konfigurasi status flow Purchase Order.
// SENGAJA disimpan sebagai konstanta di kode (bukan Prisma enum) supaya:
// 1. Nambah/ubah status baru gak perlu migration database
// 2. Nanti kalau mau bikin "custom status flow per tenant" (on-the-horizon item),
//    tinggal ganti VALID_TRANSITIONS jadi fungsi yang baca config per tenant,
//    tanpa perlu ubah schema atau data yang udah ada.

// Alur utama PO (linear)
export const PO_MAIN_FLOW = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "PO_SENT",
  "RECEIVED",
  "CLOSED",
] as const;

// Status cabang, di luar alur utama
export const PO_BRANCH_STATUSES = ["REJECTED", "CANCELLED"] as const;

export const ALL_PO_STATUSES = [...PO_MAIN_FLOW, ...PO_BRANCH_STATUSES] as const;

export type PoStatus = (typeof ALL_PO_STATUSES)[number];

// Peta transisi valid: key = status sekarang, value = status yang boleh dituju dari situ.
// Kalau status tujuan gak ada di list ini, transisi DITOLAK.
export const VALID_TRANSITIONS: Record<PoStatus, PoStatus[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["PO_SENT", "CANCELLED"],
  PO_SENT: ["RECEIVED", "CANCELLED"],
  RECEIVED: ["CLOSED"],
  CLOSED: [], // status akhir, gak bisa pindah kemana-mana lagi
  REJECTED: ["DRAFT"], // PO yang ditolak bisa direvisi ulang jadi Draft
  CANCELLED: [], // status akhir, gak bisa pindah kemana-mana lagi
};

/**
 * Cek apakah transisi dari satu status ke status lain itu valid.
 * Dipakai di handler PUT /api/purchase-orders/[id] sebelum update status.
 */
export function isValidTransition(from: string, to: string): boolean {
  if (!ALL_PO_STATUSES.includes(from as PoStatus)) return false;
  if (!ALL_PO_STATUSES.includes(to as PoStatus)) return false;
  return VALID_TRANSITIONS[from as PoStatus].includes(to as PoStatus);
}

/**
 * Cek apakah suatu string adalah status PO yang valid/dikenal sistem.
 * Dipakai buat validasi Zod & guard sebelum create.
 */
export function isKnownPoStatus(status: string): status is PoStatus {
  return ALL_PO_STATUSES.includes(status as PoStatus);
}

// Status di mana lines (item PO) SUDAH TERKUNCI, tidak boleh diubah lagi.
// Mencerminkan aturan SAP: PO yang sudah lewat release strategy (approved)
// atau sudah ada dokumen turunan, line-nya dikunci dari perubahan.
export const LINE_LOCKED_STATUSES: PoStatus[] = [
  "APPROVED",
  "PO_SENT",
  "RECEIVED",
  "CLOSED",
  "CANCELLED",
];

export function areLinesLocked(status: string): boolean {
  return LINE_LOCKED_STATUSES.includes(status as PoStatus);
}