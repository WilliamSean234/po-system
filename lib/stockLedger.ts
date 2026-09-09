// lib/stockLedger.ts
//
// ============================================================
// W5 — Inventory Management: Stock Ledger core logic
// ============================================================
// StockMovement    = SOURCE OF TRUTH (immutable, append-only).
// InventoryBalance = CACHE, hanya boleh ditulis lewat 2 jalur:
//   1. recordStockMovement()     -> incremental update (dipakai di flow normal:
//                                    GR create, GR reversal, stock transfer)
//   2. rebuildInventoryBalance() -> full recalculation dari SUM StockMovement
//                                    (dipakai untuk audit/recovery kalau dicurigai drift)
// TIDAK ADA kode di luar file ini yang boleh menulis ke InventoryBalance.
// Kalau ada kebutuhan baru yang "kelihatannya" perlu update InventoryBalance
// langsung, itu tanda bahwa kebutuhan itu harus lewat recordStockMovement,
// bukan pengecualian baru.
// ============================================================

import { Prisma } from "./generated/prisma";

// Tipe transaction client Prisma. Semua fungsi di file ini WAJIB dipanggil
// di dalam prisma.$transaction(async (tx) => { ... }) dari sisi caller,
// BUKAN dengan prisma client biasa — supaya StockMovement (ledger) dan
// InventoryBalance (cache) selalu konsisten atomik: kalau salah satu step
// gagal, keduanya rollback bersama, tidak pernah ada ledger yang "tercatat"
// tapi cache-nya tidak ikut ter-update (atau sebaliknya).
type TransactionClient = Prisma.TransactionClient;

// Kode movement type mengikuti kode gerakan SAP MM (movement type di MIGO).
// Didefinisikan sebagai konstanta supaya tidak ada string bebas/typo
// tersebar di berbagai endpoint yang memanggil recordStockMovement.
export const MOVEMENT_TYPE = {
  GR_RECEIPT: "101", // Goods Receipt masuk (stock in)
  GR_REVERSAL: "102", // Pembalik GR yang salah input (stock out) — dipakai di W6 GR Reversal
  TRANSFER_OUT: "311", // Keluar dari warehouse asal saat stock transfer
  TRANSFER_IN: "312", // Masuk ke warehouse tujuan saat stock transfer
} as const;

export const REFERENCE_TYPE = {
  GOODS_RECEIPT: "GOODS_RECEIPT",
  GOODS_RECEIPT_REVERSAL: "GOODS_RECEIPT_REVERSAL",
  STOCK_TRANSFER: "STOCK_TRANSFER",
} as const;

interface RecordStockMovementInput {
  tx: TransactionClient;
  tenantId: string;
  itemId: string;
  warehouseId: string;
  batchId?: string | null;
  quantity: Prisma.Decimal | number; // SIGNED: positif = stock in, negatif = stock out
  movementType: string; // gunakan konstanta MOVEMENT_TYPE di atas
  referenceType: string; // gunakan konstanta REFERENCE_TYPE di atas
  referenceId: string; // id dokumen sumber (GoodsReceipt.id, StockTransfer.id, dst)
  movementDate: Date;
  createdBy: string; // WAJIB dari session.user.id, sama seperti pola GoodsReceipt.receivedBy
  notes?: string;
}

/**
 * Mencatat 1 StockMovement (source of truth, immutable) DAN meng-update
 * InventoryBalance (cache) secara INCREMENTAL, dalam transaction yang sama.
 *
 * Fungsi ini TIDAK memvalidasi apakah quantity negatif akan membuat saldo
 * jadi minus — validasi "stok cukup/tidak" adalah tanggung jawab CALLER
 * sebelum memanggil fungsi ini (mis. validateTransferQuantity di W5T-transfer),
 * bukan tanggung jawab ledger. Ledger hanya mencatat apa yang terjadi.
 */
export async function recordStockMovement(input: RecordStockMovementInput) {
  const {
    tx,
    tenantId,
    itemId,
    warehouseId,
    batchId = null,
    quantity,
    movementType,
    referenceType,
    referenceId,
    movementDate,
    createdBy,
    notes,
  } = input;

  // 1. Tulis StockMovement — ini yang utama, source of truth. Tidak pernah
  //    di-update/delete setelah dibuat (konsisten dengan prinsip GR immutable).
  const movement = await tx.stockMovement.create({
    data: {
      tenantId,
      itemId,
      warehouseId,
      batchId,
      quantity,
      movementType,
      referenceType,
      referenceId,
      movementDate,
      createdBy,
      notes,
    },
  });

  // 2. Update InventoryBalance (cache) secara incremental.
  //    SENGAJA pakai findFirst + create/update manual, BUKAN
  //    prisma.inventoryBalance.upsert() — karena batchId nullable dan
  //    Postgres menganggap NULL != NULL untuk unique constraint, upsert()
  //    bawaan tidak bisa diandalkan mencocokkan row lama saat batchId null
  //    (lihat catatan lengkap di komentar atas file ini / respons chat).
  const existingBalance = await tx.inventoryBalance.findFirst({
    where: { tenantId, itemId, warehouseId, batchId },
  });

  if (existingBalance) {
    await tx.inventoryBalance.update({
      where: { id: existingBalance.id },
      data: { quantity: { increment: quantity } },
    });
  } else {
    await tx.inventoryBalance.create({
      data: { tenantId, itemId, warehouseId, batchId, quantity },
    });
  }

  return movement;
}

interface RebuildScope {
  tenantId: string;
  itemId?: string;
  warehouseId?: string;
  // batchId sengaja TIDAK didukung sebagai filter tunggal di sini karena
  // groupBy di bawah sudah otomatis memecah per kombinasi batchId — kalau
  // butuh rebuild 1 batch spesifik, filter hasil di sisi caller.
}

/**
 * Merekonstruksi ulang InventoryBalance dari SUM StockMovement.
 *
 * Dipakai untuk: (a) audit/reconciliation manual kalau dicurigai ada drift
 * antara cache dan ledger, (b) recovery kalau ada bug di masa lalu yang
 * membuat cache salah, (c) dijalankan sebagai admin action / cron terjadwal.
 *
 * TIDAK dipanggil di flow normal (recordStockMovement sudah cukup untuk
 * operasi sehari-hari) — fungsi ini murni untuk kasus "curiga ada
 * inkonsistensi", makanya scope-nya fleksibel: bisa rebuild seluruh tenant,
 * atau dipersempit ke 1 item / 1 warehouse tertentu saja.
 *
 * PENTING: berbeda dari recordStockMovement (increment), fungsi ini men-SET
 * ulang quantity ke hasil SUM yang sebenarnya — menimpa nilai cache lama
 * berapa pun itu.
 */
export async function rebuildInventoryBalance(tx: TransactionClient, scope: RebuildScope) {
  const { tenantId, itemId, warehouseId } = scope;

  // Agregasi SUM quantity dari StockMovement, dikelompokkan per kombinasi
  // (itemId, warehouseId, batchId) — persis granularitas InventoryBalance.
  const aggregated = await tx.stockMovement.groupBy({
    by: ["itemId", "warehouseId", "batchId"],
    where: {
      tenantId,
      ...(itemId ? { itemId } : {}),
      ...(warehouseId ? { warehouseId } : {}),
    },
    _sum: { quantity: true },
  });

  const results = await Promise.all(
    aggregated.map(async (group) => {
      const trueQuantity = group._sum.quantity ?? new Prisma.Decimal(0);

      const existingBalance = await tx.inventoryBalance.findFirst({
        where: {
          tenantId,
          itemId: group.itemId,
          warehouseId: group.warehouseId,
          batchId: group.batchId,
        },
      });

      if (existingBalance) {
        return tx.inventoryBalance.update({
          where: { id: existingBalance.id },
          data: { quantity: trueQuantity }, // SET langsung, bukan increment — ini rebuild
        });
      }
      return tx.inventoryBalance.create({
        data: {
          tenantId,
          itemId: group.itemId,
          warehouseId: group.warehouseId,
          batchId: group.batchId,
          quantity: trueQuantity,
        },
      });
    })
  );

  return {
    scopedCombinations: results.length,
    balances: results,
  };
}

/**
 * Membaca saldo stok TERKINI dari cache (InventoryBalance) — bukan dari
 * ledger. Dipakai di validasi (mis. "boleh transfer keluar berapa banyak")
 * dan di UI nanti. TIDAK melakukan SUM StockMovement di sini — itu tugas
 * rebuildInventoryBalance, bukan fungsi baca biasa, supaya baca saldo tetap
 * cepat (O(1) baca 1 row cache), sesuai tujuan awal cache dibuat.
 */
export async function getStockBalance(
  tx: TransactionClient,
  params: { tenantId: string; itemId: string; warehouseId: string; batchId?: string | null }
) {
  const { tenantId, itemId, warehouseId, batchId = null } = params;

  const balance = await tx.inventoryBalance.findFirst({
    where: { tenantId, itemId, warehouseId, batchId },
  });

  // Kalau belum pernah ada movement sama sekali untuk kombinasi ini,
  // saldo dianggap 0 — bukan error, karena secara bisnis itu valid
  // (item belum pernah masuk ke warehouse/batch tersebut).
  return balance?.quantity ?? new Prisma.Decimal(0);
}