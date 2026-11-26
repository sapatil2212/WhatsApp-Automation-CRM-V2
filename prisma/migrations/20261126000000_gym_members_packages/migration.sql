-- CreateTable
CREATE TABLE `GymPackage` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `durationDays` INTEGER NOT NULL,
    `price` DECIMAL(12, 2) NOT NULL,
    `joiningFee` DECIMAL(12, 2) NULL,
    `features` JSON NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `GymPackage_tenantId_isActive_idx`(`tenantId`, `isActive`),
    INDEX `GymPackage_businessId_idx`(`businessId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GymMember` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `memberCode` VARCHAR(24) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `phone` VARCHAR(32) NOT NULL,
    `email` VARCHAR(191) NULL,
    `gender` VARCHAR(20) NULL,
    `dateOfBirth` DATE NULL,
    `address` TEXT NULL,
    `emergencyContactName` VARCHAR(120) NULL,
    `emergencyContactPhone` VARCHAR(32) NULL,
    `heightCm` INTEGER NULL,
    `weightKg` DECIMAL(5, 1) NULL,
    `fitnessGoal` VARCHAR(191) NULL,
    `medicalNotes` TEXT NULL,
    `notes` TEXT NULL,
    `joinedAt` DATE NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `source` VARCHAR(20) NOT NULL DEFAULT 'manual',
    `whatsappConsent` BOOLEAN NOT NULL DEFAULT true,
    `welcomeSentAt` DATETIME(3) NULL,
    `lastAttendanceAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `GymMember_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `GymMember_tenantId_phone_idx`(`tenantId`, `phone`),
    UNIQUE INDEX `GymMember_businessId_contactId_key`(`businessId`, `contactId`),
    UNIQUE INDEX `GymMember_businessId_memberCode_key`(`businessId`, `memberCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GymMembership` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `memberId` VARCHAR(191) NOT NULL,
    `packageId` VARCHAR(191) NULL,
    `packageName` VARCHAR(120) NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `price` DECIMAL(12, 2) NOT NULL,
    `discount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `amountPaid` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `paymentStatus` VARCHAR(20) NOT NULL DEFAULT 'unpaid',
    `paymentMode` VARCHAR(30) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `GymMembership_tenantId_endDate_idx`(`tenantId`, `endDate`),
    INDEX `GymMembership_memberId_idx`(`memberId`),
    INDEX `GymMembership_packageId_idx`(`packageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MemberMessageLog` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `memberId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NULL,
    `eventType` VARCHAR(40) NOT NULL,
    `eventKey` VARCHAR(120) NOT NULL,
    `channel` VARCHAR(20) NOT NULL DEFAULT 'none',
    `templateId` VARCHAR(191) NULL,
    `templateName` VARCHAR(120) NULL,
    `templateVersion` INTEGER NULL,
    `phoneNumber` VARCHAR(32) NULL,
    `messageId` VARCHAR(128) NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'pending',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `errorMessage` TEXT NULL,
    `scheduledAt` DATETIME(3) NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MemberMessageLog_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    UNIQUE INDEX `MemberMessageLog_memberId_eventKey_key`(`memberId`, `eventKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `GymPackage` ADD CONSTRAINT `GymPackage_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GymPackage` ADD CONSTRAINT `GymPackage_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `BusinessProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GymMember` ADD CONSTRAINT `GymMember_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GymMember` ADD CONSTRAINT `GymMember_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `BusinessProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GymMember` ADD CONSTRAINT `GymMember_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GymMembership` ADD CONSTRAINT `GymMembership_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GymMembership` ADD CONSTRAINT `GymMembership_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `GymMember`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GymMembership` ADD CONSTRAINT `GymMembership_packageId_fkey` FOREIGN KEY (`packageId`) REFERENCES `GymPackage`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MemberMessageLog` ADD CONSTRAINT `MemberMessageLog_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MemberMessageLog` ADD CONSTRAINT `MemberMessageLog_memberId_fkey` FOREIGN KEY (`memberId`) REFERENCES `GymMember`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
