-- CreateTable
CREATE TABLE "Ligera" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "videoId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'en_cola',
    "error" TEXT,
    "clave" TEXT,
    "duracion" REAL,
    "progreso" INTEGER NOT NULL DEFAULT 0,
    "size" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" DATETIME,
    "expiresAt" DATETIME,
    CONSTRAINT "Ligera_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Ligera_videoId_key" ON "Ligera"("videoId");
