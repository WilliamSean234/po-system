// lib/documentSequence.ts
//
// Penomoran dokumen ATOMIK per (tenant, jenis dokumen, periode YYYYMM).
//
// Kenapa bukan count()+1 atau max()+1 seperti sebelumnya:
//   - Di READ COMMITTED (default Postgres) dua transaksi bisa membaca count yang
//     sama lalu sama-sama insert -> nomor kembar -> unique violation (P2002).
//   - Retry setelah P2002 DI DALAM transaksi yang sama tidak bisa berhasil:
//     Postgres menandai transaksi "aborted" dan menolak semua query berikutnya.
//
// Cara kerja sekarang: satu statement INSERT .. ON CONFLICT DO UPDATE .. RETURNING.
//   - Atomik: Postgres mengunci baris sequence sampai transaksi pemanggil commit,
//     jadi pemanggil lain di (tenant, jenis, periode) yang sama mengantre, bukan
//     bentrok. Tidak ada nomor kembar, tidak perlu retry.
//   - Tanpa lubang: kalau transaksi pemanggil rollback, kenaikan sequence ikut
//     rollback (nomor dipakai ulang, bukan terlewat).
//   - Konsekuensi: pembuatan dokumen sejenis di tenant yang sama pada bulan yang sama
//     berjalan berurutan. Karena itu panggil nextDocumentNumber() SETELAH semua
//     validasi lolos dan tepat sebelum insert, supaya lock ditahan sesingkat mungkin.
//
// WAJIB dipanggil di dalam prisma.$transaction (terima `tx`), bersama insert dokumennya.

import type { Prisma } from "./generated/prisma";

export const DOC_TYPE = {
  PO: "PO",
  GR: "GR",
  INVOICE: "INV",
  TRANSFER: "TRF",
} as const;

export type DocType = (typeof DOC_TYPE)[keyof typeof DOC_TYPE];

// Zona waktu bisnis untuk menentukan "bulan berjalan". Sebelumnya memakai jam
// server (new Date().getMonth()), sehingga di server berzona UTC dokumen yang
// dibuat 00:30 WIB tanggal 1 masih dapat nomor bulan lama. Bisa diganti lewat
// env APP_TIMEZONE (nama zona IANA, mis. "Asia/Makassar").
const DEFAULT_TIMEZONE = "Asia/Jakarta";

/** Periode "YYYYMM" untuk sebuah tanggal, dihitung di zona waktu bisnis. */
export function getPeriod(date: Date = new Date(), timeZone?: string): string {
  const tz = timeZone ?? process.env.APP_TIMEZONE ?? DEFAULT_TIMEZONE;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  if (!year || !month) {
    throw new Error(`Gagal menentukan periode dokumen untuk zona waktu "${tz}"`);
  }
  return `${year}${month}`;
}

/** Contoh: formatDocumentNumber("GR", "202611", 7) -> "GR-202611-0007". */
export function formatDocumentNumber(
  docType: DocType,
  period: string,
  sequence: number
): string {
  return `${docType}-${period}-${String(sequence).padStart(4, "0")}`;
}

export async function nextDocumentNumber(
  tx: Prisma.TransactionClient,
  tenantId: string,
  docType: DocType,
  date: Date = new Date()
): Promise<string> {
  const period = getPeriod(date);

  const rows = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "DocumentSequence" ("tenantId", "docType", "period", "lastValue")
    VALUES (${tenantId}, ${docType}, ${period}, 1)
    ON CONFLICT ("tenantId", "docType", "period")
    DO UPDATE SET "lastValue" = "DocumentSequence"."lastValue" + 1
    RETURNING "lastValue"
  `;

  const sequence = rows[0]?.lastValue;
  if (typeof sequence !== "number") {
    throw new Error(`Gagal mengambil nomor urut dokumen ${docType} (${period})`);
  }
  return formatDocumentNumber(docType, period, sequence);
}
