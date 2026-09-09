import { z } from "zod";

// Skema 1 baris GR (1 batch untuk 1 PO Line).
// quantityOrdered SENGAJA TIDAK ADA di sini — itu diambil dari
// POLine.quantity di server (lib/generated/prisma), bukan dari input
// client, supaya client tidak bisa memanipulasi angka "dipesan"
// untuk meloloskan validasi qty.
//
// W5 (Inventory Management): batchNumber(string)+expiryDate(Date?) DIGANTI
// batchId — sekarang wajib merujuk ke Batch master (single source of truth
// untuk nomor batch & expiry, lihat model Batch di schema.prisma). Validasi
// bahwa batchId ini benar-benar milik item yang sama dengan poLineId
// dilakukan di server (route.ts), bukan di sini — Zod cuma memastikan
// bentuknya UUID valid.
export const createGrLineSchema = z.object({
  poLineId: z.string().uuid("poLineId harus UUID valid"),
  batchId: z.string().uuid("batchId harus UUID valid"),
  quantityReceived: z.number().positive("Qty diterima harus lebih dari 0"),
  notes: z.string().optional(),
});

// Skema body request create GR.
// receivedBy TIDAK ADA di sini juga — selalu diambil dari session,
// bukan dari body, sesuai kesepakatan sebelumnya.
//
// W5 (Inventory Management): warehouseId BARU, wajib diisi — gudang tujuan
// barang masuk. GoodsReceipt.warehouseId sekarang wajib di schema.prisma,
// dan dipakai juga sebagai parameter recordStockMovement() di route.ts.
export const createGoodsReceiptSchema = z.object({
  warehouseId: z.string().uuid("warehouseId harus UUID valid"),
  receiptDate: z.coerce.date(),
  notes: z.string().optional(),
  lines: z.array(createGrLineSchema).min(1, "GR harus punya minimal 1 line"),
});

export type CreateGoodsReceiptInput = z.infer<typeof createGoodsReceiptSchema>;