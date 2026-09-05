import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { updateVendorSchema } from "@/lib/validations/vendor";
import { assertPermission, PermissionDeniedError } from "@/lib/hasPermission";

type RouteParams = { params: Promise<{ id: string }> };

// GET tidak diberi permission guard — read-only, konsisten dengan pola
// GET lain di project.
export async function GET(_: Request, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing vendor id" }, { status: 400 });
  }

  const vendor = await prisma.vendor.findFirst({
    where: {
      id,
      tenantId: session.user.tenantId,
      isDeleted: false,
    },
  });

  if (!vendor)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(vendor);
}

// BACKLOG REFACTOR: sebelumnya tidak ada permission guard sama sekali.
// Sekarang table-driven lewat hasPermission("vendor.manage").
export async function PUT(req: Request, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantId, role } = session.user;

  try {
    await assertPermission(tenantId, role, "vendor.manage");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json(
        { error: "Anda tidak berwenang mengubah vendor" },
        { status: 403 }
      );
    }
    throw err;
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing vendor id" }, { status: 400 });
  }

  try {
    const body = await req.json();

    const result = updateVendorSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: result.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const updateResult = await prisma.vendor.updateMany({
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

    const vendor = await prisma.vendor.findUnique({ where: { id } });

    return NextResponse.json(vendor);
  } catch (error) {
    console.error("Error updating vendor:", error);
    return NextResponse.json(
      { error: "Failed to update vendor" },
      { status: 500 },
    );
  }
}

// BACKLOG REFACTOR: sebelumnya tidak ada permission guard sama sekali.
// Sekarang table-driven lewat hasPermission("vendor.manage").
export async function DELETE(_: Request, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantId, role } = session.user;

  try {
    await assertPermission(tenantId, role, "vendor.manage");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json(
        { error: "Anda tidak berwenang menghapus vendor" },
        { status: 403 }
      );
    }
    throw err;
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing vendor id" }, { status: 400 });
  }

  try {
    const deleteResult = await prisma.vendor.updateMany({
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

    return NextResponse.json({ message: "Vendor deleted" });
  } catch (error) {
    console.error("Error deleting vendor:", error);
    return NextResponse.json(
      { error: "Failed to delete vendor" },
      { status: 500 },
    );
  }
}