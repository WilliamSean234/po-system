// app/api/inventory/rebuild/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { rebuildBodySchema } from "@/lib/validations/inventory";
import { assertPermission, PermissionDeniedError } from "@/lib/hasPermission";
import {
  findInventoryBalanceDrift,
  rebuildInventoryBalance,
} from "@/lib/stockLedger";

/**
 * POST /api/inventory/rebuild
 * Rekonsiliasi InventoryBalance (cache) terhadap StockMovement (ledger).
 *
 * dryRun (default TRUE): hanya melaporkan selisih, tidak menulis apa pun.
 * dryRun=false: menimpa cache dengan hasil SUM ledger (baris cache yatim
 * di-set ke 0). Selisih yang dilaporkan adalah kondisi SEBELUM perbaikan.
 *
 * Permission: inventory.rebuild (tanpa default mapping — admin saja,
 * bisa didelegasikan lewat halaman RBAC). Jalankan saat tidak ada
 * transaksi stok yang sedang berjalan.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { tenantId, role } = session.user;

  try {
    await assertPermission(tenantId, role, "inventory.rebuild");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json(
        { error: "Anda tidak berwenang menjalankan rebuild saldo stok" },
        { status: 403 }
      );
    }
    throw err;
  }

  // Body boleh kosong (artinya dry run seluruh tenant).
  const rawBody = await request.json().catch(() => ({}));
  const parsed = rebuildBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validasi gagal", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { itemId, warehouseId, dryRun } = parsed.data;

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const scope = { tenantId, itemId, warehouseId };

        const drifts = await findInventoryBalanceDrift(tx, scope);

        let applied: { scopedCombinations: number; zeroedOrphans: number } | null = null;
        if (!dryRun) {
          const rebuilt = await rebuildInventoryBalance(tx, scope);
          applied = {
            scopedCombinations: rebuilt.scopedCombinations,
            zeroedOrphans: rebuilt.zeroedOrphans,
          };
        }

        return { drifts, applied };
      },
      { timeout: 30000, maxWait: 10000 }
    );

    return NextResponse.json(
      {
        dryRun,
        driftCount: result.drifts.length,
        drifts: result.drifts.map((d) => ({
          itemId: d.itemId,
          warehouseId: d.warehouseId,
          batchId: d.batchId,
          cachedQuantity: d.cachedQuantity.toString(),
          ledgerQuantity: d.ledgerQuantity.toString(),
          difference: d.difference.toString(),
        })),
        applied: result.applied,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error rebuilding inventory balance:", error);
    return NextResponse.json(
      { error: "Terjadi kesalahan saat rebuild saldo stok" },
      { status: 500 }
    );
  }
}