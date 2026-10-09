// app/api/purchase-orders/[id]/goods-receipts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth"; // sesuaikan path sesuai setup NextAuth v5 kamu
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma";
import { createGoodsReceiptSchema } from "@/lib/validations/goodsReceipt";
import {
  validateReceiptQuantity,
  isPurchaseOrderFullyReceived,
  GoodsReceiptValidationError,
} from "@/lib/goodsReceiptValidation";
import { generateGrNumberWithRetry } from "@/lib/generateGrNumber";
import { assertPermission, PermissionDeniedError } from "@/lib/hasPermission";
import { recordStockMovement, MOVEMENT_TYPE, REFERENCE_TYPE } from "@/lib/stockLedger";

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
 * W5 (Inventory Management) — perubahan dari versi sebelumnya:
 * 1. Body sekarang WAJIB menyertakan warehouseId (gudang tujuan barang masuk).
 * 2. Tiap line WAJIB menyertakan batchId (FK ke Batch master), menggantikan
 *    batchNumber(string)+expiryDate(Date?) yang dulu bebas diisi manual.
 * 3. Setiap line yang berhasil dibuat sekarang otomatis mencatat 1
 *    StockMovement (movement type "101") + meng-update InventoryBalance
 *    (cache) secara incremental, dalam transaction yang sama dengan
 *    pembuatan GR — supaya GR dan pencatatan stok selalu atomik: kalau
 *    salah satu gagal, keduanya rollback bersama.
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
    const result = await prisma.$transaction(
      async (tx) => {
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

      // W5 Inventory: pastikan warehouse tujuan valid & milik tenant ini.
      const warehouse = await tx.warehouse.findFirst({
        where: { id: input.warehouseId, tenantId, isDeleted: false },
      });
      if (!warehouse) {
        throw new Response("Warehouse tidak ditemukan", { status: 400 });
      }

      const poLineMap = new Map(po.lines.map((line) => [line.id, line]));

      // FIX: tipe sebelumnya (Awaited<ReturnType<typeof tx.goodsReceipt.findFirstOrThrow>>)
      // diambil dari signature method TANPA argumen, jadi TypeScript menganggap
      // hasilnya GoodsReceipt polos tanpa relasi `lines` — padahal create() di
      // bawah selalu dipanggil dengan include: { lines: true }. Pakai
      // Prisma.GoodsReceiptGetPayload supaya tipe createdGr eksplisit menyertakan
      // bentuk include yang sebenarnya dipakai (dibutuhkan W5 Inventory untuk
      // loop createdGr.lines saat memanggil recordStockMovement).
      let createdGr: Prisma.GoodsReceiptGetPayload<{ include: { lines: true } }> | null = null;

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

          // W5 Inventory: batchId yang dikirim harus benar-benar merujuk ke
          // Batch milik item yang sama dengan poLine ini — mencegah salah
          // kirim batchId item lain (mis. batch milik Item B dipakai untuk
          // menerima Item A, yang akan membuat data stok per-batch salah).
          const batch = await tx.batch.findFirst({
            where: { id: line.batchId, tenantId, itemId: poLine.itemId },
          });
          if (!batch) {
            throw new Response(
              `batchId ${line.batchId} tidak valid untuk item pada poLineId ${line.poLineId} (batch harus terdaftar untuk item yang sama)`,
              { status: 400 }
            );
          }
        }

        createdGr = await tx.goodsReceipt.create({
          data: {
            tenantId,
            grNumber,
            poId,
            warehouseId: input.warehouseId, // BARU (W5 Inventory)
            receivedBy: userId,
            receiptDate: input.receiptDate,
            notes: input.notes,
            lines: {
              create: input.lines.map((line) => ({
                poLineId: line.poLineId,
                batchId: line.batchId, // GANTI dari batchNumber+expiryDate (W5 Inventory)
                quantityOrdered: poLineMap.get(line.poLineId)!.quantity,
                quantityReceived: line.quantityReceived,
                notes: line.notes,
              })),
            },
          },
          include: { lines: true },
        });

        // W5 Inventory: tiap GRLine yang berhasil dibuat menghasilkan 1
        // StockMovement "101" (goods receipt in) + update InventoryBalance
        // secara incremental — dipanggil di dalam transaction yang sama
        // supaya atomik dengan pembuatan GR (rollback bersama kalau gagal).
        for (const line of createdGr.lines) {
          const poLine = poLineMap.get(line.poLineId)!;
          await recordStockMovement({
            tx,
            tenantId,
            itemId: poLine.itemId,
            warehouseId: input.warehouseId,
            batchId: line.batchId,
            quantity: line.quantityReceived, // signed positif = stock in
            movementType: MOVEMENT_TYPE.GR_RECEIPT,
            referenceType: REFERENCE_TYPE.GOODS_RECEIPT,
            referenceId: createdGr.id,
            movementDate: input.receiptDate,
            createdBy: userId,
            notes: `GR ${grNumber}`,
          });
        }
      });

      const fullyReceived = await isPurchaseOrderFullyReceived(tx, poId);
      if (fullyReceived) {
        await tx.purchaseOrder.update({
          where: { id: poId },
          data: { status: "RECEIVED" },
        });
      }

      return createdGr;
      },
      {
        // Default interactive transaction timeout Prisma = 5000ms. Transaction
        // ini sekarang jauh lebih berat (validasi qty+batch, create GR+lines,
        // lalu recordStockMovement per line = beberapa query tiap line) dan
        // ditambah latensi Neon serverless, jadi default 5s terlampaui (P2028).
        timeout: 15000, // maks durasi eksekusi transaction
        maxWait: 10000, // maks waktu menunggu koneksi dari pool sebelum transaction mulai
      }
    );

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
 *
 * W5 Inventory: include warehouse (gudang tujuan) dan batch (info lot/expiry)
 * ditambahkan supaya response langsung membawa data yang dibutuhkan UI,
 * tanpa perlu request terpisah.
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
      warehouse: {
        select: { id: true, code: true, name: true },
      },
      lines: {
        include: {
          poLine: {
            include: { item: true },
          },
          batch: {
            select: { id: true, batchNumber: true, expiryDate: true },
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