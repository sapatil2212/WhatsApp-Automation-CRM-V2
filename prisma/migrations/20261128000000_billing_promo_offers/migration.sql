-- CreateTable
CREATE TABLE `MarketingOffer` (
    `id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `body` TEXT NULL,
    `imageUrl` MEDIUMTEXT NULL,
    `ctaLabel` VARCHAR(60) NULL,
    `ctaUrl` VARCHAR(500) NULL,
    `promoCodeId` VARCHAR(191) NULL,
    `delaySeconds` INTEGER NOT NULL DEFAULT 3,
    `frequency` VARCHAR(20) NOT NULL DEFAULT 'session',
    `isActive` BOOLEAN NOT NULL DEFAULT false,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `views` INTEGER NOT NULL DEFAULT 0,
    `clicks` INTEGER NOT NULL DEFAULT 0,
    `dismissals` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MarketingOffer_kind_isActive_idx`(`kind`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PromoCode` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `description` VARCHAR(300) NULL,
    `discountType` VARCHAR(10) NOT NULL,
    `discountValue` DECIMAL(10, 2) NOT NULL,
    `maxDiscount` DECIMAL(10, 2) NULL,
    `plans` JSON NULL,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `maxRedemptions` INTEGER NULL,
    `perUserLimit` INTEGER NOT NULL DEFAULT 1,
    `timesRedeemed` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PromoCode_code_key`(`code`),
    INDEX `PromoCode_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PromoRedemption` (
    `id` VARCHAR(191) NOT NULL,
    `promoCodeId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `email` VARCHAR(191) NOT NULL,
    `plan` VARCHAR(40) NOT NULL,
    `originalPaise` INTEGER NOT NULL,
    `discountPaise` INTEGER NOT NULL,
    `finalPaise` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `paymentId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `redeemedAt` DATETIME(3) NULL,

    UNIQUE INDEX `PromoRedemption_paymentId_key`(`paymentId`),
    INDEX `PromoRedemption_promoCodeId_status_idx`(`promoCodeId`, `status`),
    INDEX `PromoRedemption_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BillingPayment` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `email` VARCHAR(191) NOT NULL,
    `plan` VARCHAR(40) NOT NULL,
    `provider` VARCHAR(20) NOT NULL DEFAULT 'razorpay',
    `amountPaise` INTEGER NOT NULL,
    `originalPaise` INTEGER NOT NULL,
    `discountPaise` INTEGER NOT NULL DEFAULT 0,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'INR',
    `promoCodeId` VARCHAR(191) NULL,
    `providerOrderId` VARCHAR(64) NULL,
    `providerPaymentId` VARCHAR(64) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'created',
    `method` VARCHAR(30) NULL,
    `failureReason` VARCHAR(500) NULL,
    `confirmedVia` VARCHAR(20) NULL,
    `paidAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BillingPayment_providerOrderId_key`(`providerOrderId`),
    UNIQUE INDEX `BillingPayment_providerPaymentId_key`(`providerPaymentId`),
    INDEX `BillingPayment_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `BillingPayment_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BillingWebhookEvent` (
    `id` VARCHAR(64) NOT NULL,
    `event` VARCHAR(60) NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MarketingOffer` ADD CONSTRAINT `MarketingOffer_promoCodeId_fkey` FOREIGN KEY (`promoCodeId`) REFERENCES `PromoCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromoRedemption` ADD CONSTRAINT `PromoRedemption_promoCodeId_fkey` FOREIGN KEY (`promoCodeId`) REFERENCES `PromoCode`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromoRedemption` ADD CONSTRAINT `PromoRedemption_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromoRedemption` ADD CONSTRAINT `PromoRedemption_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `BillingPayment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BillingPayment` ADD CONSTRAINT `BillingPayment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BillingPayment` ADD CONSTRAINT `BillingPayment_promoCodeId_fkey` FOREIGN KEY (`promoCodeId`) REFERENCES `PromoCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
