// app/api/inventory/balance/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma";
import { balanceQuerySchema } from "@/lib/validations/inventory";

/**
 * GET /api/inventory/balance
 * Membaca saldo stok dari cache InventoryBalance (tenant-scoped).
 * Tanpa permission guard — read-only, konsisten dengan pola GET lain.
 *
 * Filter opsional: itemId, warehouseId, batchId.
 * Baris saldo 0 disembunyikan kecuali includeZero=true. Saldo negatif
 * (seharusnya tidak pernah ada) tetap tampil supaya anomali kelihatan.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { tenantId } = session.user;

  const parsed = balanceQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validasi gagal", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { itemId, warehouseId, batchId, includeZero, page, pageSize } = parsed.data;

  const where: Prisma.InventoryBalanceWhereInput = {
    tenantId,
    ...(itemId ? { itemId } : {}),
    ...(warehouseId ? { warehouseId } : {}),
    ...(batchId ? { batchId } : {}),
    ...(includeZero ? {} : { quantity: { not: 0 } }),
  };

  const [total, data] = await Promise.all([
    prisma.inventoryBalance.count({ where }),
    prisma.inventoryBalance.findMany({
      where,
      include: {
        item: { select: { id: true, code: true, name: true, uom: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        batch: { select: { id: true, batchNumber: true, expiryDate: true } },
      },
      orderBy: [
        { item: { code: "asc" } },
        { warehouse: { code: "asc" } },
        { batch: { batchNumber: "asc" } },
      ],
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