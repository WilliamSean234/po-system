// untuk GET semua vendor dan POST vendor baru:

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  // Cek apakah user sudah login
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  // Ambil semua vendor milik tenant yang sedang login
  const vendors = await prisma.vendor.findMany({
    where: { tenantId: session.user.tenantId },
    orderBy: { code: "asc" },
  });

  return NextResponse.json(vendors);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  const vendor = await prisma.vendor.create({
    data: {
      ...body,
      tenantId: session.user.tenantId, // Otomatis pakai tenantId dari session
    },
  });

  return NextResponse.json(vendor, { status: 201 });
}
