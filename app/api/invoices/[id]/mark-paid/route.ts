import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertPermission, PermissionDeniedError } from "@/lib/hasPermission";
import { isValidTransition } from "@/lib/invoiceStatusFlow";

// POST /api/invoices/[id]/mark-paid
// Transisi MATCHED -> PAID. Ini BUKAN payment run/gateway integration
// (didefer, on-the-horizon) — sekadar mencatat bahwa pembayaran sudah
// dilakukan secara manual (transfer bank, dst di luar sistem), dengan
// audit trail siapa+kapan.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: invoiceId } = await params;
  if (!invoiceId) {
    return NextResponse.json({ error: "Invoice ID tidak valid" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.tenantId || !session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { tenantId, id: userId, role } = session.user;

  try {
    await assertPermission(tenantId, role, "invoice.mark_paid");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json(
        { error: "Anda tidak berwenang menandai invoice ini sebagai PAID" },
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

  if (!isValidTransition(invoice.status, "PAID")) {
    return NextResponse.json(
      { error: `Invoice hanya bisa ditandai PAID dari status MATCHED. Status saat ini: ${invoice.status}` },
      { status: 400 }
    );
  }

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: "PAID",
      paidAt: new Date(),
      paidBy: userId,
    },
    include: { lines: true, po: { include: { vendor: true } } },
  });

  return NextResponse.json(updated, { status: 200 });
}