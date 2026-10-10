// lib/validations/stockTransfer.ts
import { z } from "zod";

// 1 baris transfer = 1 kombinasi item + batch. batchId WAJIB di API
// (walaupun nullable di schema) karena semua stok berasal dari GR yang
// selalu punya batch. Kecocokan itemId <-> batchId divalidasi di server
// (lib/stockTransferValidation.ts), bukan di sini.
export const createStockTransferLineSchema = z.object({
  itemId: z.string().uuid("itemId harus UUID valid"),
  batchId: z.string().uuid("batchId harus UUID valid"),
  quantity: z.number().positive("Qty transfer harus lebih dari 0"),
  notes: z.string().optional(),
});

// createdBy TIDAK ADA di sini — selalu dari session, bukan dari body.
export const createStockTransferSchema = z.object({
  sourceWarehouseId: z.string().uuid("sourceWarehouseId harus UUID valid"),
  destinationWarehouseId: z.string().uuid("destinationWarehouseId harus UUID valid"),
  transferDate: z.coerce.date(),
  notes: z.string().optional(),
  lines: z
    .array(createStockTransferLineSchema)
    .min(1, "Transfer harus punya minimal 1 line"),
});

export type CreateStockTransferInput = z.infer<typeof createStockTransferSchema>;