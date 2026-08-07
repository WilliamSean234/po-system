/*
  Warnings:

  - You are about to drop the column `currentApprovalLevel` on the `PurchaseOrder` table. All the data in the column will be lost.
  - You are about to drop the `ApprovalConfig` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ApprovalConfig" DROP CONSTRAINT "ApprovalConfig_approverUserId_fkey";

-- DropForeignKey
ALTER TABLE "ApprovalConfig" DROP CONSTRAINT "ApprovalConfig_tenantId_fkey";

-- AlterTable
ALTER TABLE "PurchaseOrder" DROP COLUMN "currentApprovalLevel",
ADD COLUMN     "approvalStrategyId" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- DropTable
DROP TABLE "ApprovalConfig";

-- CreateTable
CREATE TABLE "ApprovalLevel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "ApprovalLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalLevelUser" (
    "id" TEXT NOT NULL,
    "approvalLevelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ApprovalLevelUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalStrategy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minAmount" DECIMAL(15,2) NOT NULL,
    "maxAmount" DECIMAL(15,2),
    "isSequential" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ApprovalStrategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalStrategyStep" (
    "id" TEXT NOT NULL,
    "approvalStrategyId" TEXT NOT NULL,
    "approvalLevelId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,

    CONSTRAINT "ApprovalStrategyStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalLog" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "approvalLevelId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "notes" TEXT,
    "actedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalLevel_tenantId_idx" ON "ApprovalLevel"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalLevelUser_approvalLevelId_userId_key" ON "ApprovalLevelUser"("approvalLevelId", "userId");

-- CreateIndex
CREATE INDEX "ApprovalStrategy_tenantId_idx" ON "ApprovalStrategy"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalStrategyStep_approvalStrategyId_approvalLevelId_key" ON "ApprovalStrategyStep"("approvalStrategyId", "approvalLevelId");

-- CreateIndex
CREATE INDEX "ApprovalLog_poId_idx" ON "ApprovalLog"("poId");

-- AddForeignKey
ALTER TABLE "ApprovalLevel" ADD CONSTRAINT "ApprovalLevel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalLevelUser" ADD CONSTRAINT "ApprovalLevelUser_approvalLevelId_fkey" FOREIGN KEY ("approvalLevelId") REFERENCES "ApprovalLevel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalLevelUser" ADD CONSTRAINT "ApprovalLevelUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStrategy" ADD CONSTRAINT "ApprovalStrategy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStrategyStep" ADD CONSTRAINT "ApprovalStrategyStep_approvalStrategyId_fkey" FOREIGN KEY ("approvalStrategyId") REFERENCES "ApprovalStrategy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStrategyStep" ADD CONSTRAINT "ApprovalStrategyStep_approvalLevelId_fkey" FOREIGN KEY ("approvalLevelId") REFERENCES "ApprovalLevel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalLog" ADD CONSTRAINT "ApprovalLog_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalLog" ADD CONSTRAINT "ApprovalLog_approvalLevelId_fkey" FOREIGN KEY ("approvalLevelId") REFERENCES "ApprovalLevel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalLog" ADD CONSTRAINT "ApprovalLog_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_approvalStrategyId_fkey" FOREIGN KEY ("approvalStrategyId") REFERENCES "ApprovalStrategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
