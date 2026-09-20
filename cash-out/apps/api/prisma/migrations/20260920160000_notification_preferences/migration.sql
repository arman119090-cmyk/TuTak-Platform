-- CreateTable
CREATE TABLE "notification_preferences" (
    "driverId" UUID NOT NULL,
    "payoutStatus" BOOLEAN NOT NULL DEFAULT true,
    "autoPayout" BOOLEAN NOT NULL DEFAULT true,
    "securityAlerts" BOOLEAN NOT NULL DEFAULT true,
    "parkChanges" BOOLEAN NOT NULL DEFAULT true,
    "pushToken" TEXT,
    "pushPlatform" TEXT,
    "pushTokenAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("driverId")
);
