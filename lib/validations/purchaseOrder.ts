import { z } from "zod";

// Skema untuk satu baris item PO
const poLineSchema = z.object({
  itemId: z.string().uuid({ message: "itemId harus UUID valid" }),
  description: z.string().optional(),
  quantity: z.number().positive({ message: "quantity harus lebih dari 0" }),
  unitPrice: z.number().nonnegative({ message: "unitPrice tidak boleh negatif" }),
});

// Skema create PO: header + lines sekaligus (sesuai keputusan desain W2)
export const purchaseOrderCreateSchema = z.object({
  vendorId: z.string().uuid({ message: "vendorId harus UUID valid" }),
  deliveryDate: z.string().datetime().optional().nullable(),
  notes: z.string().optional(),
  lines: z.array(poLineSchema).min(1, { message: "PO harus punya minimal 1 line item" }),
});

// Skema untuk PUT (update). Semua field optional (partial update).
// - Kalau `status` dikirim, divalidasi transisinya lewat isValidTransition() di handler.
// - Kalau `lines` dikirim, artinya user mau REPLACE seluruh lines (bukan tambah sebagian),
//   dan hanya diizinkan kalau status PO masih di tahap yang boleh diedit (dicek di handler).
export const purchaseOrderUpdateSchema = z.object({
  vendorId: z.string().uuid().optional(),
  status: z.string().optional(),
  notes: z.string().optional(),
  deliveryDate: z.string().datetime().optional().nullable(),
  lines: z.array(poLineSchema).min(1, { message: "Kalau lines dikirim, minimal harus ada 1 item" }).optional(),
});

export type PurchaseOrderCreateInput = z.infer<typeof purchaseOrderCreateSchema>;
export type PurchaseOrderUpdateInput = z.infer<typeof purchaseOrderUpdateSchema>;