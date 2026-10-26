-- AlterTable
ALTER TABLE "Exportacion" ADD COLUMN "mbps" REAL;

-- AlterTable
ALTER TABLE "Video" ADD COLUMN "anterior" TEXT;
ALTER TABLE "Video" ADD COLUMN "borradoAt" DATETIME;
