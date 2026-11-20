-- AlterTable
ALTER TABLE `MessageTemplate` ADD COLUMN `approvedAt` DATETIME(3) NULL,
    ADD COLUMN `eventType` VARCHAR(40) NULL,
    ADD COLUMN `isEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `libraryKey` VARCHAR(80) NULL,
    ADD COLUMN `libraryVersion` INTEGER NULL,
    ADD COLUMN `metaTemplateId` VARCHAR(64) NULL,
    ADD COLUMN `rejectedAt` DATETIME(3) NULL,
    ADD COLUMN `rejectionReason` TEXT NULL,
    ADD COLUMN `submittedAt` DATETIME(3) NULL,
    ADD COLUMN `variables` JSON NULL,
    ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `vertical` VARCHAR(40) NULL,
    ADD COLUMN `wabaId` VARCHAR(64) NULL;

-- CreateTable
CREATE TABLE `AppointmentNotificationLog` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `appointmentId` VARCHAR(191) NOT NULL,
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

    INDEX `AppointmentNotificationLog_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `AppointmentNotificationLog_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `AppointmentNotificationLog_templateId_idx`(`templateId`),
    UNIQUE INDEX `AppointmentNotificationLog_appointmentId_eventKey_key`(`appointmentId`, `eventKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `MessageTemplate_tenantId_eventType_idx` ON `MessageTemplate`(`tenantId`, `eventType`);

-- AddForeignKey
ALTER TABLE `AppointmentNotificationLog` ADD CONSTRAINT `AppointmentNotificationLog_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AppointmentNotificationLog` ADD CONSTRAINT `AppointmentNotificationLog_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `Appointment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AppointmentNotificationLog` ADD CONSTRAINT `AppointmentNotificationLog_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `MessageTemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

