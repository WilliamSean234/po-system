// GET semua item dan POST item baru

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { createItemSchema } from "@/lib/validations/item";

export async function GET() {
  // Cek apakah user sudah login
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  // Ambil semua item milik tenant yang sedang login
  // NOTE: model Item belum punya isDeleted/deletedAt (beda dari Vendor),
  // jadi belum ada filter soft-delete di sini. Kalau nanti Item butuh
  // soft delete juga, tambahkan kolom itu dulu ke schema.prisma.
  const items = await prisma.item.findMany({
    where: {
      tenantId: session.user.tenantId,
      isDeleted: false,
    },
    orderBy: { code: "asc" },
  });

  return NextResponse.json(items);
}

export async function POST(req: Request) {
  // 1. Auth guard
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 2. Parse body
    const body = await req.json();

    // 3. Validasi pakai Zod
    const result = createItemSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: result.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const tenantId = session.user.tenantId;

    // 4. Generate code + create item dalam SATU transaction,
    // sama seperti pattern Vendor — mencegah race condition saat
    // dua request POST datang hampir bersamaan.
    const item = await prisma.$transaction(async (tx) => {
      // Hitung jumlah item yang PERNAH dibuat di tenant ini,
      // supaya code tidak pernah dipakai ulang
      const itemCount = await tx.item.count({
        where: { tenantId },
      });

      const nextNumber = itemCount + 1;
      const generatedCode = `ITM-${String(nextNumber).padStart(3, "0")}`;

      return tx.item.create({
        data: {
          ...result.data,
          code: generatedCode,
          tenantId, // dari session, BUKAN dari body — mencegah cross-tenant injection
        },
      });
    });

    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    console.error("Error creating item:", error);
    return NextResponse.json(
      { error: "Failed to create item" },
      { status: 500 },
    );
  }
}