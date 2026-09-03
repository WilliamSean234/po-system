import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertPermission, PermissionDeniedError } from "@/lib/hasPermission";
import { assertPurchaseOrderHasGoodsReceipt, InvoicePrerequisiteError } from "@/lib/invoiceValidation";
import { runInvoiceMatching, InvoiceValidationError } from "@/lib/invoiceMatching";

// POST /api/invoices/[id]/submit
// Transisi DRAFT -> SUBMITTED, lalu LANGSUNG jalankan matching di
// transaction yang sama (bukan status terpisah yang menggantung) —
// hasil akhir yang di-persist adalah MATCHED atau DISPUTED, dengan
// submittedAt/submittedBy tercatat sebagai bukti kapan+siapa yang submit.
// Status "SUBMITTED" secara harfiah tidak pernah tersimpan di DB karena
// matching berjalan sinkron, tapi tetap ada di VALID_TRANSITIONS sebagai
// langkah logis (submit dulu, baru matching menentukan hasil).
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
    await assertPermission(tenantId, role, "invoice.submit");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json(
        { error: "Anda tidak berwenang submit invoice" },
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

  if (invoice.status !== "DRAFT") {
    return NextResponse.json(
      { error: `Invoice hanya bisa disubmit dari status DRAFT. Status saat ini: ${invoice.status}` },
      { status: 400 }
    );
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // Prasyarat: PO harus punya minimal 1 GR — hard block kalau belum.
      await assertPurchaseOrderHasGoodsReceipt(tx, invoice.poId);

      // Matching: validasi cumulative qty terhadap GR (throw kalau over),
      // deteksi price variance (tidak throw, cuma menentukan hasil akhir).
      const result = await runInvoiceMatching(tx, invoiceId);

      return tx.invoice.update({
        where: { id: invoiceId },
        data: {
          status: result, // "MATCHED" | "DISPUTED"
          submittedAt: new Date(),
          submittedBy: userId,
        },
        include: { lines: true, po: { include: { vendor: true } } },
      });
    });

    return NextResponse.json(updated, { status: 200 });
  } catch (err) {
    if (err instanceof InvoicePrerequisiteError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof InvoiceValidationError) {
      return NextResponse.json(
        {
          error: err.message,
          poLineId: err.poLineId,
          quantityReceived: err.quantityReceived,
          alreadyInvoiced: err.alreadyInvoiced,
          attemptedQuantity: err.attemptedQuantity,
        },
        { status: 400 }
      );
    }
    throw err; // error lain (Prisma connection, dst) — biarkan naik jadi 500
  }
}