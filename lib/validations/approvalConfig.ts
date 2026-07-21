import { z } from "zod";

// Skema validasi untuk create Approval Config
// maxAmount boleh null = artinya "tidak terbatas" (hanya valid untuk level tertinggi)
export const approvalConfigCreateSchema = z
  .object({
    level: z.number().int().positive({ message: "Level harus angka positif (1, 2, 3, ...)" }),
    minAmount: z.number().nonnegative({ message: "minAmount tidak boleh negatif" }),
    maxAmount: z.number().positive({ message: "maxAmount harus lebih dari 0" }).nullable(),
    approverUserId: z.string().uuid({ message: "approverUserId harus UUID valid" }),
  })
  .refine(
    (data) => {
      // Kalau maxAmount diisi (bukan null), harus lebih besar dari minAmount
      if (data.maxAmount !== null) {
        return data.maxAmount > data.minAmount;
      }
      return true; // null = tak terbatas, otomatis valid
    },
    { message: "maxAmount harus lebih besar dari minAmount", path: ["maxAmount"] }
  );

// Untuk update, semua field optional (partial update)
export const approvalConfigUpdateSchema = z
  .object({
    level: z.number().int().positive().optional(),
    minAmount: z.number().nonnegative().optional(),
    maxAmount: z.number().positive().nullable().optional(),
    approverUserId: z.string().uuid().optional(),
  })
  .refine(
    (data) => {
      if (data.minAmount !== undefined && data.maxAmount !== undefined && data.maxAmount !== null) {
        return data.maxAmount > data.minAmount;
      }
      return true;
    },
    { message: "maxAmount harus lebih besar dari minAmount", path: ["maxAmount"] }
  );

export type ApprovalConfigCreateInput = z.infer<typeof approvalConfigCreateSchema>;
export type ApprovalConfigUpdateInput = z.infer<typeof approvalConfigUpdateSchema>;