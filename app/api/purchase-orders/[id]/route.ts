import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { purchaseOrderUpdateSchema } from "@/lib/validations/purchaseOrder";
import { isValidTransition, areLinesLocked } from "@/lib/poStatusFlow";

// Tipe params sebagai Promise, sesuai Next.js 16
type RouteContext = { params: Promise<{ id: string }> };

// GET /api/purchase-orders/[id] — detail satu PO lengkap dengan lines
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, tenantId: session.user.tenantId, isDeleted: false },
    include: {
      vendor: true,
      creator: { select: { id: true, name: true, email: true } },
      lines: {
        include: { item: { select: { id: true, name: true, code: true } } },
      },
    },
  });

  if (!po) {
    return NextResponse.json(
      { error: "Purchase Order tidak ditemukan" },
      { status: 404 },
    );
  }

  return NextResponse.json(po);
}

// PUT /api/purchase-orders/[id] — update header, status, dan/atau lines sekaligus
// (mirip pola SAP ME22N: satu transaksi untuk header + line items)
export async function PUT(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.user.tenantId;

  const existing = await prisma.purchaseOrder.findFirst({
    where: { id, tenantId, isDeleted: false },
    include: { lines: true },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "Purchase Order tidak ditemukan" },
      { status: 404 },
    );
  }

  const body = await req.json();
  const parsed = purchaseOrderUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { vendorId, status, notes, deliveryDate, lines } = parsed.data;

  // ── Cegah status approval-related diubah lewat PUT biasa ──
  // SUBMITTED/APPROVED/REJECTED punya alur bisnis khusus (matching strategy,
  // approval per-level, validasi wewenang) yang HARUS lewat endpoint dedicated:
  // /submit, /approve, /reject. Kalau dibolehkan lewat PUT, approval flow bisa dilewati begitu saja.
  const APPROVAL_MANAGED_STATUSES = ["SUBMITTED", "APPROVED", "REJECTED"];
  if (status !== undefined && APPROVAL_MANAGED_STATUSES.includes(status)) {
    return NextResponse.json(
      {
        error: `Status '${status}' tidak bisa diubah lewat endpoint ini. Gunakan endpoint /submit, /approve, atau /reject.`,
      },
      { status: 400 },
    );
  }

  // ── Validasi transisi status (kalau status dikirim & beda dari sekarang) ──
  if (status !== undefined && status !== existing.status) {
    if (!isValidTransition(existing.status, status)) {
      return NextResponse.json(
        {
          error: `Transisi status dari '${existing.status}' ke '${status}' tidak diizinkan`,
        },
        { status: 409 },
      );
    }
  }
  const finalStatus = status ?? existing.status;

  // ── Validasi vendor baru (kalau vendorId diganti) ──
  if (vendorId !== undefined) {
    const vendor = await prisma.vendor.findFirst({
      where: { id: vendorId, tenantId, isDeleted: false },
    });
    if (!vendor) {
      return NextResponse.json(
        { error: "vendorId tidak ditemukan atau bukan bagian dari tenant ini" },
        { status: 400 },
      );
    }
  }

  // ── Kalau lines dikirim, cek dulu apakah statusnya masih boleh diedit ──
  if (lines !== undefined && areLinesLocked(existing.status)) {
    return NextResponse.json(
      {
        error: `Lines tidak bisa diubah karena PO sudah berstatus '${existing.status}'. Item PO terkunci sejak status APPROVED ke atas.`,
      },
      { status: 409 },
    );
  }

  // ── Siapkan data lines baru (kalau ada), termasuk validasi item + uom snapshot ──
  let newTotalAmount = Number(existing.totalAmount);
  let linesToCreate: {
    itemId: string;
    description?: string;
    quantity: number;
    uom: string;
    unitPrice: number;
    totalPrice: number;
  }[] = [];

  if (lines !== undefined) {
    const itemIds = [...new Set(lines.map((line) => line.itemId))];
    const foundItems = await prisma.item.findMany({
      where: { id: { in: itemIds }, tenantId, isDeleted: false },
    });
    if (foundItems.length !== itemIds.length) {
      const foundIds = new Set(foundItems.map((i) => i.id));
      const missingIds = itemIds.filter((itemId) => !foundIds.has(itemId));
      return NextResponse.json(
        {
          error: `itemId berikut tidak ditemukan atau bukan bagian dari tenant ini: ${missingIds.join(", ")}`,
        },
        { status: 400 },
      );
    }

    const itemUomMap = new Map(foundItems.map((item) => [item.id, item.uom]));

    linesToCreate = lines.map((line) => ({
      itemId: line.itemId,
      description: line.description,
      quantity: line.quantity,
      uom: itemUomMap.get(line.itemId)!,
      unitPrice: line.unitPrice,
      totalPrice: line.quantity * line.unitPrice,
    }));

    newTotalAmount = linesToCreate.reduce(
      (sum, line) => sum + line.totalPrice,
      0,
    );
  }

  // ── Update dalam satu transaction: header + (opsional) replace semua lines ──
  const updated = await prisma.$transaction(async (tx) => {
    // Kalau lines dikirim, hapus semua lines lama, ganti dengan yang baru.
    // Ini "full replace", bukan partial merge — sesuai kesepakatan desain.
    if (lines !== undefined) {
      await tx.pOLine.deleteMany({ where: { poId: id } });
    }

    return tx.purchaseOrder.update({
      where: { id },
      data: {
        vendorId: vendorId ?? existing.vendorId,
        status: finalStatus,
        notes: notes ?? existing.notes,
        deliveryDate:
          deliveryDate !== undefined
            ? deliveryDate === null
              ? null
              : new Date(deliveryDate)
            : existing.deliveryDate,
        totalAmount: newTotalAmount,
        ...(lines !== undefined ? { lines: { create: linesToCreate } } : {}),
      },
      include: { lines: true, vendor: true },
    });
  });

  return NextResponse.json(updated);
}

// DELETE /api/purchase-orders/[id] — SOFT delete, HANYA untuk status DRAFT
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await prisma.purchaseOrder.findFirst({
    where: { id, tenantId: session.user.tenantId, isDeleted: false },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "Purchase Order tidak ditemukan" },
      { status: 404 },
    );
  }

  if (existing.status !== "DRAFT") {
    return NextResponse.json(
      {
        error: `Purchase Order dengan status '${existing.status}' tidak bisa dihapus. Hanya PO berstatus DRAFT yang bisa dihapus — gunakan status CANCELLED untuk membatalkan PO yang sudah diproses.`,
      },
      { status: 409 },
    );
  }

  // Soft delete: tandai isDeleted + deletedAt, JANGAN hapus row-nya.
  // poNumber tetap tersimpan di database (walau gak dipakai lagi),
  // supaya nomor dokumen gak pernah bisa dipakai ulang (jaga audit trail).
  await prisma.purchaseOrder.update({
    where: { id },
    data: { isDeleted: true, deletedAt: new Date() },
  });
  return NextResponse.json({ message: "Purchase Order berhasil dihapus" });
}
