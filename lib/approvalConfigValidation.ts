import { prisma } from "@/lib/prisma";

type ConfigLike = {
  id?: string;
  level: number;
  minAmount: number;
  maxAmount: number | null;
};

/**
 * Validasi CONTIGUOUS penuh: setelah config baru/update disisipkan,
 * seluruh rentang nominal di tenant ini harus:
 *  - Mulai dari 0 (level terendah)
 *  - Nyambung sempurna tanpa gap/overlap antar level
 *  - Cuma level TERTINGGI yang boleh maxAmount = null (tak terbatas)
 */
export async function validateContiguousRanges({
  tenantId,
  candidate,
}: {
  tenantId: string;
  candidate: ConfigLike;
}): Promise<{ valid: boolean; error?: string }> {
  const existing = await prisma.approvalConfig.findMany({
    where: {
      tenantId,
      ...(candidate.id ? { id: { not: candidate.id } } : {}),
    },
    select: { id: true, level: true, minAmount: true, maxAmount: true },
  });

  const all: ConfigLike[] = [
    ...existing.map((e) => ({
      id: e.id,
      level: e.level,
      minAmount: Number(e.minAmount),
      maxAmount: e.maxAmount === null ? null : Number(e.maxAmount),
    })),
    candidate,
  ].sort((a, b) => a.level - b.level);

  if (all[0].minAmount !== 0) {
    return {
      valid: false,
      error: `Level ${all[0].level} (level terendah) harus mulai dari minAmount = 0, sekarang ${all[0].minAmount}`,
    };
  }

  for (let i = 0; i < all.length; i++) {
    const current = all[i];
    const isLast = i === all.length - 1;

    if (current.maxAmount === null && !isLast) {
      return {
        valid: false,
        error: `Level ${current.level} tidak boleh maxAmount kosong (tak terbatas) karena masih ada level di atasnya`,
      };
    }

    if (!isLast) {
      const next = all[i + 1];
      if (current.maxAmount !== next.minAmount) {
        return {
          valid: false,
          error: `Gap/overlap terdeteksi: level ${current.level} berakhir di ${current.maxAmount}, tapi level ${next.level} mulai dari ${next.minAmount}. Keduanya harus sama persis.`,
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Cek apakah `level` udah dipakai config lain di tenant yang sama.
 */
export async function checkLevelTaken({
  tenantId,
  level,
  excludeId,
}: {
  tenantId: string;
  level: number;
  excludeId?: string;
}): Promise<boolean> {
  const existing = await prisma.approvalConfig.findFirst({
    where: {
      tenantId,
      level,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  return existing !== null;
}