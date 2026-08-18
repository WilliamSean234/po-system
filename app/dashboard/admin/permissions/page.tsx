// app/(dashboard)/admin/permissions/page.tsx
//
// W3T6 — Halaman admin: permission matrix.
// Role sebagai kolom, permission sebagai baris (dikelompokkan per category).
// Admin TIDAK ditampilkan sebagai kolom karena selalu full-access (lihat
// hasPermission.ts) — toggle di sini tidak akan berpengaruh ke admin sama
// sekali, jadi ditampilkan pun menyesatkan.
//
// Akses halaman ini sendiri dijaga di layout/middleware admin yang sudah
// ada (redirect non-admin) — halaman ini TIDAK mengulang cek auth di
// client, murni render + panggil API yang sudah punya guard admin sendiri
// (403 kalau ternyata diakses tanpa hak, misal session basi).

"use client";

import { useEffect, useState, useCallback } from "react";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner"; // sesuaikan kalau toast library-mu beda (misal shadcn "use-toast")

// Role yang ditampilkan sebagai kolom — HARUS sinkron dengan KNOWN_ROLES
// di app/api/role-permissions/route.ts. Admin sengaja tidak dimasukkan.
const DISPLAY_ROLES = ["purchasing", "warehouse", "finance"] as const;
type DisplayRole = (typeof DISPLAY_ROLES)[number];

const ROLE_LABELS: Record<DisplayRole, string> = {
  purchasing: "Purchasing",
  warehouse: "Warehouse",
  finance: "Finance",
};

const CATEGORY_LABELS: Record<string, string> = {
  purchase_order: "Purchase order",
  goods_receipt: "Goods receipt",
  invoice: "Invoice",
  master_data: "Master data",
};

type Permission = {
  id: string;
  key: string;
  description: string;
  category: string;
};

type RolePermission = {
  id: string;
  role: string;
  permissionId: string;
};

export default function PermissionMatrixPage() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [granted, setGranted] = useState<Set<string>>(new Set()); // key: `${role}:${permissionId}`
  const [loading, setLoading] = useState(true);
  const [pendingCells, setPendingCells] = useState<Set<string>>(new Set()); // cell yang sedang proses PUT

  const cellKey = (role: string, permissionId: string) => `${role}:${permissionId}`;

  // ── Initial fetch ──────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const [permsRes, rolePermsRes] = await Promise.all([
          fetch("/api/permissions"),
          fetch("/api/role-permissions"),
        ]);

        if (!permsRes.ok || !rolePermsRes.ok) {
          throw new Error("Gagal memuat data permission");
        }

        const perms: Permission[] = await permsRes.json();
        const rolePerms: RolePermission[] = await rolePermsRes.json();

        setPermissions(perms);
        setGranted(new Set(rolePerms.map((rp) => cellKey(rp.role, rp.permissionId))));
      } catch (err) {
        console.error(err);
        toast.error("Gagal memuat permission matrix. Coba refresh halaman.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // ── Toggle handler — optimistic update + rollback ─────────
  const handleToggle = useCallback(
    async (role: DisplayRole, permission: Permission, nextChecked: boolean) => {
      const key = cellKey(role, permission.id);

      // Optimistic update dulu, biar switch langsung responsif
      setGranted((prev) => {
        const next = new Set(prev);
        if (nextChecked) next.add(key);
        else next.delete(key);
        return next;
      });
      setPendingCells((prev) => new Set(prev).add(key));

      try {
        const res = await fetch("/api/role-permissions", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role,
            permissionId: permission.id,
            granted: nextChecked,
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Gagal menyimpan perubahan");
        }
      } catch (err) {
        // Rollback ke state sebelumnya kalau request gagal
        setGranted((prev) => {
          const next = new Set(prev);
          if (nextChecked) next.delete(key);
          else next.add(key);
          return next;
        });
        toast.error(
          err instanceof Error ? err.message : "Gagal menyimpan perubahan permission"
        );
      } finally {
        setPendingCells((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    []
  );

  if (loading) {
    return (
      <div className="max-w-3xl space-y-3">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Group permissions by category, urut sesuai urutan CATEGORY_LABELS
  // supaya konsisten tiap render (bukan urutan random dari Set/Object).
  const categories = Object.keys(CATEGORY_LABELS).filter((cat) =>
    permissions.some((p) => p.category === cat)
  );

  return (
    <div className="max-w-3xl">
      <div className="mb-5">
        <h1 className="text-base font-medium">Permission matrix</h1>
        <p className="text-sm text-muted-foreground">
          Atur permission per role untuk tenant ini. Admin selalu punya akses penuh.
        </p>
      </div>

      <div className="rounded-xl border overflow-hidden">
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="bg-muted/50">
              <th className="text-left text-sm font-medium text-muted-foreground p-3 w-[44%]">
                Permission
              </th>
              {DISPLAY_ROLES.map((role) => (
                <th key={role} className="text-center text-sm font-medium text-muted-foreground p-2">
                  {ROLE_LABELS[role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <CategoryGroup
                key={category}
                categoryLabel={CATEGORY_LABELS[category]}
                permissions={permissions.filter((p) => p.category === category)}
                granted={granted}
                pendingCells={pendingCells}
                onToggle={handleToggle}
                cellKey={cellKey}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground mt-2">
        Role admin tidak ditampilkan — selalu memiliki akses penuh ke semua permission.
      </p>
    </div>
  );
}

// Sub-komponen kecil biar render function utama tidak terlalu panjang.
// Tidak dipecah ke file terpisah karena hanya dipakai di sini.
function CategoryGroup({
  categoryLabel,
  permissions,
  granted,
  pendingCells,
  onToggle,
  cellKey,
}: {
  categoryLabel: string;
  permissions: Permission[];
  granted: Set<string>;
  pendingCells: Set<string>;
  onToggle: (role: DisplayRole, permission: Permission, next: boolean) => void;
  cellKey: (role: string, permissionId: string) => string;
}) {
  return (
    <>
      <tr className="bg-muted/30">
        <td colSpan={DISPLAY_ROLES.length + 1} className="text-xs font-medium text-muted-foreground px-3 py-1.5">
          {categoryLabel}
        </td>
      </tr>
      {permissions.map((permission) => (
        <tr key={permission.id} className="border-t">
          <td className="p-3 text-sm">{permission.description}</td>
          {DISPLAY_ROLES.map((role) => {
            const key = cellKey(role, permission.id);
            const isChecked = granted.has(key);
            const isPending = pendingCells.has(key);
            return (
              <td key={role} className="text-center p-2">
                <Switch
                  checked={isChecked}
                  disabled={isPending}
                  onCheckedChange={(next) => onToggle(role, permission, next)}
                  aria-label={`${permission.description} - ${ROLE_LABELS[role]}`}
                />
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}