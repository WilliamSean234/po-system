import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth"; // sesuaikan path sesuai setup NextAuth v5 kamu
import { prisma } from "@/lib/prisma";
import { createGoodsReceiptSchema } from "@/lib/validations/goodsReceipt";
import {
  validateReceiptQuantity,
  isPurchaseOrderFullyReceived,
  GoodsReceiptValidationError,
} from "@/lib/goodsReceiptValidation";
import { generateGrNumberWithRetry } from "@/lib/generateGrNumber";
import { assertPermission, PermissionDeniedError } from "@/lib/hasPermission";

// CATATAN types/next-auth.d.ts: file ini WAJIB ada di project (di
// types/next-auth.d.ts) karena handler di bawah mengakses
// session.user.tenantId, session.user.id, DAN session.user.role. Tanpa
// module augmentation itu, TypeScript menganggap Session["user"] cuma
// punya field bawaan NextAuth (name/email/image) — akses field custom
// ini akan error type-check saat build, dan developer jadi tergoda pakai
// `as any`, yang menyembunyikan bug permission (misal role check salah)
// sampai ketahuan production.

/**
 * POST /api/purchase-orders/[id]/goods-receipts
 * Membuat Goods Receipt baru untuk PO yang berstatus PO_SENT.
 * Immutable setelah dibuat — tidak ada PUT/PATCH untuk endpoint ini.
 *
 * BACKLOG REFACTOR: endpoint ini SEBELUMNYA tidak punya permission guard
 * sama sekali. Sekarang table-driven lewat hasPermission("gr.create"),
 * default role warehouse (+ admin).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: poId } = await params;
  if (!poId) {
    return NextResponse.json({ error: "PO ID tidak valid" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { tenantId, id: userId, role } = session.user;

  try {
    await assertPermission(tenantId, role, "gr.create");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json(
        { error: "Anda tidak berwenang membuat Goods Receipt" },
        { status: 403 }
      );
    }
    throw err;
  }

  const body = await request.json();
  const parsed = createGoodsReceiptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validasi gagal", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const input = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { id: poId, tenantId, isDeleted: false },
        include: { lines: true },
      });

      if (!po) {
        throw new Response("PO tidak ditemukan", { status: 404 });
      }

      if (po.status !== "PO_SENT") {
        throw new Response(
          `GR hanya bisa dibuat untuk PO berstatus PO_SENT. Status PO saat ini: ${po.status}`,
          { status: 400 }
        );
      }

      const poLineMap = new Map(po.lines.map((line) => [line.id, line]));

      let createdGr: Awaited<ReturnType<typeof tx.goodsReceipt.findFirstOrThrow>> | null = null;

      await generateGrNumberWithRetry(tx, tenantId, async (grNumber) => {
        for (const line of input.lines) {
          const poLine = poLineMap.get(line.poLineId);
          if (!poLine) {
            throw new Response(
              `poLineId ${line.poLineId} bukan bagian dari PO ini`,
              { status: 400 }
            );
          }

          try {
            await validateReceiptQuantity(
              tx,
              line.poLineId,
              Number(poLine.quantity),
              line.quantityReceived
            );
          } catch (err) {
            if (err instanceof GoodsReceiptValidationError) {
              throw new Response(err.message, { status: 400 });
            }
            throw err;
          }
        }

        createdGr = await tx.goodsReceipt.create({
          data: {
            tenantId,
            grNumber,
            poId,
            receivedBy: userId,
            receiptDate: input.receiptDate,
            notes: input.notes,
            lines: {
              create: input.lines.map((line) => ({
                poLineId: line.poLineId,
                batchNumber: line.batchNumber,
                expiryDate: line.expiryDate,
                quantityOrdered: poLineMap.get(line.poLineId)!.quantity,
                quantityReceived: line.quantityReceived,
                notes: line.notes,
              })),
            },
          },
          include: { lines: true },
        });
      });

      const fullyReceived = await isPurchaseOrderFullyReceived(tx, poId);
      if (fullyReceived) {
        await tx.purchaseOrder.update({
          where: { id: poId },
          data: { status: "RECEIVED" },
        });
      }

      return createdGr;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Response) {
      const message = await error.text();
      return NextResponse.json({ error: message }, { status: error.status });
    }

    console.error("Error creating goods receipt:", error);
    return NextResponse.json(
      { error: "Terjadi kesalahan saat membuat Goods Receipt" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/purchase-orders/[id]/goods-receipts
 * List semua Goods Receipt untuk 1 PO tertentu (tenant-scoped).
 * Tidak diberi permission guard — read-only, konsisten dengan pola GET
 * lain di project ini (GET PO list, GET vendor list, dst juga tidak
 * dijaga permission, hanya tenant-scoped).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: poId } = await params;
  if (!poId) {
    return NextResponse.json({ error: "PO ID tidak valid" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { tenantId } = session.user;

  const po = await prisma.purchaseOrder.findFirst({
    where: { id: poId, tenantId, isDeleted: false },
    select: { id: true },
  });
  if (!po) {
    return NextResponse.json({ error: "PO tidak ditemukan" }, { status: 404 });
  }

  const goodsReceipts = await prisma.goodsReceipt.findMany({
    where: { poId, tenantId },
    include: {
      lines: {
        include: {
          poLine: {
            include: { item: true },
          },
        },
      },
      receiver: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(goodsReceipts, { status: 200 });
}