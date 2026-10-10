// app/api/stock-transfers/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma";
import { createStockTransferSchema } from "@/lib/validations/stockTransfer";
import {
  consolidateTransferLines,
  validateTransferReferences,
  validateSufficientStock,
  assertNoNegativeBalanceAfterTransfer,
  StockTransferValidationError,
} from "@/lib/stockTransferValidation";
import { generateTransferNumberWithRetry } from "@/lib/generateTransferNumber";
import { assertPermission, PermissionDeniedError } from "@/lib/hasPermission";
import { recordStockMovement, MOVEMENT_TYPE, REFERENCE_TYPE } from "@/lib/stockLedger";

/**
 * POST /api/stock-transfers
 * Membuat Stock Transfer antar warehouse (one-step, pola SAP movement 311).
 * Immutable setelah dibuat — tidak ada PUT/PATCH/DELETE.
 *
 * Tiap line menghasilkan sepasang StockMovement dalam transaction yang sama:
 * "311" (negatif, di warehouse asal) dan "312" (positif, di warehouse tujuan).
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { tenantId, id: userId, role } = session.user;

  try {
    await assertPermission(tenantId, role, "inventory.transfer");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json(
        { error: "Anda tidak berwenang membuat Stock Transfer" },
        { status: 403 }
      );
    }
    throw err;
  }

  const body = await request.json();
  const parsed = createStockTransferSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validasi gagal", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const input = parsed.data;

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // 1. Validasi referensi (gudang, item, batch).
        const { batchById } = await validateTransferReferences(tx, {
          tenantId,
          sourceWarehouseId: input.sourceWarehouseId,
          destinationWarehouseId: input.destinationWarehouseId,
          lines: input.lines,
        });

        // 2. Jumlahkan line duplikat, lalu cek stok cukup di warehouse asal.
        const consolidated = consolidateTransferLines(input.lines);
        await validateSufficientStock(tx, {
          tenantId,
          sourceWarehouseId: input.sourceWarehouseId,
          consolidated,
          batchById,
        });

        // 3. Buat dokumen transfer + movement.
        let createdTransfer: Prisma.StockTransferGetPayload<{
          include: { lines: true };
        }> | null = null;

        await generateTransferNumberWithRetry(tx, tenantId, async (transferNumber) => {
          createdTransfer = await tx.stockTransfer.create({
            data: {
              tenantId,
              transferNumber,
              sourceWarehouseId: input.sourceWarehouseId,
              destinationWarehouseId: input.destinationWarehouseId,
              transferDate: input.transferDate,
              createdBy: userId,
              notes: input.notes,
              lines: {
                create: input.lines.map((line) => ({
                  itemId: line.itemId,
                  batchId: line.batchId,
                  quantity: line.quantity,
                  notes: line.notes,
                })),
              },
            },
            include: { lines: true },
          });

          // Bangun semua operasi movement (311 keluar + 312 masuk per line),
          // lalu urutkan deterministik by warehouse/item/batch. Urutan yang
          // konsisten antar transaction mencegah deadlock kalau dua transfer
          // arah berlawanan (A->B dan B->A) berjalan bersamaan.
          const ops = createdTransfer.lines.flatMap((line) => [
            {
              warehouseId: input.sourceWarehouseId,
              movementType: MOVEMENT_TYPE.TRANSFER_OUT,
              quantity: line.quantity.negated(),
              itemId: line.itemId,
              batchId: line.batchId,
            },
            {
              warehouseId: input.destinationWarehouseId,
              movementType: MOVEMENT_TYPE.TRANSFER_IN,
              quantity: line.quantity,
              itemId: line.itemId,
              batchId: line.batchId,
            },
          ]);

          ops.sort(
            (a, b) =>
              a.warehouseId.localeCompare(b.warehouseId) ||
              a.itemId.localeCompare(b.itemId) ||
              (a.batchId ?? "").localeCompare(b.batchId ?? "")
          );

          for (const op of ops) {
            await recordStockMovement({
              tx,
              tenantId,
              itemId: op.itemId,
              warehouseId: op.warehouseId,
              batchId: op.batchId,
              quantity: op.quantity,
              movementType: op.movementType,
              referenceType: REFERENCE_TYPE.STOCK_TRANSFER,
              referenceId: createdTransfer.id,
              movementDate: input.transferDate,
              createdBy: userId,
              notes: `Transfer ${transferNumber}`,
            });
          }
        });

        // 4. Safety net konkurensi: saldo asal tidak boleh negatif setelah
        // movement dicatat. Kalau negatif -> throw -> seluruh transaction rollback.
        await assertNoNegativeBalanceAfterTransfer(tx, {
          tenantId,
          sourceWarehouseId: input.sourceWarehouseId,
          consolidated,
        });

        return createdTransfer;
      },
      {
        timeout: 15000,
        maxWait: 10000,
      }
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof StockTransferValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("Error creating stock transfer:", error);
    return NextResponse.json(
      { error: "Terjadi kesalahan saat membuat Stock Transfer" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/stock-transfers
 * List semua Stock Transfer (tenant-scoped). Tanpa permission guard —
 * read-only, konsisten dengan pola GET lain di project ini.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { tenantId } = session.user;

  const transfers = await prisma.stockTransfer.findMany({
    where: { tenantId },
    include: {
      sourceWarehouse: { select: { id: true, code: true, name: true } },
      destinationWarehouse: { select: { id: true, code: true, name: true } },
      creator: { select: { id: true, name: true, email: true } },
      _count: { select: { lines: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(transfers, { status: 200 });
}