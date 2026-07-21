import { z } from "zod";

export const createItemSchema = z.object({
    name:z.string().min(1, "Item name is required").max(255),
    description:z.string().max(255).optional(),
    uom : z.string().max(100),
    category : z.string().max(100).optional(),
    isActive : z.boolean().optional(), // default true dari Prisma kalau gak dikirim
})

// Schema untuk update item (PUT) — semua field opsional
export const updateItemSchema = createItemSchema.partial();

// Infer TypeScript types langsung dari schema Zod
export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;