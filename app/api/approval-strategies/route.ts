import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { approvalStrategyCreateSchema } from "@/lib/validations/approvalStrategy";
import { validateContiguousStrategyRanges } from "@/lib/approvalStrategyValidation";

// GET /api/approval-strategies
export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const strategies = await prisma.approvalStrategy.findMany({
    where: { tenantId: session.user.tenantId },
    include: {
      steps: {
        orderBy: { sequence: "asc" },
        include: { level: { select: { id: true, name: true } } },
      },
    },
    orderBy: { minAmount: "asc" },
  });

  return NextResponse.json(strategies);
}

// POST /api/approval-strategies
// Create strategy + steps sekaligus (header+lines pattern, konsisten sama PO)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.user.tenantId;
  const body = await req.json();
  const parsed = approvalStrategyCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { name, minAmount, maxAmount, isSequential, steps } = parsed.data;

  // Validasi semua approvalLevelId di steps itu valid & satu tenant
  const levelIds = steps.map((s) => s.approvalLevelId);
  const foundLevels = await prisma.approvalLevel.findMany({
    where: { id: { in: levelIds }, tenantId },
  });
  if (foundLevels.length !== levelIds.length) {
    const foundIds = new Set(foundLevels.map((l) => l.id));
    const missingIds = levelIds.filter((id) => !foundIds.has(id));
    return NextResponse.json(
      { error: `Approval Level berikut tidak ditemukan atau bukan bagian dari tenant ini: ${missingIds.join(", ")}` },
      { status: 400 }
    );
  }

  // Validasi contiguous range terhadap strategy lain yang sudah ada
  const { valid, error } = await validateContiguousStrategyRanges({
    tenantId,
    candidate: { minAmount, maxAmount },
  });
  if (!valid) {
    return NextResponse.json({ error }, { status: 409 });
  }

  const newStrategy = await prisma.approvalStrategy.create({
    data: {
      tenantId,
      name,
      minAmount,
      maxAmount,
      isSequential,
      steps: {
        create: steps.map((s) => ({ approvalLevelId: s.approvalLevelId, sequence: s.sequence })),
      },
    },
    include: {
      steps: { orderBy: { sequence: "asc" }, include: { level: { select: { id: true, name: true } } } },
    },
  });

  return NextResponse.json(newStrategy, { status: 201 });
}