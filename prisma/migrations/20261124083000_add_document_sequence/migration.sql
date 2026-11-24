-- CreateTable
CREATE TABLE "DocumentSequence" (
    "tenantId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("tenantId","docType","period")
);

-- AddForeignKey
ALTER TABLE "DocumentSequence" ADD CONSTRAINT "DocumentSequence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: lanjutkan nomor dari dokumen yang SUDAH ada (nomor terbesar per
-- tenant + periode), supaya dokumen baru tidak bentrok dengan nomor lama.
-- Format nomor: <PREFIX>-<YYYYMM>-<urut>, mis. PO-202611-0007.
INSERT INTO "DocumentSequence" ("tenantId", "docType", "period", "lastValue")
SELECT "tenantId", 'PO', split_part("poNumber", '-', 2), MAX(split_part("poNumber", '-', 3)::int)
FROM "PurchaseOrder"
WHERE "poNumber" ~ '^PO-[0-9]{6}-[0-9]+$'
GROUP BY "tenantId", split_part("poNumber", '-', 2);

INSERT INTO "DocumentSequence" ("tenantId", "docType", "period", "lastValue")
SELECT "tenantId", 'GR', split_part("grNumber", '-', 2), MAX(split_part("grNumber", '-', 3)::int)
FROM "GoodsReceipt"
WHERE "grNumber" ~ '^GR-[0-9]{6}-[0-9]+$'
GROUP BY "tenantId", split_part("grNumber", '-', 2);

INSERT INTO "DocumentSequence" ("tenantId", "docType", "period", "lastValue")
SELECT "tenantId", 'INV', split_part("invoiceNumber", '-', 2), MAX(split_part("invoiceNumber", '-', 3)::int)
FROM "Invoice"
WHERE "invoiceNumber" ~ '^INV-[0-9]{6}-[0-9]+$'
GROUP BY "tenantId", split_part("invoiceNumber", '-', 2);

INSERT INTO "DocumentSequence" ("tenantId", "docType", "period", "lastValue")
SELECT "tenantId", 'TRF', split_part("transferNumber", '-', 2), MAX(split_part("transferNumber", '-', 3)::int)
FROM "StockTransfer"
WHERE "transferNumber" ~ '^TRF-[0-9]{6}-[0-9]+$'
GROUP BY "tenantId", split_part("transferNumber", '-', 2);
