import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { invoiceCreateSchema } from "@/lib/validations/invoice";
import { generateInvoiceNumberWithRetry } from "@/lib/invoiceNumber";
import { assertPermission, PermissionDeniedError } from "@/lib/hasPermission";

// GET /api/invoices
// List semua Invoice milik tenant yang login, termasuk info PO & vendor
// (diturunkan lewat po.vendor, bukan field vendorId langsung di Invoice —
// lihat keputusan desain di schema: vendor TIDAK di-duplicate di Invoice).
export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const invoices = await prisma.invoice.findMany({
    where: { tenantId: session.user.tenantId, isDeleted: false },
    orderBy: { createdAt: "desc" },
    include: {
      po: {
        select: { id: true, poNumber: true, vendor: { select: { id: true, name: true, code: true } } },
      },
      creator: { select: { id: true, name: true } },
      lines: true,
    },
  });

  return NextResponse.json(invoices);
}

// POST /api/invoices
// Create Invoice baru: header + lines sekaligus, status selalu DRAFT.
// Dibungkus prisma.$transaction (BEDA dari PO yang tidak transaction-wrapped)
// karena generateInvoiceNumberWithRetry butuh tx, dan supaya pola yang sama
// konsisten dipakai lagi nanti di endpoint /submit yang lebih sensitif
// terhadap race condition (matching quantity terhadap GR).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId || !session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tenantId, id: userId, role } = session.user;

  try {
    await assertPermission(tenantId, role, "invoice.create");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json(
        { error: "Anda tidak berwenang membuat invoice" },
        { status: 403 }
      );
    }
    throw err;
  }

  const body = await req.json();
  const parsed = invoiceCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { poId, invoiceDate, dueDate, notes, lines } = parsed.data;

  // Validasi PO ada, milik tenant ini, belum soft-deleted.
  // TIDAK dibatasi status tertentu di sini — invoice DRAFT boleh dibuat
  // dari PO status apa saja (bahkan sebelum PO_SENT/RECEIVED), sesuai
  // keputusan desain: hanya SUBMIT yang butuh prasyarat GR, bukan create.
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: poId, tenantId, isDeleted: false },
    include: { lines: true },
  });
  if (!po) {
    return NextResponse.json(
      { error: "poId tidak ditemukan atau bukan bagian dari tenant ini" },
      { status: 400 }
    );
  }

  // Validasi semua poLineId di lines benar-benar milik PO ini (bukan PO
  // lain, bukan poLineId asal comot). Dicek pakai Set/Map, bukan loop
  // query satu-satu, sama seperti pola validasi itemId di PO create.
  const validPoLineIds = new Set(po.lines.map((l) => l.id));
  const missingPoLineIds = lines
    .map((l) => l.poLineId)
    .filter((id) => !validPoLineIds.has(id));
  if (missingPoLineIds.length > 0) {
    return NextResponse.json(
      {
        error: `poLineId berikut tidak ditemukan pada PO ini: ${missingPoLineIds.join(", ")}`,
      },
      { status: 400 }
    );
  }

  // Hitung totalPrice per line (quantity * unitPrice), totalAmount = sum semua line.
  // unitPrice TIDAK di-snapshot dari POLine — ini input user (harga di kertas
  // invoice vendor), sengaja independen (lihat catatan di schema & invoiceMatching.ts).
  const linesWithTotal = lines.map((line) => ({
    ...line,
    totalPrice: line.quantity * line.unitPrice,
  }));
  const totalAmount = linesWithTotal.reduce((sum, line) => sum + line.totalPrice, 0);

  try {
    let createdInvoice: Awaited<ReturnType<typeof prisma.invoice.findUniqueOrThrow>> | null = null;

    await prisma.$transaction(async (tx) => {
      await generateInvoiceNumberWithRetry(tx, tenantId, async (invoiceNumber) => {
        const invoice = await tx.invoice.create({
          data: {
            tenantId,
            invoiceNumber,
            poId,
            status: "DRAFT",
            invoiceDate: new Date(invoiceDate),
            dueDate: dueDate ? new Date(dueDate) : null,
            totalAmount,
            notes,
            createdBy: userId,
            lines: {
              create: linesWithTotal.map((line) => ({
                poLineId: line.poLineId,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                totalPrice: line.totalPrice,
                notes: line.notes,
              })),
            },
          },
          include: { lines: true, po: { include: { vendor: true } } },
        });
        createdInvoice = invoice;
      });
    });

    return NextResponse.json(createdInvoice, { status: 201 });
  } catch (err) {
    console.error("Gagal membuat invoice:", err);
    return NextResponse.json(
      { error: "Gagal membuat invoice karena konflik nomor urut. Coba lagi." },
      { status: 500 }
    );
  }
}