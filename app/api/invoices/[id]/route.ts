import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { invoiceUpdateSchema } from "@/lib/validations/invoice";
import { assertPermission, PermissionDeniedError } from "@/lib/hasPermission";
import { canDeleteInvoice } from "@/lib/invoiceStatusFlow";

// GET /api/invoices/[id]
// Detail satu invoice, termasuk PO+vendor dan semua lines.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: invoiceId } = await params;
  if (!invoiceId) {
    return NextResponse.json({ error: "Invoice ID tidak valid" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId: session.user.tenantId, isDeleted: false },
    include: {
      po: { include: { vendor: true } },
      lines: { include: { poLine: true } }, // include poLine biar frontend bisa tampilkan qty ordered/received tanpa fetch terpisah
      creator: { select: { id: true, name: true } },
      submitter: { select: { id: true, name: true } },
      resolver: { select: { id: true, name: true } },
      payer: { select: { id: true, name: true } },
    },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice tidak ditemukan" }, { status: 404 });
  }

  return NextResponse.json(invoice);
}

// PUT /api/invoices/[id]
// Edit header + replace lines — HANYA diizinkan selagi status DRAFT.
// Begitu SUBMITTED, lines terkunci (areInvoiceLinesLocked) dan perubahan
// harus lewat endpoint action khusus, bukan PUT ini.
//
// CATATAN permission: katalog W3T2 tidak punya key terpisah "invoice.edit" —
// mengedit invoice yang masih DRAFT dianggap kelanjutan dari "invoice.create"
// (aktor yang boleh membuat draft juga boleh mengoreksi draft-nya sebelum
// submit). Kalau ke depan kebutuhan berbeda (misal role lain perlu edit
// tapi tidak boleh create baru), tinggal tambah key baru di katalog.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: invoiceId } = await params;
  if (!invoiceId) {
    return NextResponse.json({ error: "Invoice ID tidak valid" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { tenantId, role } = session.user;

  try {
    await assertPermission(tenantId, role, "invoice.create");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json(
        { error: "Anda tidak berwenang mengubah invoice ini" },
        { status: 403 }
      );
    }
    throw err;
  }

  const existing = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId, isDeleted: false },
    include: { po: { include: { lines: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Invoice tidak ditemukan" }, { status: 404 });
  }

  if (existing.status !== "DRAFT") {
    return NextResponse.json(
      { error: `Invoice hanya bisa diedit selagi status DRAFT. Status saat ini: ${existing.status}` },
      { status: 400 }
    );
  }

  const body = await request.json();
  const parsed = invoiceUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { invoiceDate, dueDate, notes, lines } = parsed.data;

  // Kalau lines dikirim, validasi ulang poLineId milik PO yang sama —
  // pola sama persis seperti POST create.
  let linesWithTotal: { poLineId: string; quantity: number; unitPrice: number; totalPrice: number; notes?: string }[] | undefined;
  let totalAmount: number | undefined;

  if (lines) {
    const validPoLineIds = new Set(existing.po.lines.map((l) => l.id));
    const missingPoLineIds = lines.map((l) => l.poLineId).filter((id) => !validPoLineIds.has(id));
    if (missingPoLineIds.length > 0) {
      return NextResponse.json(
        { error: `poLineId berikut tidak ditemukan pada PO ini: ${missingPoLineIds.join(", ")}` },
        { status: 400 }
      );
    }

    linesWithTotal = lines.map((line) => ({
      ...line,
      totalPrice: line.quantity * line.unitPrice,
    }));
    totalAmount = linesWithTotal.reduce((sum, line) => sum + line.totalPrice, 0);
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (linesWithTotal) {
      // Replace seluruh lines — hapus semua baris lama, insert baru.
      // Pola sama seperti PUT PO waktu lines dikirim (replace, bukan merge).
      await tx.invoiceLine.deleteMany({ where: { invoiceId } });
    }

    return tx.invoice.update({
      where: { id: invoiceId },
      data: {
        invoiceDate: invoiceDate ? new Date(invoiceDate) : undefined,
        dueDate: dueDate === null ? null : dueDate ? new Date(dueDate) : undefined,
        notes,
        totalAmount,
        ...(linesWithTotal
          ? {
              lines: {
                create: linesWithTotal.map((line) => ({
                  poLineId: line.poLineId,
                  quantity: line.quantity,
                  unitPrice: line.unitPrice,
                  totalPrice: line.totalPrice,
                  notes: line.notes,
                })),
              },
            }
          : {}),
      },
      include: { lines: true, po: { include: { vendor: true } } },
    });
  });

  return NextResponse.json(updated);
}

// DELETE /api/invoices/[id]
// Soft delete — HANYA untuk invoice yang masih DRAFT (kesalahan input
// sebelum submit). Invoice yang sudah SUBMITTED/DISPUTED/MATCHED/PAID
// harus lewat /cancel, bukan delete (lihat canDeleteInvoice vs canCancelInvoice
// di invoiceStatusFlow.ts — dua konsep yang sengaja dipisah).
//
// Permission dicek pakai "invoice.create" — sama seperti PUT — karena
// menghapus draft dianggap kelanjutan wewenang membuat/mengoreksi draft
// milik sendiri, bukan aksi terpisah yang butuh key permission sendiri.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: invoiceId } = await params;
  if (!invoiceId) {
    return NextResponse.json({ error: "Invoice ID tidak valid" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { tenantId, role } = session.user;

  try {
    await assertPermission(tenantId, role, "invoice.create");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json(
        { error: "Anda tidak berwenang menghapus invoice ini" },
        { status: 403 }
      );
    }
    throw err;
  }

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId, isDeleted: false },
  });
  if (!invoice) {
    return NextResponse.json({ error: "Invoice tidak ditemukan" }, { status: 404 });
  }

  if (!canDeleteInvoice(invoice.status)) {
    return NextResponse.json(
      { error: `Invoice dengan status ${invoice.status} tidak bisa dihapus. Gunakan cancel.` },
      { status: 400 }
    );
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { isDeleted: true, deletedAt: new Date() },
  });

  return NextResponse.json({ message: "Invoice berhasil dihapus" }, { status: 200 });
}