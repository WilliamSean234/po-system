import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { approvalStrategyUpdateSchema } from "@/lib/validations/approvalStrategy";
import { validateContiguousStrategyRanges } from "@/lib/approvalStrategyValidation";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/approval-strategies/[id]
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const strategy = await prisma.approvalStrategy.findFirst({
    where: { id, tenantId: session.user.tenantId },
    include: {
      steps: { orderBy: { sequence: "asc" }, include: { level: { select: { id: true, name: true } } } },
    },
  });

  if (!strategy) {
    return NextResponse.json({ error: "Approval Strategy tidak ditemukan" }, { status: 404 });
  }

  return NextResponse.json(strategy);
}

// PUT /api/approval-strategies/[id]
export async function PUT(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.user.tenantId;

  const existing = await prisma.approvalStrategy.findFirst({ where: { id, tenantId } });
  if (!existing) {
    return NextResponse.json({ error: "Approval Strategy tidak ditemukan" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = approvalStrategyUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { name, minAmount, maxAmount, isSequential, steps } = parsed.data;

  const finalMinAmount = minAmount ?? Number(existing.minAmount);
  const finalMaxAmount =
    maxAmount !== undefined ? maxAmount : existing.maxAmount === null ? null : Number(existing.maxAmount);

  // Validasi contiguous ulang (exclude dirinya sendiri)
  const { valid, error } = await validateContiguousStrategyRanges({
    tenantId,
    candidate: { id, minAmount: finalMinAmount, maxAmount: finalMaxAmount },
  });
  if (!valid) {
    return NextResponse.json({ error }, { status: 409 });
  }

  // Kalau steps dikirim, validasi levelnya dulu sebelum replace
  if (steps !== undefined) {
    const levelIds = steps.map((s) => s.approvalLevelId);
    const foundLevels = await prisma.approvalLevel.findMany({
      where: { id: { in: levelIds }, tenantId },
    });
    if (foundLevels.length !== levelIds.length) {
      const foundIds = new Set(foundLevels.map((l) => l.id));
      const missingIds = levelIds.filter((lid) => !foundIds.has(lid));
      return NextResponse.json(
        { error: `Approval Level berikut tidak ditemukan atau bukan bagian dari tenant ini: ${missingIds.join(", ")}` },
        { status: 400 }
      );
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (steps !== undefined) {
      await tx.approvalStrategyStep.deleteMany({ where: { approvalStrategyId: id } });
    }

    return tx.approvalStrategy.update({
      where: { id },
      data: {
        name: name ?? existing.name,
        minAmount: finalMinAmount,
        maxAmount: finalMaxAmount,
        isSequential: isSequential ?? existing.isSequential,
        ...(steps !== undefined
          ? { steps: { create: steps.map((s) => ({ approvalLevelId: s.approvalLevelId, sequence: s.sequence })) } }
          : {}),
      },
      include: {
        steps: { orderBy: { sequence: "asc" }, include: { level: { select: { id: true, name: true } } } },
      },
    });
  });

  return NextResponse.json(updated);
}

// DELETE /api/approval-strategies/[id]
// Hard delete, dicegah kalau masih dipakai PurchaseOrder manapun (biar histori approval tidak "patah")
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await prisma.approvalStrategy.findFirst({
    where: { id, tenantId: session.user.tenantId },
    include: { purchaseOrders: { select: { id: true }, take: 1 } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Approval Strategy tidak ditemukan" }, { status: 404 });
  }

  if (existing.purchaseOrders.length > 0) {
    return NextResponse.json(
      { error: "Approval Strategy ini sudah pernah dipakai oleh Purchase Order, tidak bisa dihapus" },
      { status: 409 }
    );
  }

  await prisma.$transaction([
    prisma.approvalStrategyStep.deleteMany({ where: { approvalStrategyId: id } }),
    prisma.approvalStrategy.delete({ where: { id } }),
  ]);

  return NextResponse.json({ message: "Approval Strategy berhasil dihapus" });
}