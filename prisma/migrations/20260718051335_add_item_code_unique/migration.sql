/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,code]` on the table `Item` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Item_tenantId_code_key" ON "Item"("tenantId", "code");
