import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getApprovedLevelIds, isStepUnlocked } from "@/lib/approvalProgress";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, tenantId: session.user.tenantId, isDeleted: false },
    include: {
      approvalStrategy: {
        include: {
          steps: {
            orderBy: { sequence: "asc" },
            include: { level: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });
  if (!po) {
    return NextResponse.json({ error: "Purchase Order tidak ditemukan" }, { status: 404 });
  }

  if (!po.approvalStrategy || !po.submittedAt) {
    return NextResponse.json({ steps: [], message: "PO belum pernah di-submit untuk approval" });
  }

  const approvedLevelIds = await getApprovedLevelIds(id, po.submittedAt);

  const steps = po.approvalStrategy.steps.map((step) => {
    const isApproved = approvedLevelIds.has(step.approvalLevelId);
    const unlocked = isStepUnlocked(po.approvalStrategy!, step.approvalLevelId, approvedLevelIds);
    return {
      approvalLevelId: step.approvalLevelId,
      levelName: step.level.name,
      sequence: step.sequence,
      status: isApproved ? "APPROVED" : unlocked ? "PENDING" : "LOCKED",
    };
  });

  return NextResponse.json({
    strategyName: po.approvalStrategy.name,
    isSequential: po.approvalStrategy.isSequential,
    steps,
  });
}