import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { createItemSchema } from "@/lib/validations/item";
import { assertPermission, PermissionDeniedError } from "@/lib/hasPermission";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const items = await prisma.item.findMany({
    where: {
      tenantId: session.user.tenantId,
      isDeleted: false,
    },
    orderBy: { code: "asc" },
  });

  return NextResponse.json(items);
}

// BACKLOG REFACTOR: sebelumnya tidak ada permission guard sama sekali.
// Sekarang table-driven lewat hasPermission("item.manage"), default
// role purchasing (+ admin).
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tenantId, role } = session.user;

  try {
    await assertPermission(tenantId, role, "item.manage");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return NextResponse.json(
        { error: "Anda tidak berwenang membuat item" },
        { status: 403 }
      );
    }
    throw err;
  }

  try {
    const body = await req.json();

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

    const item = await prisma.$transaction(async (tx) => {
      const itemCount = await tx.item.count({
        where: { tenantId },
      });

      const nextNumber = itemCount + 1;
      const generatedCode = `ITM-${String(nextNumber).padStart(3, "0")}`;

      return tx.item.create({
        data: {
          ...result.data,
          code: generatedCode,
          tenantId,
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