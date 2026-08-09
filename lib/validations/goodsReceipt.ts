import { z } from "zod";

// Skema 1 baris GR (1 batch untuk 1 PO Line).
// quantityOrdered SENGAJA TIDAK ADA di sini — itu diambil dari
// POLine.quantity di server (lib/generated/prisma), bukan dari input
// client, supaya client tidak bisa memanipulasi angka "dipesan"
// untuk meloloskan validasi qty.
export const createGrLineSchema = z.object({
  poLineId: z.string().uuid("poLineId harus UUID valid"),
  batchNumber: z.string().min(1, "Nomor batch wajib diisi"),
  expiryDate: z.coerce.date().optional(),
  quantityReceived: z.number().positive("Qty diterima harus lebih dari 0"),
  notes: z.string().optional(),
});

// Skema body request create GR.
// receivedBy TIDAK ADA di sini juga — selalu diambil dari session,
// bukan dari body, sesuai kesepakatan sebelumnya.
export const createGoodsReceiptSchema = z.object({
  receiptDate: z.coerce.date(),
  notes: z.string().optional(),
  lines: z.array(createGrLineSchema).min(1, "GR harus punya minimal 1 line"),
});

export type CreateGoodsReceiptInput = z.infer<typeof createGoodsReceiptSchema>;