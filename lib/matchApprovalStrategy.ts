import { prisma } from "@/lib/prisma";

/**
 * Cari ApprovalStrategy yang range nominalnya cocok dengan totalAmount PO.
 * Sama logic-nya kayak validateContiguousStrategyRanges, tapi ini buat MATCHING
 * bukan buat VALIDASI create/update.
 */
export async function matchApprovalStrategy(tenantId: string, totalAmount: number) {
  const strategies = await prisma.approvalStrategy.findMany({
    where: { tenantId },
    orderBy: { minAmount: "asc" },
    include: {
      steps: { orderBy: { sequence: "asc" }, include: { level: true } },
    },
  });

  for (const strategy of strategies) {
    const min = Number(strategy.minAmount);
    const max = strategy.maxAmount === null ? null : Number(strategy.maxAmount);
    const matches = totalAmount >= min && (max === null || totalAmount < max);
    if (matches) return strategy;
  }

  return null;
}