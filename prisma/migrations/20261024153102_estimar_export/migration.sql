-- AlterTable
ALTER TABLE "Exportacion" ADD COLUMN "estimado" INTEGER;

-- CreateTable
CREATE TABLE "TasaExport" (
    "filtro" TEXT NOT NULL PRIMARY KEY,
    "bytes" REAL NOT NULL DEFAULT 0,
    "pixSeg" REAL NOT NULL DEFAULT 0,
    "n" INTEGER NOT NULL DEFAULT 0
);
