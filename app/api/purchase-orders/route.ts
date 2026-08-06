import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { purchaseOrderCreateSchema } from "@/lib/validations/purchaseOrder";
import { generatePoNumber } from "@/lib/generatePoNumber";
import { Prisma } from "@/lib/generated/prisma"; // untuk cek tipe error P2002

// Batas percobaan ulang kalau ada race condition pas generate poNumber
const MAX_PO_NUMBER_RETRY = 3;

// GET /api/purchase-orders
// List semua PO milik tenant yang login, termasuk info vendor & jumlah lines
export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: { tenantId: session.user.tenantId, isDeleted: false },
    orderBy: { createdAt: "desc" },
    include: {
      vendor: { select: { id: true, name: true, code: true } },
      creator: { select: { id: true, name: true } },
      lines: true, // include lines biar frontend gak perlu fetch terpisah untuk list ringkas
    },
  });

  return NextResponse.json(purchaseOrders);
}

// POST /api/purchase-orders
// Create PO baru: header + lines sekaligus, dalam satu transaction.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId || !session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.user.tenantId;
  const createdBy = session.user.id;

  const body = await req.json();
  const parsed = purchaseOrderCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { vendorId, deliveryDate, notes, lines } = parsed.data;

  // Validasi vendor milik tenant ini, dan belum di-soft-delete
  const vendor = await prisma.vendor.findFirst({
    where: { id: vendorId, tenantId, isDeleted: false },
  });
  if (!vendor) {
    return NextResponse.json(
      { error: "vendorId tidak ditemukan atau bukan bagian dari tenant ini" },
      { status: 400 },
    );
  }

  // Validasi semua itemId di lines milik tenant ini, dan belum di-soft-delete.
  // Dicek SEKALIGUS pakai satu query (findMany), bukan loop findUnique satu-satu,
  // biar efisien dan gak N+1 query.
  const itemIds = [...new Set(lines.map((line) => line.itemId))];
  const foundItems = await prisma.item.findMany({
    where: { id: { in: itemIds }, tenantId, isDeleted: false },
  });
  if (foundItems.length !== itemIds.length) {
    const foundIds = new Set(foundItems.map((i) => i.id));
    const missingIds = itemIds.filter((id) => !foundIds.has(id));
    return NextResponse.json(
      {
        error: `itemId berikut tidak ditemukan atau bukan bagian dari tenant ini: ${missingIds.join(", ")}`,
      },
      { status: 400 },
    );
  }

  // Buat lookup map itemId -> uom, supaya gampang dipasangkan ke tiap line.
  // uom diambil dari master Item (bukan input user), lalu disnapshot ke POLine
  // supaya kalau master Item.uom berubah di kemudian hari, histori PO lama tidak ikut berubah.
  const itemUomMap = new Map(foundItems.map((item) => [item.id, item.uom]));

  // Hitung totalPrice per line (quantity * unitPrice), dan totalAmount = sum semua line
  const linesWithTotal = lines.map((line) => ({
    ...line,
    totalPrice: line.quantity * line.unitPrice,
  }));
  const totalAmount = linesWithTotal.reduce(
    (sum, line) => sum + line.totalPrice,
    0,
  );

  // Generate poNumber + create, dengan retry kalau kena race condition (unique constraint P2002)
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_PO_NUMBER_RETRY; attempt++) {
    try {
      const poNumber = await generatePoNumber(tenantId);

      const newPo = await prisma.purchaseOrder.create({
        data: {
          tenantId,
          poNumber,
          vendorId,
          createdBy,
          status: "DRAFT",
          currentApprovalLevel: 0,
          totalAmount,
          deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
          notes,
          lines: {
            create: linesWithTotal.map((line) => ({
              itemId: line.itemId,
              description: line.description,
              quantity: line.quantity,
              uom: itemUomMap.get(line.itemId)!,
              unitPrice: line.unitPrice,
              totalPrice: line.totalPrice,
            })),
          },
        },
        include: { lines: true, vendor: true },
      });

      return NextResponse.json(newPo, { status: 201 });
    } catch (err) {
      // P2002 = unique constraint violation. Kemungkinan besar poNumber kena race condition
      // (dua request create PO bersamaan dapat nomor urut yang sama). Coba generate ulang.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        lastError = err;
        continue; // retry loop
      }
      // Error lain (bukan soal poNumber) → langsung lempar, jangan retry percuma
      throw err;
    }
  }

  // Kalau sampai sini, berarti retry udah habis dan tetap gagal
  console.error(
    "Gagal generate poNumber unik setelah beberapa percobaan:",
    lastError,
  );
  return NextResponse.json(
    { error: "Gagal membuat PO karena konflik nomor urut. Coba lagi." },
    { status: 500 },
  );
}
