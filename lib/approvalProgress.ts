import { prisma } from "@/lib/prisma";

type StrategyForProgress = {
  isSequential: boolean;
  steps: { approvalLevelId: string; sequence: number }[];
};

/**
 * Ambil semua approvalLevelId yang SUDAH di-approve untuk PO ini,
 * DIBATASI ke siklus submission saat ini (actedAt >= submittedAt).
 * Ini penting supaya kalau PO pernah REJECTED lalu di-submit ulang,
 * approval dari siklus sebelumnya TIDAK ikut terhitung lagi.
 */
export async function getApprovedLevelIds(poId: string, submittedAt: Date): Promise<Set<string>> {
  const logs = await prisma.approvalLog.findMany({
    where: { poId, action: "APPROVED", actedAt: { gte: submittedAt } },
    select: { approvalLevelId: true },
  });
  return new Set(logs.map((l) => l.approvalLevelId));
}

/**
 * Cek apakah suatu level BOLEH bertindak (approve/reject) sekarang.
 * - Kalau strategy NON-sequential: selalu boleh (asal belum di-approve).
 * - Kalau strategy sequential: hanya boleh kalau SEMUA step dengan sequence
 *   lebih kecil dari level ini sudah ter-approve duluan.
 */
export function isStepUnlocked(
  strategy: StrategyForProgress,
  targetLevelId: string,
  approvedLevelIds: Set<string>
): boolean {
  if (!strategy.isSequential) return true;

  const targetStep = strategy.steps.find((s) => s.approvalLevelId === targetLevelId);
  if (!targetStep) return false;

  const priorSteps = strategy.steps.filter((s) => s.sequence < targetStep.sequence);
  return priorSteps.every((s) => approvedLevelIds.has(s.approvalLevelId));
}

/**
 * Cek apakah SEMUA step yang dibutuhkan strategy ini sudah ter-approve.
 * Kalau true, PO otomatis pindah status ke APPROVED.
 */
export function allStepsApproved(
  strategy: { steps: { approvalLevelId: string }[] },
  approvedLevelIds: Set<string>
): boolean {
  return strategy.steps.every((s) => approvedLevelIds.has(s.approvalLevelId));
}