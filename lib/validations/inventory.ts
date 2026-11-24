// lib/validations/inventory.ts
import { z } from "zod";

// Query param selalu string, jadi angka/tanggal pakai z.coerce.
const paginationShape = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
};

// GET /api/inventory/balance
export const balanceQuerySchema = z.object({
  itemId: z.string().uuid("itemId harus UUID valid").optional(),
  warehouseId: z.string().uuid("warehouseId harus UUID valid").optional(),
  batchId: z.string().uuid("batchId harus UUID valid").optional(),
  // Baris saldo 0 disembunyikan kecuali includeZero=true.
  includeZero: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  ...paginationShape,
});

// GET /api/inventory/movements
export const movementsQuerySchema = z.object({
  itemId: z.string().uuid("itemId harus UUID valid").optional(),
  warehouseId: z.string().uuid("warehouseId harus UUID valid").optional(),
  batchId: z.string().uuid("batchId harus UUID valid").optional(),
  referenceType: z
    .enum(["GOODS_RECEIPT", "GOODS_RECEIPT_REVERSAL", "STOCK_TRANSFER"])
    .optional(),
  referenceId: z.string().uuid("referenceId harus UUID valid").optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  ...paginationShape,
});

// POST /api/inventory/rebuild
// dryRun default TRUE: tanpa mengirim apa pun, endpoint hanya melaporkan
// selisih cache vs ledger. Cache baru ditimpa kalau dryRun dikirim false.
export const rebuildBodySchema = z.object({
  itemId: z.string().uuid("itemId harus UUID valid").optional(),
  warehouseId: z.string().uuid("warehouseId harus UUID valid").optional(),
  dryRun: z.boolean().default(true),
});