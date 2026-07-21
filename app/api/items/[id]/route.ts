import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { updateItemSchema } from "@/lib/validations/item";

// Next.js 16: params sekarang berupa Promise, bukan object biasa.
// Harus di-`await` dulu sebelum diakses. Lupa await = params.id jadi
// `undefined` diam-diam TANPA error, dan itu bisa bikin Prisma drop
// filter `id` dari where clause (bug yang pernah kejadian di vendor).
type RouteParams = { params: Promise<{ id: string }> };

// Ambil satu item berdasarkan ID
export async function GET(_: Request, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing item id" }, { status: 400 });
  }

  const item = await prisma.item.findFirst({
    where: {
      id,
      tenantId: session.user.tenantId, // Pastikan item milik tenant ini
      isDeleted: false,
    },
  });

  if (!item)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(item);
}

// Update item
export async function PUT(req: Request, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing item id" }, { status: 400 });
  }

  try {
    const body = await req.json();

    // Validasi pakai Zod — mencegah field liar (mis. tenantId, isDeleted)
    // ikut ke-spread ke Prisma update
    const result = updateItemSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: result.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    // updateMany dipakai (bukan update) supaya kita bisa cek affected count
    // tanpa Prisma throw error mentah kalau id/tenantId gak match.
    const updateResult = await prisma.item.updateMany({
      where: {
        id,
        tenantId: session.user.tenantId, // Cegah update item tenant lain
        isDeleted: false,
      },
      data: result.data, // sudah tervalidasi & typed, aman di-spread
    });

    if (updateResult.count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // updateMany gak return record-nya, jadi fetch ulang buat response
    const item = await prisma.item.findUnique({ where: { id } });

    return NextResponse.json(item);
  } catch (error) {
    console.error("Error updating item:", error);
    return NextResponse.json(
      { error: "Failed to update item" },
      { status: 500 },
    );
  }
}

// Soft delete item
export async function DELETE(_: Request, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing item id" }, { status: 400 });
  }

  try {
    const deleteResult = await prisma.item.updateMany({
      where: {
        id,
        tenantId: session.user.tenantId, // Cegah hapus item tenant lain
        isDeleted: false, // gak bisa "hapus" item yang udah dihapus
      },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });

    if (deleteResult.count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Item deleted" });
  } catch (error) {
    console.error("Error deleting item:", error);
    return NextResponse.json(
      { error: "Failed to delete item" },
      { status: 500 },
    );
  }
}