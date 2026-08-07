import { z } from "zod";

const strategyStepSchema = z.object({
  approvalLevelId: z.string().uuid({ message: "approvalLevelId harus UUID valid" }),
  sequence: z.number().int().positive({ message: "sequence harus angka positif" }),
});

export const approvalStrategyCreateSchema = z
  .object({
    name: z.string().min(1, { message: "Nama strategi wajib diisi" }),
    minAmount: z.number().nonnegative({ message: "minAmount tidak boleh negatif" }),
    maxAmount: z.number().positive({ message: "maxAmount harus lebih dari 0" }).nullable(),
    isSequential: z.boolean(),
    steps: z
      .array(strategyStepSchema)
      .min(1, { message: "Strategi harus punya minimal 1 level approval" }),
  })
  .refine((data) => data.maxAmount === null || data.maxAmount > data.minAmount, {
    message: "maxAmount harus lebih besar dari minAmount",
    path: ["maxAmount"],
  })
  .refine(
    (data) => {
      // approvalLevelId di dalam steps harus unik (satu level cuma boleh muncul 1x per strategy)
      const ids = data.steps.map((s) => s.approvalLevelId);
      return new Set(ids).size === ids.length;
    },
    { message: "Satu Approval Level tidak boleh muncul lebih dari sekali dalam satu strategy", path: ["steps"] }
  )
  .refine(
    (data) => {
      // Kalau sequential, urutan `sequence` harus unik (gak boleh 2 step sama-sama sequence 1)
      if (!data.isSequential) return true;
      const sequences = data.steps.map((s) => s.sequence);
      return new Set(sequences).size === sequences.length;
    },
    { message: "Untuk strategy sequential, tiap step harus punya sequence yang unik", path: ["steps"] }
  );

export const approvalStrategyUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  minAmount: z.number().nonnegative().optional(),
  maxAmount: z.number().positive().nullable().optional(),
  isSequential: z.boolean().optional(),
  steps: z.array(strategyStepSchema).min(1).optional(), // kalau dikirim, REPLACE semua steps lama
});

export type ApprovalStrategyCreateInput = z.infer<typeof approvalStrategyCreateSchema>;
export type ApprovalStrategyUpdateInput = z.infer<typeof approvalStrategyUpdateSchema>;