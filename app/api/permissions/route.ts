// app/api/permissions/route.ts
//
// W3T4 — GET katalog permission (global, sama untuk semua tenant).
// Dipakai UI admin (W3T6) buat render kolom-kolom di permission matrix.
// Hanya admin yang boleh akses — hardcode, BUKAN lewat hasPermission,
// konsisten dengan keputusan anti-lockout di W3T1/W3T3.

import { NextResponse } from "next/server";
import { auth } from "@/auth"; // sesuaikan kalau path NextAuth config-mu beda
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "admin") {
    return NextResponse.json(
      { error: "Hanya admin yang boleh mengakses katalog permission" },
      { status: 403 }
    );
  }

  // Katalog global — tidak difilter tenantId, karena Permission bukan model per-tenant.
  const permissions = await prisma.permission.findMany({
    orderBy: [{ category: "asc" }, { key: "asc" }], // grouping rapi buat UI
  });

  return NextResponse.json(permissions);
}