import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { approvalLevelUpdateSchema } from "@/lib/validations/approvalLevel";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/approval-levels/[id]
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const level = await prisma.approvalLevel.findFirst({
    where: { id, tenantId: session.user.tenantId },
    include: { approvers: { include: { user: { select: { id: true, name: true, email: true } } } } },
  });

  if (!level) {
    return NextResponse.json({ error: "Approval Level tidak ditemukan" }, { status: 404 });
  }

  return NextResponse.json(level);
}

// PUT /api/approval-levels/[id]
// Update nama, dan/atau REPLACE seluruh daftar approver kalau approverUserIds dikirim
export async function PUT(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.user.tenantId;

  const existing = await prisma.approvalLevel.findFirst({ where: { id, tenantId } });
  if (!existing) {
    return NextResponse.json({ error: "Approval Level tidak ditemukan" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = approvalLevelUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { name, approverUserIds } = parsed.data;

  if (approverUserIds !== undefined) {
    const uniqueIds = [...new Set(approverUserIds)];
    const foundUsers = await prisma.user.findMany({ where: { id: { in: uniqueIds }, tenantId } });
    if (foundUsers.length !== uniqueIds.length) {
      const foundIds = new Set(foundUsers.map((u) => u.id));
      const missingIds = uniqueIds.filter((uid) => !foundIds.has(uid));
      return NextResponse.json(
        { error: `User berikut tidak ditemukan atau bukan bagian dari tenant ini: ${missingIds.join(", ")}` },
        { status: 400 }
      );
    }

    await prisma.$transaction([
      prisma.approvalLevelUser.deleteMany({ where: { approvalLevelId: id } }),
      prisma.approvalLevelUser.createMany({
        data: uniqueIds.map((userId) => ({ approvalLevelId: id, userId })),
      }),
    ]);
  }

  const updated = await prisma.approvalLevel.update({
    where: { id },
    data: { name: name ?? existing.name },
    include: { approvers: { include: { user: { select: { id: true, name: true, email: true } } } } },
  });

  return NextResponse.json(updated);
}

// DELETE /api/approval-levels/[id]
// Hard delete (bukan dokumen transaksi, tidak ada nomor auto-generate yang perlu dijaga
// dari reuse, jadi soft-delete tidak diperlukan di sini). TAPI dicegah kalau level ini
// masih dipakai di ApprovalStrategyStep manapun, biar tidak merusak strategi yang sudah ada.
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await prisma.approvalLevel.findFirst({
    where: { id, tenantId: session.user.tenantId },
    include: { steps: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Approval Level tidak ditemukan" }, { status: 404 });
  }

  if (existing.steps.length > 0) {
    return NextResponse.json(
      { error: "Approval Level ini masih dipakai di satu atau lebih Approval Strategy, tidak bisa dihapus" },
      { status: 409 }
    );
  }

  await prisma.$transaction([
    prisma.approvalLevelUser.deleteMany({ where: { approvalLevelId: id } }),
    prisma.approvalLevel.delete({ where: { id } }),
  ]);

  return NextResponse.json({ message: "Approval Level berhasil dihapus" });
}