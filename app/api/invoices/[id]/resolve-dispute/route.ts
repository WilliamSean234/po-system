import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertPermission, PermissionDeniedError } from "@/lib/hasPermission";
import { isValidTransition } from "@/lib/invoiceStatusFlow";

// POST /api/invoices/[id]/resolve-dispute
// Transisi DISPUTED -> MATCHED secara manual, dilakukan finance setelah
// meninjau selisih harga dan memutuskan menerimanya (bukan sistem yang
// otomatis "membenarkan" price variance — keputusan bisnis manusia).
//
// PENTING: endpoint ini SATU-SATUNYA jalan menuju MATCHED dari DISPUTED.
// isValidTransition tetap dipanggil di sini (bukan diasumsikan otomatis
// benar) supaya kalau invoiceStatusFlow.ts berubah nanti, guard ini ikut
// konsisten tanpa perlu diingat manual di dua tempat.
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
    await assertPermission(tenantId, role, "invoice.resolve_dispute");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json(
        { error: "Anda tidak berwenang resolve dispute invoice ini" },
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

  if (!isValidTransition(invoice.status, "MATCHED")) {
    return NextResponse.json(
      { error: `Invoice hanya bisa di-resolve dari status DISPUTED. Status saat ini: ${invoice.status}` },
      { status: 400 }
    );
  }

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: "MATCHED",
      resolvedAt: new Date(),
      resolvedBy: userId,
    },
    include: { lines: true, po: { include: { vendor: true } } },
  });

  return NextResponse.json(updated, { status: 200 });
}