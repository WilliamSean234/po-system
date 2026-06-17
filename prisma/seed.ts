// prisma/seed.ts
import { PrismaClient } from "../lib/generated/prisma"
import bcrypt from "bcryptjs"

const prisma = new PrismaClient()

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
  })
  console.log("✅ Tenant:", tenant.name)

  // ── 2. USERS ───────────────────────────────────────────────
  const hashedPassword = await bcrypt.hash("password123", 10)

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
  ])
  console.log("✅ Users:", users.map((u) => u.email).join(", "))

  // ── 3. VENDORS ─────────────────────────────────────────────
  const vendors = await Promise.all([
    prisma.vendor.upsert({
      where: { id: "vendor-001" },
      update: {},
      create: {
        id: "vendor-001",
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
      where: { id: "vendor-002" },
      update: {},
      create: {
        id: "vendor-002",
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
      where: { id: "vendor-003" },
      update: {},
      create: {
        id: "vendor-003",
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
  ])
  console.log("✅ Vendors:", vendors.map((v) => v.name).join(", "))

  // ── 4. ITEMS ───────────────────────────────────────────────
  const items = await Promise.all([
    prisma.item.upsert({
      where: { id: "item-001" },
      update: {},
      create: {
        id: "item-001",
        tenantId: tenant.id,
        code: "ITM-001",
        name: "Kertas HVS A4 80gsm",
        description: "Kertas fotokopi ukuran A4, berat 80gsm",
        uom: "RIM",
        category: "Alat Tulis Kantor",
      },
    }),
    prisma.item.upsert({
      where: { id: "item-002" },
      update: {},
      create: {
        id: "item-002",
        tenantId: tenant.id,
        code: "ITM-002",
        name: "Tinta Printer Hitam",
        description: "Tinta printer warna hitam compatible semua merk",
        uom: "BOTOL",
        category: "Alat Tulis Kantor",
      },
    }),
    prisma.item.upsert({
      where: { id: "item-003" },
      update: {},
      create: {
        id: "item-003",
        tenantId: tenant.id,
        code: "ITM-003",
        name: "Meja Kantor",
        description: "Meja kantor minimalis ukuran 120x60cm",
        uom: "PCS",
        category: "Furnitur",
      },
    }),
    prisma.item.upsert({
      where: { id: "item-004" },
      update: {},
      create: {
        id: "item-004",
        tenantId: tenant.id,
        code: "ITM-004",
        name: "Laptop Core i5",
        description: "Laptop untuk kebutuhan operasional kantor",
        uom: "UNIT",
        category: "Elektronik",
      },
    }),
  ])
  console.log("✅ Items:", items.map((i) => i.name).join(", "))

  console.log("\n🎉 Seed selesai!")
  console.log("─────────────────────────────")
  console.log("Login dengan:")
  console.log("  Email    : admin@demo.com")
  console.log("  Password : password123")
  console.log("─────────────────────────────")
}

main()
  .catch((e) => {
    console.error("❌ Seed gagal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())