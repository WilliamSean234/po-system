import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isValidTransition } from "@/lib/poStatusFlow";
import { matchApprovalStrategy } from "@/lib/matchApprovalStrategy";
import { assertPermission, PermissionDeniedError } from "@/lib/hasPermission";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/purchase-orders/[id]/submit
// Submit PO: DRAFT/REJECTED -> SUBMITTED. ApprovalStrategy dicari otomatis
// berdasarkan totalAmount, lalu di-lock ke PO ini (approvalStrategyId + submittedAt).
//
// BACKLOG REFACTOR: endpoint ini SEBELUMNYA tidak punya permission guard
// sama sekali (cuma cek tenantId) — siapapun yang login, role apapun,
// bisa submit PO tenant manapun. Sekarang table-driven lewat
// hasPermission("po.submit"), default role purchasing (+ admin).
export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tenantId, role } = session.user;

  try {
    await assertPermission(tenantId, role, "po.submit");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json(
        { error: "Anda tidak berwenang submit PO ini" },
        { status: 403 }
      );
    }
    throw err;
  }

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, tenantId, isDeleted: false },
  });
  if (!po) {
    return NextResponse.json({ error: "Purchase Order tidak ditemukan" }, { status: 404 });
  }

  if (!isValidTransition(po.status, "SUBMITTED")) {
    return NextResponse.json(
      { error: `Purchase Order berstatus '${po.status}' tidak bisa di-submit` },
      { status: 409 }
    );
  }

  const strategy = await matchApprovalStrategy(tenantId, Number(po.totalAmount));
  if (!strategy) {
    return NextResponse.json(
      {
        error:
          "Tidak ditemukan Approval Strategy yang cocok untuk nominal PO ini. Pastikan Approval Strategy tenant sudah lengkap (contiguous dari 0 hingga tak terbatas).",
      },
      { status: 422 }
    );
  }
  if (strategy.steps.length === 0) {
    return NextResponse.json(
      { error: "Approval Strategy yang cocok belum punya level approval sama sekali" },
      { status: 422 }
    );
  }

  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: "SUBMITTED",
      approvalStrategyId: strategy.id,
      submittedAt: new Date(),
    },
    include: {
      approvalStrategy: { include: { steps: { include: { level: true } } } },
    },
  });

  return NextResponse.json(updated);
}