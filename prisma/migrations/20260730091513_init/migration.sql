-- CreateTable
CREATE TABLE "urls" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "original_url" TEXT NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(6),
    "click_count" BIGINT NOT NULL DEFAULT 0,
    "last_accessed_at" TIMESTAMP(6),

    CONSTRAINT "urls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "urls_code_key" ON "urls"("code");
