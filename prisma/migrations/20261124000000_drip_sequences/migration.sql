CREATE TABLE `DripSequence` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `stopOnReply` BOOLEAN NOT NULL DEFAULT true,
    `steps` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DripSequence_tenantId_status_idx`(`tenantId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DripEnrollment` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `sequenceId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `step` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `stopReason` VARCHAR(60) NULL,
    `nextRunAt` DATETIME(3) NOT NULL,
    `lastError` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DripEnrollment_sequenceId_contactId_key`(`sequenceId`, `contactId`),
    INDEX `DripEnrollment_status_nextRunAt_idx`(`status`, `nextRunAt`),
    INDEX `DripEnrollment_tenantId_idx`(`tenantId`),
    INDEX `DripEnrollment_contactId_idx`(`contactId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `DripSequence` ADD CONSTRAINT `DripSequence_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DripEnrollment` ADD CONSTRAINT `DripEnrollment_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DripEnrollment` ADD CONSTRAINT `DripEnrollment_sequenceId_fkey` FOREIGN KEY (`sequenceId`) REFERENCES `DripSequence`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DripEnrollment` ADD CONSTRAINT `DripEnrollment_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
