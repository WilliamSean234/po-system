import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { approvalConfigUpdateSchema } from "@/lib/validations/approvalConfig";
import { validateContiguousRanges, checkLevelTaken } from "@/lib/approvalConfigValidation";

// Tipe params sebagai Promise, sesuai Next.js 16
type RouteContext = { params: Promise<{ id: string }> };

// GET /api/approval-configs/[id] — detail satu config
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params; // wajib di-await dulu di Next.js 16

  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await prisma.approvalConfig.findFirst({
    where: { id, tenantId: session.user.tenantId },
    include: { approver: { select: { id: true, name: true, email: true } } },
  });

  if (!config) {
    return NextResponse.json({ error: "Approval Config tidak ditemukan" }, { status: 404 });
  }

  return NextResponse.json(config);
}

// PUT /api/approval-configs/[id] — update, dengan validasi contiguous ulang
export async function PUT(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.user.tenantId;

  const existing = await prisma.approvalConfig.findFirst({
    where: { id, tenantId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Approval Config tidak ditemukan" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = approvalConfigUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const level = parsed.data.level ?? existing.level;
  const minAmount = parsed.data.minAmount ?? Number(existing.minAmount);
  const maxAmount: number | null =
    parsed.data.maxAmount !== undefined
      ? parsed.data.maxAmount
      : existing.maxAmount === null
        ? null
        : Number(existing.maxAmount);
  const approverUserId = parsed.data.approverUserId ?? existing.approverUserId;

  if (parsed.data.approverUserId) {
    const approver = await prisma.user.findUnique({ where: { id: approverUserId } });
    if (!approver || approver.tenantId !== tenantId) {
      return NextResponse.json(
        { error: "approverUserId tidak ditemukan atau bukan bagian dari tenant ini" },
        { status: 400 }
      );
    }
  }

  if (parsed.data.level !== undefined) {
    const levelTaken = await checkLevelTaken({ tenantId, level, excludeId: id });
    if (levelTaken) {
      return NextResponse.json(
        { error: `Level ${level} sudah dipakai oleh config lain di tenant ini` },
        { status: 409 }
      );
    }
  }

  const { valid, error } = await validateContiguousRanges({
    tenantId,
    candidate: { id, level, minAmount, maxAmount },
  });
  if (!valid) {
    return NextResponse.json({ error }, { status: 409 });
  }

  const updated = await prisma.approvalConfig.update({
    where: { id },
    data: { level, minAmount, maxAmount, approverUserId },
  });

  return NextResponse.json(updated);
}

// DELETE /api/approval-configs/[id] — hard delete
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await prisma.approvalConfig.findFirst({
    where: { id, tenantId: session.user.tenantId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Approval Config tidak ditemukan" }, { status: 404 });
  }

  await prisma.approvalConfig.delete({ where: { id } });

  return NextResponse.json({ message: "Approval Config berhasil dihapus" });
}