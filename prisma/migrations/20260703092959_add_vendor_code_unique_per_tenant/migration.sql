/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,code]` on the table `Vendor` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Vendor_tenantId_code_key" ON "Vendor"("tenantId", "code");
