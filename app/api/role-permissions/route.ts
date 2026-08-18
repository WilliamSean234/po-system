// app/api/role-permissions/route.ts
//
// W3T4 — GET & PUT mapping role -> permission, scoped per tenant.
// Hanya admin yang boleh akses — hardcode, BUKAN lewat hasPermission,
// konsisten dengan keputusan anti-lockout di W3T1/W3T3.

import { NextResponse } from "next/server";
import { auth } from "@/auth"; // sesuaikan kalau path NextAuth config-mu beda
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// Daftar role yang dikenal sistem. Dipakai buat validasi input PUT —
// mencegah orang assign permission ke role yang typo/tidak eksis.
const KNOWN_ROLES = ["purchasing", "warehouse", "finance"] as const;
// "admin" sengaja TIDAK dimasukkan — admin selalu full-access di hasPermission,
// assign/revoke permission ke "admin" lewat endpoint ini tidak ada efeknya
// sama sekali, jadi kita tolak dari awal biar tidak menyesatkan di UI.

const putSchema = z.object({
  role: z.enum(KNOWN_ROLES),
  permissionId: z.string().uuid(),
  granted: z.boolean(), // true = assign, false = revoke
});

export async function GET() {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "admin") {
    return NextResponse.json(
      { error: "Hanya admin yang boleh mengakses role-permission mapping" },
      { status: 403 }
    );
  }

  const rolePermissions = await prisma.rolePermission.findMany({
    where: { tenantId: session.user.tenantId },
    include: { permission: true }, // sertakan detail permission (key, description, category) biar UI tidak perlu join manual
  });

  return NextResponse.json(rolePermissions);
}

export async function PUT(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "admin") {
    return NextResponse.json(
      { error: "Hanya admin yang boleh mengubah role-permission mapping" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const parsed = putSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Input tidak valid", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { role, permissionId, granted } = parsed.data;
  const tenantId = session.user.tenantId;

  // Pastikan permissionId yang dikirim benar-benar ada di katalog —
  // mencegah orphan row kalau ada typo/id lama di client.
  const permission = await prisma.permission.findUnique({
    where: { id: permissionId },
  });

  if (!permission) {
    return NextResponse.json({ error: "Permission tidak ditemukan" }, { status: 404 });
  }

  if (granted) {
    // Assign — upsert supaya idempotent (klik toggle dua kali tidak error P2002).
    await prisma.rolePermission.upsert({
      where: {
        tenantId_role_permissionId: { tenantId, role, permissionId },
      },
      update: {},
      create: { tenantId, role, permissionId },
    });
  } else {
    // Revoke — deleteMany (bukan delete) supaya tidak error kalau baris
    // memang sudah tidak ada (misal race condition dua admin toggle bersamaan).
    await prisma.rolePermission.deleteMany({
      where: { tenantId, role, permissionId },
    });
  }

  return NextResponse.json({ role, permissionId, granted });
}