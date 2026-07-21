// untuk GET semua vendor dan POST vendor baru:

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { createVendorSchema } from "@/lib/validations/vendor";

export async function GET() {
  // Cek apakah user sudah login
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  // Ambil semua vendor milik tenant yang sedang login
  const vendors = await prisma.vendor.findMany({
    where: {
      tenantId: session.user.tenantId,
      isDeleted: false, // jangan tampilkan vendor yang sudah soft-deleted
    },
    orderBy: { code: "asc" },
  });

  return NextResponse.json(vendors);
}

export async function POST(req: Request) {
  // 1. Auth guard — konsisten pakai optional chaining
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 2. Parse body
    const body = await req.json();

    // 3. Validasi pakai Zod
    const result = createVendorSchema.safeParse(body);
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

    // 4. Generate code + create vendor dalam SATU transaction.
    // Ini penting untuk mencegah race condition: kalau dua request
    // POST datang hampir bersamaan, tanpa transaction keduanya bisa
    // sama-sama menghitung "vendor berikutnya adalah #005" dan gagal
    // di unique constraint, atau lebih buruk, salah satu silently
    // menimpa nomor yang sama.
    const vendor = await prisma.$transaction(async (tx) => {
      // Hitung jumlah vendor yang PERNAH dibuat di tenant ini
      // (termasuk yang soft-deleted, supaya code tidak pernah dipakai ulang)
      const vendorCount = await tx.vendor.count({
        where: { tenantId },
      });

      const nextNumber = vendorCount + 1;
      const generatedCode = `VND-${String(nextNumber).padStart(3, "0")}`;

      return tx.vendor.create({
        data: {
          ...result.data,
          code: generatedCode,
          tenantId, // dari session, BUKAN dari body — mencegah cross-tenant injection
        },
      });
    });

    return NextResponse.json(vendor, { status: 201 });
  } catch (error) {
    console.error("Error creating vendor:", error);
    return NextResponse.json(
      { error: "Failed to create vendor" },
      { status: 500 },
    );
  }
}
