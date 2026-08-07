import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { approvalLevelCreateSchema } from "@/lib/validations/approvalLevel";

// GET /api/approval-levels
// List semua ApprovalLevel milik tenant, termasuk daftar approver-nya
export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const levels = await prisma.approvalLevel.findMany({
    where: { tenantId: session.user.tenantId },
    include: {
      approvers: {
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
      },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(levels);
}

// POST /api/approval-levels
// Buat ApprovalLevel baru + assign approver-approvernya sekaligus (1 request)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.user.tenantId;
  const body = await req.json();
  const parsed = approvalLevelCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { name, approverUserIds } = parsed.data;

  // Validasi semua approverUserIds itu user yang valid & satu tenant
  const uniqueIds = [...new Set(approverUserIds)];
  const foundUsers = await prisma.user.findMany({
    where: { id: { in: uniqueIds }, tenantId },
  });
  if (foundUsers.length !== uniqueIds.length) {
    const foundIds = new Set(foundUsers.map((u) => u.id));
    const missingIds = uniqueIds.filter((id) => !foundIds.has(id));
    return NextResponse.json(
      { error: `User berikut tidak ditemukan atau bukan bagian dari tenant ini: ${missingIds.join(", ")}` },
      { status: 400 }
    );
  }

  const newLevel = await prisma.approvalLevel.create({
    data: {
      tenantId,
      name,
      approvers: {
        create: uniqueIds.map((userId) => ({ userId })),
      },
    },
    include: {
      approvers: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  });

  return NextResponse.json(newLevel, { status: 201 });
}