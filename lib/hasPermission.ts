// lib/hasPermission.ts
//
// W3T3 — Helper otorisasi berbasis permission (RBAC).
// Menggantikan pola hardcode "if (role !== 'admin' && role !== 'purchasing') ..."
// yang tersebar di route API. Semua endpoint yang butuh authorization check
// harus lewat sini, bukan bikin kondisi role sendiri-sendiri.

import { prisma } from "./prisma";

// Union type semua permission key yang valid — harus SELALU sinkron dengan
// PERMISSION_CATALOG di prisma/seed.ts. Kalau nambah permission baru,
// update dua tempat ini (seed.ts buat data, sini buat type safety).
export type PermissionKey =
  | "po.create"
  | "po.submit"
  | "po.send"
  | "po.cancel"
  | "gr.create"
  | "invoice.create"
  | "invoice.submit"
  | "invoice.resolve_dispute"
  | "invoice.mark_paid"
  | "invoice.cancel"
  | "vendor.manage"
  | "item.manage";

/**
 * Cek apakah suatu role di suatu tenant punya permission tertentu.
 *
 * PENTING: role "admin" SELALU return true, tanpa cek tabel RolePermission
 * sama sekali. Ini disengaja (anti-lockout) — akses admin tidak boleh
 * bergantung pada data yang bisa diubah lewat RBAC management itu sendiri.
 * Jangan hapus early-return ini meskipun terlihat seperti "shortcut" yang
 * bisa disatukan dengan query di bawah.
 *
 * @param tenantId - tenant scope, WAJIB selalu diisi dari session, jangan dari body/query
 * @param role     - role user yang sedang login, dari session.user.role
 * @param permissionKey - permission yang mau dicek, contoh: "invoice.resolve_dispute"
 */
export async function hasPermission(
  tenantId: string,
  role: string,
  permissionKey: PermissionKey
): Promise<boolean> {
  // Admin selalu full-access, tidak lewat tabel RolePermission.
  if (role === "admin") return true;

  // Cek apakah ada baris RolePermission yang match tenant + role + permission key.
  // findFirst cukup (bukan findMany) karena @@unique([tenantId, role, permissionId])
  // di schema menjamin maksimal 1 baris yang match.
  const match = await prisma.rolePermission.findFirst({
    where: {
      tenantId,
      role,
      permission: { key: permissionKey },
    },
  });

  return match !== null;
}

/**
 * Varian yang langsung throw kalau tidak diizinkan — dipakai di route API
 * supaya kode di endpoint tetap ringkas (tidak perlu if/return manual tiap
 * kali). Lempar Error biasa; route yang manggil ini WAJIB bungkus dengan
 * try/catch dan translate ke NextResponse 403 (lihat contoh di W3T5).
 */
export async function assertPermission(
  tenantId: string,
  role: string,
  permissionKey: PermissionKey
): Promise<void> {
  const allowed = await hasPermission(tenantId, role, permissionKey);
  if (!allowed) {
    throw new PermissionDeniedError(permissionKey);
  }
}

// Custom error class biar route API bisa bedakan "forbidden" dari error lain
// (misal Prisma error) lewat instanceof check, bukan parsing message string.
export class PermissionDeniedError extends Error {
  constructor(public readonly permissionKey: PermissionKey) {
    super(`Permission denied: ${permissionKey}`);
    this.name = "PermissionDeniedError";
  }
}