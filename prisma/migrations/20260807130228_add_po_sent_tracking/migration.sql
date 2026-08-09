-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "sentBy" TEXT;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_sentBy_fkey" FOREIGN KEY ("sentBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
