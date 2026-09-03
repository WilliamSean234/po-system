import { z } from "zod";

// Skema untuk satu baris invoice.
// BEDA dari poLineSchema: pakai poLineId (referensi ke POLine yang sudah
// ada), bukan itemId — karena InvoiceLine merujuk ke POLine spesifik untuk
// validasi cumulative terhadap GRLine (lihat invoiceMatching.ts), bukan ke
// Item langsung. unitPrice di sini SENGAJA independen dari POLine.unitPrice
// (boleh beda) — itulah yang dicek sebagai price variance saat submit.
const invoiceLineSchema = z.object({
  poLineId: z.string().uuid({ message: "poLineId harus UUID valid" }),
  quantity: z.number().positive({ message: "quantity harus lebih dari 0" }),
  unitPrice: z.number().nonnegative({ message: "unitPrice tidak boleh negatif" }),
  notes: z.string().optional(),
});

// Skema create Invoice: header + lines sekaligus (pola sama seperti PO).
// Status TIDAK ada di sini — selalu DRAFT saat create, tidak bisa di-set
// dari body (konsisten dengan PO yang juga selalu DRAFT saat create).
export const invoiceCreateSchema = z.object({
  poId: z.string().uuid({ message: "poId harus UUID valid" }),
  invoiceDate: z.string().datetime({ message: "invoiceDate harus format ISO datetime valid" }),
  dueDate: z.string().datetime().optional().nullable(),
  notes: z.string().optional(),
  lines: z.array(invoiceLineSchema).min(1, { message: "Invoice harus punya minimal 1 line item" }),
});

// Skema update Invoice — HANYA dipakai selagi status masih DRAFT (dicek di
// handler lewat areInvoiceLinesLocked/canDeleteInvoice, bukan di sini).
// Tidak ada field `status` di sini sama sekali — transisi status Invoice
// SELALU lewat endpoint action khusus (/submit, /resolve-dispute,
// /mark-paid, /cancel), bukan generic PUT. Ini beda dari PO yang punya
// satu PUT umum dengan field status opsional — Invoice sengaja dipecah
// per-aksi karena tiap transisi punya efek samping berbeda (matching,
// permission check resolve_dispute, dst) yang lebih jelas kalau endpoint-nya
// terpisah, bukan dicampur logic-nya di satu handler PUT besar.
export const invoiceUpdateSchema = z.object({
  invoiceDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().optional().nullable(),
  notes: z.string().optional(),
  lines: z.array(invoiceLineSchema).min(1, { message: "Kalau lines dikirim, minimal harus ada 1 item" }).optional(),
});

export type InvoiceCreateInput = z.infer<typeof invoiceCreateSchema>;
export type InvoiceUpdateInput = z.infer<typeof invoiceUpdateSchema>;