import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth"; // sesuaikan path sesuai setup NextAuth v5 kamu
import { prisma } from "@/lib/prisma";

// CATATAN types/next-auth.d.ts: file ini WAJIB ada di project (di
// types/next-auth.d.ts) karena route ini mengakses session.user.tenantId,
// session.user.id, DAN session.user.role. Tanpa module augmentation itu,
// TypeScript menganggap Session["user"] cuma punya field bawaan NextAuth
// (name/email/image) — akses field custom ini akan error type-check saat
// build, dan developer jadi tergoda pakai `as any`, yang kalau sampai
// terjadi di sini KHUSUSNYA berbahaya: validasi role jadi tidak type-safe,
// artinya bug seperti "role check salah ketik jadi selalu true" tidak akan
// ketahuan compiler, baru ketahuan production setelah user yang tidak
// berwenang berhasil mengirim PO ke vendor.

// Role yang boleh trigger pengiriman PO ke vendor.
// Didefinisikan sebagai const array (bukan hardcode inline di if-check)
// supaya gampang di-maintain kalau nanti ada role baru yang perlu ditambah.
const ALLOWED_ROLES = ["admin", "purchasing"] as const;

/**
 * POST /api/purchase-orders/[id]/send
 * Transisi status PO dari APPROVED -> PO_SENT (menandakan PO sudah
 * dikirim/dikomunikasikan ke vendor). Mirip transaksi ME9F di SAP
 * (output message ke vendor) — saat ini hanya update status + audit
 * trail (sentAt, sentBy); PDF/email ke vendor didefer sebagai fitur
 * terpisah (on-the-horizon).
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

  // Role guard — hanya admin/purchasing yang boleh mengirim PO ke vendor
  if (!ALLOWED_ROLES.includes(role as (typeof ALLOWED_ROLES)[number])) {
    return NextResponse.json(
      { error: "Anda tidak berwenang mengirim PO ke vendor" },
      { status: 403 }
    );
  }

  const po = await prisma.purchaseOrder.findFirst({
    where: { id: poId, tenantId, isDeleted: false },
  });

  if (!po) {
    return NextResponse.json({ error: "PO tidak ditemukan" }, { status: 404 });
  }

  // Hanya boleh dari status APPROVED. Ditulis eksplisit di sini (bukan
  // cuma andalkan lib/poStatusFlow.ts) karena transisi ini punya
  // prasyarat bisnis tambahan yang lebih ketat daripada sekadar "status
  // flow mengizinkan" — PO_SENT SPESIFIK hanya boleh dari APPROVED, tidak
  // ada jalur lain (beda dengan misal CANCELLED yang bisa dari beberapa status).
  if (po.status !== "APPROVED") {
    return NextResponse.json(
      {
        error: `PO hanya bisa dikirim ke vendor dari status APPROVED. Status saat ini: ${po.status}`,
      },
      { status: 400 }
    );
  }

  const updated = await prisma.purchaseOrder.update({
    where: { id: poId },
    data: {
      status: "PO_SENT",
      sentAt: new Date(),
      sentBy: userId,
    },
  });

  return NextResponse.json(updated, { status: 200 });
}