-- AlterTable
ALTER TABLE "Video" ADD COLUMN "reducir" INTEGER;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Exportacion" (
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
    "estimado" INTEGER,
    "reemplazar" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" DATETIME,
    "expiresAt" DATETIME,
    CONSTRAINT "Exportacion_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Exportacion" ("alto", "clave", "createdAt", "duracion", "error", "estimado", "expiresAt", "filtro", "id", "progreso", "readyAt", "size", "status", "videoId") SELECT "alto", "clave", "createdAt", "duracion", "error", "estimado", "expiresAt", "filtro", "id", "progreso", "readyAt", "size", "status", "videoId" FROM "Exportacion";
DROP TABLE "Exportacion";
ALTER TABLE "new_Exportacion" RENAME TO "Exportacion";
CREATE INDEX "Exportacion_videoId_idx" ON "Exportacion"("videoId");
CREATE INDEX "Exportacion_status_createdAt_idx" ON "Exportacion"("status", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
