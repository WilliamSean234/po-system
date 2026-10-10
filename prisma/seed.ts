// prisma/seed.ts
import { PrismaClient } from "../lib/generated/prisma";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ============================================================
// W3T2 — RBAC: Permission catalog & default role mapping
// ============================================================
// Katalog permission GLOBAL. Key ini dipakai di kode (hasPermission helper),
// BUKAN di UI — description yang ditampilkan ke user di admin UI.
// Nambah permission baru kedepannya = tambah entry di array ini, jalankan
// seed lagi (upsert by key, aman dijalankan berulang).
const PERMISSION_CATALOG = [
  // purchase_order
  { key: "po.create", category: "purchase_order", description: "Membuat Purchase Order baru" },
  { key: "po.submit", category: "purchase_order", description: "Submit PO untuk approval" },
  { key: "po.send", category: "purchase_order", description: "Kirim PO ke vendor (APPROVED → PO_SENT)" },
  { key: "po.close", category: "purchase_order", description: "Menutup PO yang sudah diterima penuh (RECEIVED → CLOSED)" },
  { key: "po.cancel", category: "purchase_order", description: "Cancel Purchase Order" },
  // goods_receipt
  { key: "gr.create", category: "goods_receipt", description: "Input Goods Receipt" },
  // inventory (W5T3)
  { key: "inventory.transfer", category: "inventory", description: "Buat Stock Transfer antar warehouse" },
  // invoice
  { key: "invoice.create", category: "invoice", description: "Input invoice (status DRAFT)" },
  { key: "invoice.submit", category: "invoice", description: "Submit invoice untuk matching" },
  { key: "invoice.resolve_dispute", category: "invoice", description: "Resolve status DISPUTED menjadi MATCHED" },
  { key: "invoice.mark_paid", category: "invoice", description: "Tandai invoice sebagai PAID" },
  { key: "invoice.cancel", category: "invoice", description: "Cancel invoice" },
  // master_data
  { key: "vendor.manage", category: "master_data", description: "Tambah/ubah/hapus data Vendor" },
  { key: "item.manage", category: "master_data", description: "Tambah/ubah/hapus data Item" },
] as const;

// Default mapping role -> permission key, di-assign ke tenant baru saat seeding.
// Ini HANYA default awal — bisa diubah tenant lewat admin UI (W3T6) tanpa
// menyentuh kode ini lagi. "admin" sengaja tidak didaftarkan eksplisit di sini
// karena admin selalu full-access secara hardcode di hasPermission helper (W3T3),
// bukan lewat baris RolePermission — konsisten dengan alasan anti-lockout.
const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  purchasing: ["po.create", "po.submit", "po.send", "po.close", "po.cancel", "vendor.manage", "item.manage"],
  warehouse: ["gr.create", "inventory.transfer"],
  finance: ["invoice.create", "invoice.submit", "invoice.resolve_dispute", "invoice.mark_paid", "invoice.cancel"],
};

// ============================================================
// W5 — Inventory Management: Batch seed data per item
// ============================================================
// Mapping item.code -> data batch dummy. expiryDate sengaja hanya diisi
// untuk item consumable (Tinta Printer) — membuktikan field ini memang
// OPTIONAL di model Batch, bukan wajib untuk semua item (jasa, alat
// non-consumable seperti Meja/Laptop tidak butuh tanggal kadaluarsa).
const BATCH_SEED_DATA: Record<string, { batchNumber: string; expiryDate: Date | null }> = {
  "ITM-001": { batchNumber: "BATCH-2026-001", expiryDate: null }, // Kertas HVS — non-perishable
  "ITM-002": { batchNumber: "BATCH-2026-002", expiryDate: new Date("2027-06-30") }, // Tinta Printer — ada expiry
  "ITM-003": { batchNumber: "BATCH-2026-003", expiryDate: null }, // Meja Kantor — non-perishable
  "ITM-004": { batchNumber: "BATCH-2026-004", expiryDate: null }, // Laptop — non-perishable
};

async function main() {
  // ── 1. TENANT ──────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { slug: "demo-company" },
    update: {},
    create: {
      name: "Demo Company",
      slug: "demo-company",
      plan: "free",
    },
  });
  console.log("✅ Tenant:", tenant.name);

  // ── 2. USERS ───────────────────────────────────────────────
  const hashedPassword = await bcrypt.hash("password123", 10);

  const users = await Promise.all([
    prisma.user.upsert({
      where: { email: "admin@demo.com" },
      update: {},
      create: {
        tenantId: tenant.id,
        name: "Admin User",
        email: "admin@demo.com",
        password: hashedPassword,
        role: "admin",
      },
    }),
    prisma.user.upsert({
      where: { email: "purchasing@demo.com" },
      update: {},
      create: {
        tenantId: tenant.id,
        name: "Purchasing User",
        email: "purchasing@demo.com",
        password: hashedPassword,
        role: "purchasing",
      },
    }),
    prisma.user.upsert({
      where: { email: "warehouse@demo.com" },
      update: {},
      create: {
        tenantId: tenant.id,
        name: "Warehouse User",
        email: "warehouse@demo.com",
        password: hashedPassword,
        role: "warehouse",
      },
    }),
    prisma.user.upsert({
      where: { email: "finance@demo.com" },
      update: {},
      create: {
        tenantId: tenant.id,
        name: "Finance User",
        email: "finance@demo.com",
        password: hashedPassword,
        role: "finance",
      },
    }),
  ]);
  console.log("✅ Users:", users.map((u) => u.email).join(", "));

  // ── 3. VENDORS ─────────────────────────────────────────────
  const vendors = await Promise.all([
    prisma.vendor.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: "VND-001" } },
      update: {},
      create: {
        tenantId: tenant.id,
        code: "VND-001",
        name: "PT Sumber Makmur",
        contactName: "Budi Santoso",
        phone: "021-55512345",
        email: "budi@sumbermakmur.com",
        address: "Jl. Industri No. 10, Jakarta",
        paymentTerms: "NET30",
      },
    }),
    prisma.vendor.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: "VND-002" } },
      update: {},
      create: {
        tenantId: tenant.id,
        code: "VND-002",
        name: "CV Jaya Abadi",
        contactName: "Siti Rahayu",
        phone: "031-77789012",
        email: "siti@jayaabadi.com",
        address: "Jl. Raya Darmo No. 45, Surabaya",
        paymentTerms: "NET14",
      },
    }),
    prisma.vendor.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: "VND-003" } },
      update: {},
      create: {
        tenantId: tenant.id,
        code: "VND-003",
        name: "Toko Teknik Maju",
        contactName: "Agus Wijaya",
        phone: "024-33345678",
        email: "agus@teknikmaju.com",
        address: "Jl. Pemuda No. 22, Semarang",
        paymentTerms: "COD",
      },
    }),
  ]);
  console.log("✅ Vendors:", vendors.map((v) => v.name).join(", "));

  // ── 4. ITEMS ───────────────────────────────────────────────
  const items = await Promise.all([
    prisma.item.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: "ITM-001" } },
      update: {},
      create: {
        tenantId: tenant.id,
        code: "ITM-001",
        name: "Kertas HVS A4 80gsm",
        description: "Kertas fotokopi ukuran A4, berat 80gsm",
        uom: "RIM",
        category: "Alat Tulis Kantor",
      },
    }),
    prisma.item.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: "ITM-002" } },
      update: {},
      create: {
        tenantId: tenant.id,
        code: "ITM-002",
        name: "Tinta Printer Hitam",
        description: "Tinta printer warna hitam compatible semua merk",
        uom: "BOTOL",
        category: "Alat Tulis Kantor",
      },
    }),
    prisma.item.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: "ITM-003" } },
      update: {},
      create: {
        tenantId: tenant.id,
        code: "ITM-003",
        name: "Meja Kantor",
        description: "Meja kantor minimalis ukuran 120x60cm",
        uom: "PCS",
        category: "Furnitur",
      },
    }),
    prisma.item.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: "ITM-004" } },
      update: {},
      create: {
        tenantId: tenant.id,
        code: "ITM-004",
        name: "Laptop Core i5",
        description: "Laptop untuk kebutuhan operasional kantor",
        uom: "UNIT",
        category: "Elektronik",
      },
    }),
  ]);
  console.log("✅ Items:", items.map((i) => i.name).join(", "));

  // ── 5. APPROVAL LEVELS (SAP Release Strategy pattern) ─────
  // ApprovalLevel TIDAK punya @@unique(tenantId, name) di schema.prisma —
  // jadi upsert manual: findFirst dulu, create kalau belum ada. Aman
  // dijalankan berulang (idempotent), tidak akan bikin duplikat.
  async function findOrCreateApprovalLevel(name: string) {
    const existing = await prisma.approvalLevel.findFirst({
      where: { tenantId: tenant.id, name },
    });
    if (existing) return existing;
    return prisma.approvalLevel.create({
      data: { tenantId: tenant.id, name },
    });
  }

  const supervisorLevel = await findOrCreateApprovalLevel("Supervisor");
  const managerLevel = await findOrCreateApprovalLevel("Manager");

  // Assign approver per level (M:N — 1 level bisa punya lebih dari 1 approver).
  // Supervisor -> Finance User, Manager -> Admin User. SENGAJA BUKAN
  // Purchasing User (pembuat PO) supaya tidak ada skenario self-approval
  // di data demo ini.
  const financeUser = users.find((u) => u.email === "finance@demo.com")!;
  const adminUser = users.find((u) => u.email === "admin@demo.com")!;

  await Promise.all([
    prisma.approvalLevelUser.upsert({
      where: {
        approvalLevelId_userId: {
          approvalLevelId: supervisorLevel.id,
          userId: financeUser.id,
        },
      },
      update: {},
      create: {
        approvalLevelId: supervisorLevel.id,
        userId: financeUser.id,
      },
    }),
    prisma.approvalLevelUser.upsert({
      where: {
        approvalLevelId_userId: {
          approvalLevelId: managerLevel.id,
          userId: adminUser.id,
        },
      },
      update: {},
      create: {
        approvalLevelId: managerLevel.id,
        userId: adminUser.id,
      },
    }),
  ]);
  console.log("✅ Approval Levels: Supervisor (approver: Finance), Manager (approver: Admin)");

  // ── 6. APPROVAL STRATEGIES (range nominal -> strategi approval) ──
  // Menggantikan ApprovalConfig lama (W1T8). Range HARUS kontigu tanpa
  // celah — Low Value berakhir di Rp5.000.000, High Value mulai dari
  // Rp5.000.001 — supaya tidak ada nominal PO yang gagal cocok ke
  // strategi manapun saat submit. ApprovalStrategy juga tidak punya
  // @@unique(tenantId, name), jadi pola findFirst+create yang sama dipakai.
  async function findOrCreateApprovalStrategy(params: {
    name: string;
    minAmount: number;
    maxAmount: number | null;
    isSequential: boolean;
  }) {
    const existing = await prisma.approvalStrategy.findFirst({
      where: { tenantId: tenant.id, name: params.name },
    });
    if (existing) return existing;
    return prisma.approvalStrategy.create({
      data: {
        tenantId: tenant.id,
        name: params.name,
        minAmount: params.minAmount,
        maxAmount: params.maxAmount,
        isSequential: params.isSequential,
      },
    });
  }

  const lowValueStrategy = await findOrCreateApprovalStrategy({
    name: "Low Value Purchase",
    minAmount: 0,
    maxAmount: 5_000_000,
    isSequential: false, // 1 level saja, urutan tidak relevan
  });

  const highValueStrategy = await findOrCreateApprovalStrategy({
    name: "High Value Purchase",
    minAmount: 5_000_001,
    maxAmount: null, // tak terbatas — HANYA BOLEH ADA 1 strategy per tenant dengan maxAmount null
    isSequential: true, // Supervisor harus approve dulu, baru Manager
  });

  await Promise.all([
    prisma.approvalStrategyStep.upsert({
      where: {
        approvalStrategyId_approvalLevelId: {
          approvalStrategyId: lowValueStrategy.id,
          approvalLevelId: supervisorLevel.id,
        },
      },
      update: {},
      create: {
        approvalStrategyId: lowValueStrategy.id,
        approvalLevelId: supervisorLevel.id,
        sequence: 1,
      },
    }),
    prisma.approvalStrategyStep.upsert({
      where: {
        approvalStrategyId_approvalLevelId: {
          approvalStrategyId: highValueStrategy.id,
          approvalLevelId: supervisorLevel.id,
        },
      },
      update: {},
      create: {
        approvalStrategyId: highValueStrategy.id,
        approvalLevelId: supervisorLevel.id,
        sequence: 1,
      },
    }),
    prisma.approvalStrategyStep.upsert({
      where: {
        approvalStrategyId_approvalLevelId: {
          approvalStrategyId: highValueStrategy.id,
          approvalLevelId: managerLevel.id,
        },
      },
      update: {},
      create: {
        approvalStrategyId: highValueStrategy.id,
        approvalLevelId: managerLevel.id,
        sequence: 2,
      },
    }),
  ]);
  console.log(
    "✅ Approval Strategies: Low Value Purchase (Rp0–Rp5.000.000, non-sequential, Supervisor), High Value Purchase (Rp5.000.001+, sequential, Supervisor→Manager)"
  );

  // ── 7. WAREHOUSES (W5 — Inventory Management) ─────────────
  // Dummy 2 warehouse supaya fitur Stock Transfer (antar warehouse) langsung
  // bisa ditest begitu modulnya jadi — tidak perlu tambah data manual lagi.
  const warehouses = await Promise.all([
    prisma.warehouse.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: "WH-001" } },
      update: {},
      create: {
        tenantId: tenant.id,
        code: "WH-001",
        name: "Gudang Utama",
        address: "Jl. Industri No. 10, Jakarta",
      },
    }),
    prisma.warehouse.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: "WH-002" } },
      update: {},
      create: {
        tenantId: tenant.id,
        code: "WH-002",
        name: "Gudang Cabang Surabaya",
        address: "Jl. Raya Darmo No. 45, Surabaya",
      },
    }),
  ]);
  console.log("✅ Warehouses:", warehouses.map((w) => w.name).join(", "));

  // ── 8. BATCHES (W5 — Inventory Management) ────────────────
  // 1 batch dummy per item, supaya GRLine.batchId (sekarang WAJIB, ganti dari
  // batchNumber+expiryDate string bebas) langsung punya data valid untuk
  // dipakai saat testing create GR lewat Postman. Lookup pakai item.code,
  // jadi aman meski urutan array `items` di atas berubah nanti.
  const batches = await Promise.all(
    items.map((item) => {
      const seedInfo = BATCH_SEED_DATA[item.code];
      return prisma.batch.upsert({
        where: {
          tenantId_itemId_batchNumber: {
            tenantId: tenant.id,
            itemId: item.id,
            batchNumber: seedInfo.batchNumber,
          },
        },
        update: {},
        create: {
          tenantId: tenant.id,
          itemId: item.id,
          batchNumber: seedInfo.batchNumber,
          expiryDate: seedInfo.expiryDate,
        },
      });
    })
  );
  console.log("✅ Batches:", batches.map((b) => b.batchNumber).join(", "));

  // ── 9. PERMISSIONS (W3T2) ────────────────────────────────
  // Upsert seluruh katalog permission by key — aman dijalankan berulang,
  // dan aman ditambah entry baru kapan pun tanpa migration.
  const permissions = await Promise.all(
    PERMISSION_CATALOG.map((p) =>
      prisma.permission.upsert({
        where: { key: p.key },
        update: { description: p.description, category: p.category }, // biar description bisa di-update lewat seed juga
        create: p,
      })
    )
  );
  console.log("✅ Permissions:", permissions.map((p) => p.key).join(", "));

  // Map key -> id, dipakai buat assign RolePermission di bawah
  const permissionIdByKey = new Map(permissions.map((p) => [p.key, p.id]));

  // ── 10. ROLE PERMISSIONS (W3T2) ───────────────────────────
  // Assign default mapping role -> permission untuk tenant demo ini.
  // Di production, blok ini idealnya dipanggil ulang tiap kali tenant baru
  // dibuat (saat onboarding), bukan cuma sekali di seed — dicatat di
  // on-the-horizon sebagai bagian dari "tenant self-signup" nanti.
  const rolePermissionEntries = Object.entries(DEFAULT_ROLE_PERMISSIONS).flatMap(
    ([role, keys]) => keys.map((key) => ({ role, key }))
  );

  await Promise.all(
    rolePermissionEntries.map(({ role, key }) => {
      const permissionId = permissionIdByKey.get(key);
      if (!permissionId) {
        // Guard: kalau ada typo key di DEFAULT_ROLE_PERMISSIONS yang tidak
        // match PERMISSION_CATALOG, gagal jelas saat seed daripada silent skip.
        throw new Error(`Permission key "${key}" di DEFAULT_ROLE_PERMISSIONS tidak ada di PERMISSION_CATALOG`);
      }
      return prisma.rolePermission.upsert({
        where: {
          tenantId_role_permissionId: {
            tenantId: tenant.id,
            role,
            permissionId,
          },
        },
        update: {},
        create: {
          tenantId: tenant.id,
          role,
          permissionId,
        },
      });
    })
  );
  console.log(
    "✅ Role Permissions:",
    rolePermissionEntries.map(({ role, key }) => `${role}→${key}`).join(", ")
  );

  console.log("\n🎉 Seed selesai!");
  console.log("─────────────────────────────");
  console.log("Login dengan:");
  console.log("  Email    : admin@demo.com");
  console.log("  Password : password123");
  console.log("─────────────────────────────");
  console.log(
    `Warehouses: ${warehouses.length} | Batches: ${batches.length} | Approval Levels: 2 | Approval Strategies: 2`
  );
  console.log("─────────────────────────────");
}

main()
  .catch((e) => {
    console.error("❌ Seed gagal:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());