-- DropForeignKey
ALTER TABLE "MaterialCategory" DROP CONSTRAINT "MaterialCategory_parentId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierMaterialCategory" DROP CONSTRAINT "SupplierMaterialCategory_categoryId_fkey";

-- AddForeignKey
ALTER TABLE "MaterialCategory" ADD CONSTRAINT "MaterialCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MaterialCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierMaterialCategory" ADD CONSTRAINT "SupplierMaterialCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MaterialCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
