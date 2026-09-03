import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertPermission, PermissionDeniedError } from "@/lib/hasPermission";
import { canCancelInvoice } from "@/lib/invoiceStatusFlow";

// POST /api/invoices/[id]/cancel
// Transisi ke CANCELLED dari DRAFT/SUBMITTED/DISPUTED/MATCHED (tidak dari
// PAID — lihat invoiceStatusFlow.ts, invoice yang sudah dibayar butuh
// proses accounting terpisah/credit note, didefer).
// TIDAK ada field cancelledBy/cancelledAt — konsisten dengan PurchaseOrder
// yang juga tidak mencatat aktor untuk CANCELLED (cukup status+updatedAt).
export async function POST(
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
    await assertPermission(tenantId, role, "invoice.cancel");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json(
        { error: "Anda tidak berwenang cancel invoice ini" },
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

  if (!canCancelInvoice(invoice.status)) {
    return NextResponse.json(
      { error: `Invoice dengan status ${invoice.status} tidak bisa di-cancel.` },
      { status: 400 }
    );
  }

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: "CANCELLED" },
    include: { lines: true, po: { include: { vendor: true } } },
  });

  return NextResponse.json(updated, { status: 200 });
}