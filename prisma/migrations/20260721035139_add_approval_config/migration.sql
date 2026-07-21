-- CreateTable
CREATE TABLE "ApprovalConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "minAmount" DECIMAL(15,2) NOT NULL,
    "maxAmount" DECIMAL(15,2) NOT NULL,
    "approverUserId" TEXT NOT NULL,

    CONSTRAINT "ApprovalConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalConfig_tenantId_idx" ON "ApprovalConfig"("tenantId");

-- AddForeignKey
ALTER TABLE "ApprovalConfig" ADD CONSTRAINT "ApprovalConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalConfig" ADD CONSTRAINT "ApprovalConfig_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
