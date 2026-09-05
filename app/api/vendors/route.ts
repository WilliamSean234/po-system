import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { createVendorSchema } from "@/lib/validations/vendor";
import { assertPermission, PermissionDeniedError } from "@/lib/hasPermission";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  const vendors = await prisma.vendor.findMany({
    where: {
      tenantId: session.user.tenantId,
      isDeleted: false,
    },
    orderBy: { code: "asc" },
  });

  return NextResponse.json(vendors);
}

// BACKLOG REFACTOR: endpoint ini SEBELUMNYA tidak punya permission guard
// sama sekali — role apapun bisa create vendor. Sekarang table-driven
// lewat hasPermission("vendor.manage"), default role purchasing (+ admin).
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tenantId, role } = session.user;

  try {
    await assertPermission(tenantId, role, "vendor.manage");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json(
        { error: "Anda tidak berwenang membuat vendor" },
        { status: 403 }
      );
    }
    throw err;
  }

  try {
    const body = await req.json();

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

    const vendor = await prisma.$transaction(async (tx) => {
      const vendorCount = await tx.vendor.count({
        where: { tenantId },
      });

      const nextNumber = vendorCount + 1;
      const generatedCode = `VND-${String(nextNumber).padStart(3, "0")}`;

      return tx.vendor.create({
        data: {
          ...result.data,
          code: generatedCode,
          tenantId,
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