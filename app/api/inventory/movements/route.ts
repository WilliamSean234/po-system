// app/api/inventory/movements/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma";
import { movementsQuerySchema } from "@/lib/validations/inventory";

/**
 * GET /api/inventory/movements
 * Membaca ledger StockMovement (sumber kebenaran) untuk audit dan histori
 * batch. Tenant-scoped, tanpa permission guard (read-only).
 *
 * Filter opsional: itemId, warehouseId, batchId, referenceType, referenceId,
 * dateFrom/dateTo (berlaku ke movementDate). Terbaru dulu.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { tenantId } = session.user;

  const parsed = movementsQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validasi gagal", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const {
    itemId,
    warehouseId,
    batchId,
    referenceType,
    referenceId,
    dateFrom,
    dateTo,
    page,
    pageSize,
  } = parsed.data;

  const where: Prisma.StockMovementWhereInput = {
    tenantId,
    ...(itemId ? { itemId } : {}),
    ...(warehouseId ? { warehouseId } : {}),
    ...(batchId ? { batchId } : {}),
    ...(referenceType ? { referenceType } : {}),
    ...(referenceId ? { referenceId } : {}),
    ...(dateFrom || dateTo
      ? {
          movementDate: {
            ...(dateFrom ? { gte: dateFrom } : {}),
            ...(dateTo ? { lte: dateTo } : {}),
          },
        }
      : {}),
  };

  const [total, data] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where,
      include: {
        item: { select: { id: true, code: true, name: true, uom: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        batch: { select: { id: true, batchNumber: true, expiryDate: true } },
        creator: { select: { id: true, name: true } },
      },
      orderBy: [{ movementDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json(
    {
      data,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    },
    { status: 200 }
  );
}