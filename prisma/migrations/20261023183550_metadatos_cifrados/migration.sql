-- AlterTable
ALTER TABLE "Vault" ADD COLUMN "catalog" TEXT;
ALTER TABLE "Vault" ADD COLUMN "metaKeyWrap" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Video" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meta" TEXT,
    "title" TEXT,
    "originalName" TEXT,
    "mime" TEXT,
    "size" INTEGER NOT NULL DEFAULT 0,
    "uploadId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'en_cola',
    "error" TEXT,
    "duration" REAL,
    "width" INTEGER,
    "height" INTEGER,
    "videoCodec" TEXT,
    "segments" INTEGER,
    "keyWrap" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" DATETIME
);
INSERT INTO "new_Video" ("createdAt", "duration", "error", "height", "id", "keyWrap", "mime", "originalName", "readyAt", "segments", "size", "status", "title", "uploadId", "videoCodec", "width") SELECT "createdAt", "duration", "error", "height", "id", "keyWrap", "mime", "originalName", "readyAt", "segments", "size", "status", "title", "uploadId", "videoCodec", "width" FROM "Video";
DROP TABLE "Video";
ALTER TABLE "new_Video" RENAME TO "Video";
CREATE UNIQUE INDEX "Video_uploadId_key" ON "Video"("uploadId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
