import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { updateItemSchema } from "@/lib/validations/item";
import { assertPermission, PermissionDeniedError } from "@/lib/hasPermission";

type RouteParams = { params: Promise<{ id: string }> };

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
      tenantId: session.user.tenantId,
      isDeleted: false,
    },
  });

  if (!item)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(item);
}

// BACKLOG REFACTOR: sebelumnya tidak ada permission guard sama sekali.
// Sekarang table-driven lewat hasPermission("item.manage").
export async function PUT(req: Request, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantId, role } = session.user;

  try {
    await assertPermission(tenantId, role, "item.manage");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json(
        { error: "Anda tidak berwenang mengubah item" },
        { status: 403 }
      );
    }
    throw err;
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing item id" }, { status: 400 });
  }

  try {
    const body = await req.json();

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

    const updateResult = await prisma.item.updateMany({
      where: {
        id,
        tenantId,
        isDeleted: false,
      },
      data: result.data,
    });

    if (updateResult.count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

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

// BACKLOG REFACTOR: sebelumnya tidak ada permission guard sama sekali.
// Sekarang table-driven lewat hasPermission("item.manage").
export async function DELETE(_: Request, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantId, role } = session.user;

  try {
    await assertPermission(tenantId, role, "item.manage");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json(
        { error: "Anda tidak berwenang menghapus item" },
        { status: 403 }
      );
    }
    throw err;
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing item id" }, { status: 400 });
  }

  try {
    const deleteResult = await prisma.item.updateMany({
      where: {
        id,
        tenantId,
        isDeleted: false,
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