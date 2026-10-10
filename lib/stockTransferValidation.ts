// lib/stockTransferValidation.ts
//
// W5T3 — Validasi Stock Transfer. Semua fungsi menerima `tx` (bukan prisma
// global) karena dipanggil dari dalam prisma.$transaction di route.

import { Prisma } from "./generated/prisma";
import { getStockBalance } from "./stockLedger";

type TransactionClient = Prisma.TransactionClient;

/**
 * Error khusus validasi transfer. Dipisah dari Error biasa supaya route
 * bisa membedakan "validasi gagal" (400) vs error sistem (500).
 */
export class StockTransferValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockTransferValidationError";
  }
}

export interface TransferLineInput {
  itemId: string;
  batchId: string;
  quantity: number;
  notes?: string;
}

export interface ConsolidatedTransferLine {
  itemId: string;
  batchId: string;
  quantity: Prisma.Decimal;
}

// Batch beserta item-nya, dipakai ulang untuk pesan error yang informatif.
export type BatchWithItem = Prisma.BatchGetPayload<{
  include: { item: { select: { id: true; code: true; name: true } } };
}>;

/**
 * Jumlahkan line yang item+batch-nya sama. WAJIB dilakukan sebelum cek
 * stok: kalau stok 100 dan ada 2 line item+batch sama masing-masing 60,
 * tiap line sendiri lolos cek tapi totalnya 120 (melebihi stok).
 * Pakai Prisma.Decimal (bukan Number) supaya tidak kena error floating point.
 */
export function consolidateTransferLines(
  lines: TransferLineInput[]
): ConsolidatedTransferLine[] {
  const map = new Map<string, ConsolidatedTransferLine>();

  for (const line of lines) {
    const key = `${line.itemId}:${line.batchId}`;
    const qty = new Prisma.Decimal(line.quantity);
    const existing = map.get(key);

    if (existing) {
      existing.quantity = existing.quantity.plus(qty);
    } else {
      map.set(key, { itemId: line.itemId, batchId: line.batchId, quantity: qty });
    }
  }

  return [...map.values()];
}

/**
 * Validasi referensi master data: gudang asal/tujuan, serta item+batch tiap line.
 * Return map batchId -> batch (+item) untuk dipakai membuat pesan error stok.
 */
export async function validateTransferReferences(
  tx: TransactionClient,
  params: {
    tenantId: string;
    sourceWarehouseId: string;
    destinationWarehouseId: string;
    lines: TransferLineInput[];
  }
): Promise<{ batchById: Map<string, BatchWithItem> }> {
  const { tenantId, sourceWarehouseId, destinationWarehouseId, lines } = params;

  if (sourceWarehouseId === destinationWarehouseId) {
    throw new StockTransferValidationError(
      "Warehouse asal dan tujuan tidak boleh sama"
    );
  }

  const warehouses = await tx.warehouse.findMany({
    where: {
      id: { in: [sourceWarehouseId, destinationWarehouseId] },
      tenantId,
      isDeleted: false,
      isActive: true,
    },
    select: { id: true },
  });
  const foundIds = new Set(warehouses.map((w) => w.id));

  if (!foundIds.has(sourceWarehouseId)) {
    throw new StockTransferValidationError(
      "Warehouse asal tidak ditemukan atau tidak aktif"
    );
  }
  if (!foundIds.has(destinationWarehouseId)) {
    throw new StockTransferValidationError(
      "Warehouse tujuan tidak ditemukan atau tidak aktif"
    );
  }

  const batchIds = [...new Set(lines.map((l) => l.batchId))];
  const batches = await tx.batch.findMany({
    where: { id: { in: batchIds }, tenantId },
    include: { item: { select: { id: true, code: true, name: true } } },
  });
  const batchById = new Map(batches.map((b) => [b.id, b]));

  for (const line of lines) {
    const batch = batchById.get(line.batchId);
    if (!batch) {
      throw new StockTransferValidationError(
        `batchId ${line.batchId} tidak ditemukan`
      );
    }
    if (batch.itemId !== line.itemId) {
      throw new StockTransferValidationError(
        `batchId ${line.batchId} bukan milik itemId ${line.itemId} (batch harus terdaftar untuk item yang sama)`
      );
    }
  }

  // Cek item aktif/tidak deleted (1 query untuk semua item unik).
  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  const activeItems = await tx.item.findMany({
    where: { id: { in: itemIds }, tenantId, isDeleted: false, isActive: true },
    select: { id: true },
  });
  const activeItemIds = new Set(activeItems.map((i) => i.id));

  for (const itemId of itemIds) {
    if (!activeItemIds.has(itemId)) {
      throw new StockTransferValidationError(
        `Item ${itemId} tidak ditemukan atau tidak aktif`
      );
    }
  }

  return { batchById };
}

/**
 * Cek stok warehouse asal cukup untuk SETIAP kombinasi item+batch
 * (setelah line duplikat dijumlahkan).
 */
export async function validateSufficientStock(
  tx: TransactionClient,
  params: {
    tenantId: string;
    sourceWarehouseId: string;
    consolidated: ConsolidatedTransferLine[];
    batchById: Map<string, BatchWithItem>;
  }
): Promise<void> {
  const { tenantId, sourceWarehouseId, consolidated, batchById } = params;

  for (const line of consolidated) {
    const available = await getStockBalance(tx, {
      tenantId,
      itemId: line.itemId,
      warehouseId: sourceWarehouseId,
      batchId: line.batchId,
    });

    if (available.lt(line.quantity)) {
      const batch = batchById.get(line.batchId);
      const label = batch
        ? `${batch.item.code} - ${batch.item.name} (batch ${batch.batchNumber})`
        : line.batchId;

      throw new StockTransferValidationError(
        `Stok tidak mencukupi untuk ${label}. Tersedia ${available.toString()}, diminta ${line.quantity.toString()}`
      );
    }
  }
}

/**
 * Safety net konkurensi: dipanggil SETELAH semua movement keluar dicatat.
 * Dua transfer bersamaan bisa sama-sama lolos cek awal; karena update
 * InventoryBalance mengunci row-nya, transaction kedua melihat hasil yang
 * benar di sini. Kalau saldo jadi negatif, lempar error -> transaction
 * rollback, jadi stok tidak pernah benar-benar minus.
 */
export async function assertNoNegativeBalanceAfterTransfer(
  tx: TransactionClient,
  params: {
    tenantId: string;
    sourceWarehouseId: string;
    consolidated: ConsolidatedTransferLine[];
  }
): Promise<void> {
  const { tenantId, sourceWarehouseId, consolidated } = params;

  for (const line of consolidated) {
    const balance = await getStockBalance(tx, {
      tenantId,
      itemId: line.itemId,
      warehouseId: sourceWarehouseId,
      batchId: line.batchId,
    });

    if (balance.isNegative()) {
      throw new StockTransferValidationError(
        "Stok tidak mencukupi (terdeteksi transaksi lain yang berjalan bersamaan). Silakan coba lagi."
      );
    }
  }
}