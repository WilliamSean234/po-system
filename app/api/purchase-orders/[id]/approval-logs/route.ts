import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/purchase-orders/[id]/approval-logs
// Riwayat LENGKAP (semua siklus submission), urut dari yang terbaru.
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, tenantId: session.user.tenantId, isDeleted: false },
  });
  if (!po) {
    return NextResponse.json({ error: "Purchase Order tidak ditemukan" }, { status: 404 });
  }

  const logs = await prisma.approvalLog.findMany({
    where: { poId: id },
    orderBy: { actedAt: "desc" },
    include: {
      approvalLevel: { select: { id: true, name: true } },
      approver: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json(logs);
}