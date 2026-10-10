// app/api/stock-transfers/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/stock-transfers/[id]
 * Detail 1 Stock Transfer (tenant-scoped). Tanpa permission guard —
 * read-only. Tidak ada PUT/DELETE: transfer immutable.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "ID tidak valid" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { tenantId } = session.user;

  const transfer = await prisma.stockTransfer.findFirst({
    where: { id, tenantId },
    include: {
      sourceWarehouse: { select: { id: true, code: true, name: true } },
      destinationWarehouse: { select: { id: true, code: true, name: true } },
      creator: { select: { id: true, name: true, email: true } },
      lines: {
        include: {
          item: { select: { id: true, code: true, name: true, uom: true } },
          batch: { select: { id: true, batchNumber: true, expiryDate: true } },
        },
      },
    },
  });

  if (!transfer) {
    return NextResponse.json({ error: "Stock Transfer tidak ditemukan" }, { status: 404 });
  }

  return NextResponse.json(transfer, { status: 200 });
}