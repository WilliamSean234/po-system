import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth"; // sesuaikan path kalau beda di project lo
import { prisma } from "@/lib/prisma";
import { approvalConfigCreateSchema } from "@/lib/validations/approvalConfig";
import { validateContiguousRanges, checkLevelTaken } from "@/lib/approvalConfigValidation";

// GET /api/approval-configs
// Ambil semua Approval Config milik tenant yang lagi login, urut berdasarkan level
export async function GET() {
  const session = await auth();

  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const configs = await prisma.approvalConfig.findMany({
    where: { tenantId: session.user.tenantId },
    orderBy: { level: "asc" },
    include: {
      approver: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json(configs);
}

// POST /api/approval-configs
// Buat Approval Config baru, dengan validasi contiguous (nyambung sempurna, tanpa gap/overlap)
export async function POST(req: NextRequest) {
  const session = await auth();

  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.user.tenantId;
  const body = await req.json();

  const parsed = approvalConfigCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { level, minAmount, maxAmount, approverUserId } = parsed.data;

  // Pastikan approverUserId valid DAN satu tenant sama
  const approver = await prisma.user.findUnique({ where: { id: approverUserId } });
  if (!approver || approver.tenantId !== tenantId) {
    return NextResponse.json(
      { error: "approverUserId tidak ditemukan atau bukan bagian dari tenant ini" },
      { status: 400 }
    );
  }

  // Cek level udah dipakai atau belum
  const levelTaken = await checkLevelTaken({ tenantId, level });
  if (levelTaken) {
    return NextResponse.json(
      { error: `Level ${level} sudah dipakai oleh config lain di tenant ini` },
      { status: 409 }
    );
  }

  // Cek contiguous: range baru harus nyambung sempurna sama config existing,
  // mulai dari 0, tanpa gap/overlap, dan cuma level tertinggi boleh maxAmount = null
  const { valid, error } = await validateContiguousRanges({
    tenantId,
    candidate: { level, minAmount, maxAmount },
  });
  if (!valid) {
    return NextResponse.json({ error }, { status: 409 });
  }

  // Semua validasi lolos → create
  // PENTING: field di-spread manual satu-satu, TIDAK pakai ...body langsung
  const newConfig = await prisma.approvalConfig.create({
    data: {
      tenantId,
      level,
      minAmount,
      maxAmount,
      approverUserId,
    },
  });

  return NextResponse.json(newConfig, { status: 201 });
}