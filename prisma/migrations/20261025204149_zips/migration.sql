-- CreateTable
CREATE TABLE "Zip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" TEXT NOT NULL,
    "claveSellada" TEXT NOT NULL,
    "fotos" INTEGER,
    "videos" INTEGER,
    "total" INTEGER NOT NULL DEFAULT 0,
    "hechos" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'en_cola',
    "error" TEXT,
    "size" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" DATETIME,
    "expiresAt" DATETIME
);

-- CreateIndex
CREATE INDEX "Zip_status_createdAt_idx" ON "Zip"("status", "createdAt");
