import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth"; // sesuaikan path sesuai setup NextAuth v5 kamu
import { prisma } from "@/lib/prisma";
import { assertPermission, PermissionDeniedError } from "@/lib/hasPermission";

// CATATAN types/next-auth.d.ts: file ini WAJIB ada di project karena route
// ini mengakses session.user.tenantId dan session.user.role.

/**
 * POST /api/purchase-orders/[id]/close
 * Transisi status PO dari RECEIVED -> CLOSED.
 *
 * CATATAN DESAIN (final): CLOSED hanya bergantung pada kelengkapan
 * penerimaan barang (status RECEIVED), TIDAK bergantung pada status
 * Invoice sama sekali (baik DISPUTED maupun PAID). Alasan: PO.status
 * merepresentasikan siklus BARANG, Invoice.status merepresentasikan
 * siklus TAGIHAN — dua garis waktu independen yang tidak saling
 * mengunci, konsisten dengan cara SAP memisahkan MM (procurement) dari
 * FI (accounts payable). resolve-dispute juga tidak bergantung status
 * PO, jadi tidak ada fungsi yang terhambat kalau PO sudah CLOSED
 * sementara ada invoice DISPUTED yang masih berjalan.
 *
 * KONSEKUENSI YANG PERLU DIKETAHUI: CLOSED bukan jaminan "tidak ada
 * masalah apapun" pada PO ini — hanya berarti barang sudah lengkap
 * diterima. Kalau butuh melihat "PO closed yang masih ada invoice
 * bermasalah", itu lewat laporan terpisah (join PurchaseOrder.status
 * = CLOSED dengan Invoice.status = DISPUTED), bukan lewat gate ini.
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
  const { tenantId, role } = session.user;

  try {
    await assertPermission(tenantId, role, "po.close");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json(
        { error: "Anda tidak berwenang menutup PO ini" },
        { status: 403 }
      );
    }
    throw err;
  }

  const po = await prisma.purchaseOrder.findFirst({
    where: { id: poId, tenantId, isDeleted: false },
  });
  if (!po) {
    return NextResponse.json({ error: "PO tidak ditemukan" }, { status: 404 });
  }

  if (po.status !== "RECEIVED") {
    return NextResponse.json(
      { error: `PO hanya bisa ditutup dari status RECEIVED. Status saat ini: ${po.status}` },
      { status: 400 }
    );
  }

  const updated = await prisma.purchaseOrder.update({
    where: { id: poId },
    data: { status: "CLOSED" },
  });

  return NextResponse.json(updated, { status: 200 });
}