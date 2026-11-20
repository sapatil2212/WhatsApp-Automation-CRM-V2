-- CreateTable
CREATE TABLE `ReviewBusiness` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `category` VARCHAR(120) NULL,
    `description` TEXT NULL,
    `address` VARCHAR(300) NULL,
    `googleReviewUrl` TEXT NULL,
    `website` VARCHAR(300) NULL,
    `phone` VARCHAR(40) NULL,
    `logoUrl` MEDIUMTEXT NULL,
    `services` JSON NULL,
    `defaultLanguage` VARCHAR(8) NOT NULL DEFAULT 'en',
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `publicToken` VARCHAR(40) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ReviewBusiness_publicToken_key`(`publicToken`),
    INDEX `ReviewBusiness_tenantId_deletedAt_idx`(`tenantId`, `deletedAt`),
    INDEX `ReviewBusiness_tenantId_status_idx`(`tenantId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReviewCampaign` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `description` VARCHAR(500) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ReviewCampaign_tenantId_businessId_idx`(`tenantId`, `businessId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReviewQRCode` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NULL,
    `label` VARCHAR(160) NOT NULL,
    `placement` VARCHAR(60) NULL,
    `token` VARCHAR(40) NOT NULL,
    `fgColor` VARCHAR(9) NOT NULL DEFAULT '#0f172a',
    `bgColor` VARCHAR(9) NOT NULL DEFAULT '#ffffff',
    `includeLogo` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ReviewQRCode_token_key`(`token`),
    INDEX `ReviewQRCode_tenantId_businessId_idx`(`tenantId`, `businessId`),
    INDEX `ReviewQRCode_campaignId_idx`(`campaignId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReviewCustomerApproval` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NULL,
    `qrCodeId` VARCHAR(191) NULL,
    `visitorId` VARCHAR(64) NOT NULL,
    `rating` INTEGER NOT NULL,
    `language` VARCHAR(8) NOT NULL,
    `feedbackText` TEXT NULL,
    `finalText` TEXT NOT NULL,
    `edited` BOOLEAN NOT NULL DEFAULT false,
    `consentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReviewCustomerApproval_tenantId_businessId_createdAt_idx`(`tenantId`, `businessId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReviewAutomationJob` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NULL,
    `qrCodeId` VARCHAR(191) NULL,
    `approvalId` VARCHAR(191) NULL,
    `status` VARCHAR(40) NOT NULL DEFAULT 'pending',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 3,
    `lastError` TEXT NULL,
    `nextRunAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lockedAt` DATETIME(3) NULL,
    `lockedBy` VARCHAR(80) NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `durationMs` INTEGER NULL,
    `screenshotPath` VARCHAR(400) NULL,
    `result` JSON NULL,
    `cancelRequested` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ReviewAutomationJob_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    INDEX `ReviewAutomationJob_status_nextRunAt_idx`(`status`, `nextRunAt`),
    INDEX `ReviewAutomationJob_businessId_idx`(`businessId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReviewAutomationLog` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `jobId` VARCHAR(191) NOT NULL,
    `level` VARCHAR(10) NOT NULL DEFAULT 'info',
    `message` VARCHAR(500) NOT NULL,
    `meta` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReviewAutomationLog_jobId_createdAt_idx`(`jobId`, `createdAt`),
    INDEX `ReviewAutomationLog_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReviewEngagementEvent` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NULL,
    `qrCodeId` VARCHAR(191) NULL,
    `visitorId` VARCHAR(64) NOT NULL,
    `eventType` VARCHAR(40) NOT NULL,
    `language` VARCHAR(8) NULL,
    `rating` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReviewEngagementEvent_tenantId_businessId_createdAt_idx`(`tenantId`, `businessId`, `createdAt`),
    INDEX `ReviewEngagementEvent_tenantId_eventType_createdAt_idx`(`tenantId`, `eventType`, `createdAt`),
    INDEX `ReviewEngagementEvent_qrCodeId_eventType_idx`(`qrCodeId`, `eventType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReviewAIRequest` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `qrCodeId` VARCHAR(191) NULL,
    `kind` VARCHAR(20) NOT NULL,
    `language` VARCHAR(8) NOT NULL,
    `rating` INTEGER NULL,
    `inputChars` INTEGER NOT NULL DEFAULT 0,
    `outputCount` INTEGER NOT NULL DEFAULT 0,
    `tokensUsed` INTEGER NOT NULL DEFAULT 0,
    `success` BOOLEAN NOT NULL DEFAULT true,
    `error` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReviewAIRequest_tenantId_businessId_createdAt_idx`(`tenantId`, `businessId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ReviewBusiness` ADD CONSTRAINT `ReviewBusiness_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReviewCampaign` ADD CONSTRAINT `ReviewCampaign_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `ReviewBusiness`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReviewQRCode` ADD CONSTRAINT `ReviewQRCode_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `ReviewBusiness`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReviewQRCode` ADD CONSTRAINT `ReviewQRCode_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `ReviewCampaign`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReviewCustomerApproval` ADD CONSTRAINT `ReviewCustomerApproval_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `ReviewBusiness`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReviewCustomerApproval` ADD CONSTRAINT `ReviewCustomerApproval_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `ReviewCampaign`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReviewCustomerApproval` ADD CONSTRAINT `ReviewCustomerApproval_qrCodeId_fkey` FOREIGN KEY (`qrCodeId`) REFERENCES `ReviewQRCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReviewAutomationJob` ADD CONSTRAINT `ReviewAutomationJob_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `ReviewBusiness`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReviewAutomationJob` ADD CONSTRAINT `ReviewAutomationJob_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `ReviewCampaign`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReviewAutomationJob` ADD CONSTRAINT `ReviewAutomationJob_qrCodeId_fkey` FOREIGN KEY (`qrCodeId`) REFERENCES `ReviewQRCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReviewAutomationJob` ADD CONSTRAINT `ReviewAutomationJob_approvalId_fkey` FOREIGN KEY (`approvalId`) REFERENCES `ReviewCustomerApproval`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReviewAutomationLog` ADD CONSTRAINT `ReviewAutomationLog_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `ReviewAutomationJob`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReviewEngagementEvent` ADD CONSTRAINT `ReviewEngagementEvent_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `ReviewBusiness`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReviewEngagementEvent` ADD CONSTRAINT `ReviewEngagementEvent_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `ReviewCampaign`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReviewEngagementEvent` ADD CONSTRAINT `ReviewEngagementEvent_qrCodeId_fkey` FOREIGN KEY (`qrCodeId`) REFERENCES `ReviewQRCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReviewAIRequest` ADD CONSTRAINT `ReviewAIRequest_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `ReviewBusiness`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReviewAIRequest` ADD CONSTRAINT `ReviewAIRequest_qrCodeId_fkey` FOREIGN KEY (`qrCodeId`) REFERENCES `ReviewQRCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

