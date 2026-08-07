import { z } from "zod";

export const approvalLevelCreateSchema = z.object({
  name: z.string().min(1, { message: "Nama level wajib diisi" }),
  approverUserIds: z
    .array(z.string().uuid({ message: "approverUserIds harus berisi UUID valid" }))
    .min(1, { message: "Minimal 1 approver harus ditentukan untuk level ini" }),
});

export const approvalLevelUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  approverUserIds: z.array(z.string().uuid()).min(1).optional(), // kalau dikirim, REPLACE semua approver lama
});

export type ApprovalLevelCreateInput = z.infer<typeof approvalLevelCreateSchema>;
export type ApprovalLevelUpdateInput = z.infer<typeof approvalLevelUpdateSchema>;