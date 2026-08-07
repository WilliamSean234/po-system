import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getApprovedLevelIds, isStepUnlocked } from "@/lib/approvalProgress";

type RouteContext = { params: Promise<{ id: string }> };

const rejectBodySchema = z.object({
  approvalLevelId: z.string().uuid({ message: "approvalLevelId harus UUID valid" }),
  notes: z.string().optional(),
});

// POST /api/purchase-orders/[id]/reject
// Reject dari SATU level yang sedang gilirannya. Begitu ada 1 level yang reject,
// seluruh PO langsung berstatus REJECTED (short-circuit, tidak perlu menunggu level lain).
export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user?.tenantId || !session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.user.tenantId;
  const userId = session.user.id;

  const body = await req.json().catch(() => ({}));
  const parsed = rejectBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { approvalLevelId, notes } = parsed.data;

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, tenantId, isDeleted: false },
    include: { approvalStrategy: { include: { steps: { orderBy: { sequence: "asc" } } } } },
  });
  if (!po) {
    return NextResponse.json({ error: "Purchase Order tidak ditemukan" }, { status: 404 });
  }

  if (po.status !== "SUBMITTED" || !po.approvalStrategy || !po.submittedAt) {
    return NextResponse.json(
      { error: `Purchase Order berstatus '${po.status}' tidak sedang menunggu approval` },
      { status: 409 }
    );
  }

  const strategy = po.approvalStrategy;

  const step = strategy.steps.find((s) => s.approvalLevelId === approvalLevelId);
  if (!step) {
    return NextResponse.json(
      { error: "Approval Level ini bukan bagian dari Approval Strategy PO ini" },
      { status: 400 }
    );
  }

  const membership = await prisma.approvalLevelUser.findUnique({
    where: { approvalLevelId_userId: { approvalLevelId, userId } },
  });
  if (!membership) {
    return NextResponse.json(
      { error: "Anda tidak memiliki wewenang untuk reject di level ini" },
      { status: 403 }
    );
  }

  const approvedLevelIds = await getApprovedLevelIds(id, po.submittedAt);
  if (!isStepUnlocked(strategy, approvalLevelId, approvedLevelIds)) {
    return NextResponse.json(
      { error: "Belum giliran level ini bertindak — level dengan urutan sebelumnya harus disetujui dulu" },
      { status: 409 }
    );
  }

  const [, updatedPo] = await prisma.$transaction([
    prisma.approvalLog.create({
      data: { poId: id, approvalLevelId, approverId: userId, action: "REJECTED", notes },
    }),
    prisma.purchaseOrder.update({ where: { id }, data: { status: "REJECTED" } }),
  ]);

  return NextResponse.json(updatedPo);
}