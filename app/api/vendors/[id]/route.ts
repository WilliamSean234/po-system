import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

// Ambil satu vendor berdasarkan ID
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  const vendor = await prisma.vendor.findFirst({
    where: {
      id: params.id,
      tenantId: session.user.tenantId, // Pastikan vendor milik tenant ini
    },
  });

  if (!vendor)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(vendor);
}

// Update vendor
export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  const vendor = await prisma.vendor.update({
    where: {
      id: params.id,
      tenantId: session.user.tenantId, // Cegah update vendor tenant lain
    },
    data: body,
  });

  return NextResponse.json(vendor);
}

// Hapus vendor
export async function DELETE(
  _: Request,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.vendor.delete({
    where: {
      id: params.id,
      tenantId: session.user.tenantId, // Cegah hapus vendor tenant lain
    },
  });

  return NextResponse.json({ message: "Vendor deleted" });
}
