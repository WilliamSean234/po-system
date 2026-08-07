import { prisma } from "@/lib/prisma";

type StrategyLike = {
  id?: string;
  minAmount: number;
  maxAmount: number | null;
};

/**
 * Validasi CONTIGUOUS: seluruh rentang nominal ApprovalStrategy di tenant ini harus
 * mulai dari 0, nyambung sempurna tanpa gap/overlap, dan cuma SATU strategy
 * (yang nominal-nya paling tinggi) yang boleh maxAmount = null (tak terbatas).
 *
 * Karena ApprovalStrategy tidak punya "level" eksplisit seperti ApprovalConfig dulu
 * (levelnya sekarang implisit dari minAmount ascending), urutan ditentukan dari minAmount.
 */
export async function validateContiguousStrategyRanges({
  tenantId,
  candidate,
}: {
  tenantId: string;
  candidate: StrategyLike;
}): Promise<{ valid: boolean; error?: string }> {
  const existing = await prisma.approvalStrategy.findMany({
    where: {
      tenantId,
      ...(candidate.id ? { id: { not: candidate.id } } : {}),
    },
    select: { id: true, minAmount: true, maxAmount: true },
  });

  const all: StrategyLike[] = [
    ...existing.map((e) => ({
      id: e.id,
      minAmount: Number(e.minAmount),
      maxAmount: e.maxAmount === null ? null : Number(e.maxAmount),
    })),
    candidate,
  ].sort((a, b) => a.minAmount - b.minAmount);

  if (all[0].minAmount !== 0) {
    return {
      valid: false,
      error: `Rentang nominal terendah harus mulai dari 0, sekarang mulai dari ${all[0].minAmount}`,
    };
  }

  for (let i = 0; i < all.length; i++) {
    const current = all[i];
    const isLast = i === all.length - 1;

    if (current.maxAmount === null && !isLast) {
      return {
        valid: false,
        error: `Strategy dengan minAmount ${current.minAmount} tidak boleh maxAmount kosong (tak terbatas) karena masih ada rentang di atasnya`,
      };
    }

    if (!isLast) {
      const next = all[i + 1];
      if (current.maxAmount !== next.minAmount) {
        return {
          valid: false,
          error: `Gap/overlap terdeteksi: rentang berakhir di ${current.maxAmount}, tapi rentang berikutnya mulai dari ${next.minAmount}. Keduanya harus sama persis.`,
        };
      }
    }
  }

  return { valid: true };
}