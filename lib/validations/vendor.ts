import { z } from "zod";

// Schema untuk create vendor (POST)
// NOTE: "code" TIDAK termasuk di sini — itu di-generate otomatis
// oleh sistem (auto-increment per tenant), bukan input dari user.
export const createVendorSchema = z.object({
  name: z.string().min(1, "Vendor name is required").max(255),
  contactName: z.string().max(255).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email("Invalid email format").optional().or(z.literal("")),
  address: z.string().max(500).optional(),
  paymentTerms: z.string().max(100).optional(),
  isActive: z.boolean().optional(), // default true dari Prisma kalau gak dikirim
});

// Schema untuk update vendor (PUT) — semua field opsional
export const updateVendorSchema = createVendorSchema.partial();

// Infer TypeScript types langsung dari schema Zod
export type CreateVendorInput = z.infer<typeof createVendorSchema>;
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;