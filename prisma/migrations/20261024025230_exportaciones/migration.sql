/*
  Warnings:

  - You are about to drop the `Ligera` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Ligera";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Exportacion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "videoId" TEXT NOT NULL,
    "alto" INTEGER,
    "filtro" TEXT,
    "status" TEXT NOT NULL DEFAULT 'en_cola',
    "error" TEXT,
    "clave" TEXT,
    "duracion" REAL,
    "progreso" INTEGER NOT NULL DEFAULT 0,
    "size" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" DATETIME,
    "expiresAt" DATETIME,
    CONSTRAINT "Exportacion_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Exportacion_videoId_idx" ON "Exportacion"("videoId");

-- CreateIndex
CREATE INDEX "Exportacion_status_createdAt_idx" ON "Exportacion"("status", "createdAt");
