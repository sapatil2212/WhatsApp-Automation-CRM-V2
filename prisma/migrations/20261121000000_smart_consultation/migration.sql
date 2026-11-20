-- AlterTable
ALTER TABLE `DoctorDetail` ADD COLUMN `designation` VARCHAR(80) NULL,
    ADD COLUMN `signature` MEDIUMBLOB NULL,
    ADD COLUMN `signatureMime` VARCHAR(40) NULL,
    ADD COLUMN `signatureUpdatedAt` DATETIME(3) NULL,
    ADD COLUMN `signatureUpdatedBy` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `PatientProfile` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `clinicId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `patientCode` VARCHAR(20) NOT NULL,
    `gender` VARCHAR(20) NULL,
    `dateOfBirth` DATE NULL,
    `ageYears` INTEGER NULL,
    `bloodGroup` VARCHAR(5) NULL,
    `allergies` TEXT NULL,
    `conditions` TEXT NULL,
    `medications` TEXT NULL,
    `surgicalHistory` TEXT NULL,
    `familyHistory` TEXT NULL,
    `emergencyName` VARCHAR(120) NULL,
    `emergencyPhone` VARCHAR(32) NULL,
    `notes` TEXT NULL,
    `phoneVerified` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `PatientProfile_contactId_key`(`contactId`),
    INDEX `PatientProfile_tenantId_idx`(`tenantId`),
    INDEX `PatientProfile_clinicId_idx`(`clinicId`),
    UNIQUE INDEX `PatientProfile_tenantId_patientCode_key`(`tenantId`, `patientCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Consultation` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `clinicId` VARCHAR(191) NOT NULL,
    `appointmentId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `doctorId` VARCHAR(191) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'in_progress',
    `chiefComplaint` JSON NULL,
    `vitals` JSON NULL,
    `history` JSON NULL,
    `examination` TEXT NULL,
    `diagnoses` JSON NULL,
    `investigations` JSON NULL,
    `treatmentPlan` TEXT NULL,
    `followUpDate` DATE NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `startedBy` VARCHAR(191) NULL,
    `completedBy` VARCHAR(191) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,
    `durationSec` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Consultation_appointmentId_key`(`appointmentId`),
    INDEX `Consultation_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `Consultation_contactId_idx`(`contactId`),
    INDEX `Consultation_doctorId_idx`(`doctorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConsultationTranscript` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `consultationId` VARCHAR(191) NOT NULL,
    `source` VARCHAR(20) NOT NULL DEFAULT 'voice',
    `originalText` TEXT NOT NULL,
    `editedText` TEXT NULL,
    `aiOutput` JSON NULL,
    `model` VARCHAR(80) NULL,
    `audioSeconds` INTEGER NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ConsultationTranscript_consultationId_idx`(`consultationId`),
    INDEX `ConsultationTranscript_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Prescription` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `clinicId` VARCHAR(191) NOT NULL,
    `consultationId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `doctorId` VARCHAR(191) NULL,
    `prescriptionNo` VARCHAR(32) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
    `medicines` JSON NULL,
    `advice` JSON NULL,
    `snapshot` JSON NULL,
    `pdf` MEDIUMBLOB NULL,
    `pdfSha256` VARCHAR(64) NULL,
    `verifyToken` VARCHAR(40) NULL,
    `finalizedAt` DATETIME(3) NULL,
    `finalizedBy` VARCHAR(191) NULL,
    `deliveryStatus` VARCHAR(20) NOT NULL DEFAULT 'not_sent',
    `whatsappMessageId` VARCHAR(128) NULL,
    `mediaId` VARCHAR(128) NULL,
    `deliveryError` TEXT NULL,
    `deliveryAttempts` INTEGER NOT NULL DEFAULT 0,
    `sentAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Prescription_consultationId_key`(`consultationId`),
    INDEX `Prescription_contactId_idx`(`contactId`),
    INDEX `Prescription_whatsappMessageId_idx`(`whatsappMessageId`),
    INDEX `Prescription_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `Prescription_tenantId_prescriptionNo_key`(`tenantId`, `prescriptionNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PrescriptionSettings` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `clinicId` VARCHAR(191) NOT NULL,
    `clinicName` VARCHAR(160) NULL,
    `address` TEXT NULL,
    `phone` VARCHAR(40) NULL,
    `email` VARCHAR(191) NULL,
    `website` VARCHAR(191) NULL,
    `registrationNo` VARCHAR(80) NULL,
    `headerStyle` VARCHAR(20) NOT NULL DEFAULT 'classic',
    `accentColor` VARCHAR(9) NOT NULL DEFAULT '#0f766e',
    `footerText` TEXT NULL,
    `logo` MEDIUMBLOB NULL,
    `logoMime` VARCHAR(40) NULL,
    `stamp` MEDIUMBLOB NULL,
    `stampMime` VARCHAR(40) NULL,
    `updatedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PrescriptionSettings_tenantId_key`(`tenantId`),
    UNIQUE INDEX `PrescriptionSettings_clinicId_key`(`clinicId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MedicineCatalog` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `genericName` VARCHAR(160) NULL,
    `brandName` VARCHAR(160) NULL,
    `strength` VARCHAR(60) NULL,
    `form` VARCHAR(40) NULL,
    `manufacturer` VARCHAR(160) NULL,
    `units` VARCHAR(60) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MedicineCatalog_tenantId_name_idx`(`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PrescriptionTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `doctorId` VARCHAR(191) NULL,
    `name` VARCHAR(120) NOT NULL,
    `medicines` JSON NULL,
    `advice` JSON NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PrescriptionTemplate_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PatientDocument` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `consultationId` VARCHAR(191) NULL,
    `kind` VARCHAR(30) NOT NULL DEFAULT 'other',
    `title` VARCHAR(160) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(80) NOT NULL,
    `size` INTEGER NOT NULL,
    `data` MEDIUMBLOB NOT NULL,
    `uploadedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,

    INDEX `PatientDocument_tenantId_contactId_idx`(`tenantId`, `contactId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PatientProfile` ADD CONSTRAINT `PatientProfile_clinicId_fkey` FOREIGN KEY (`clinicId`) REFERENCES `Clinic`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PatientProfile` ADD CONSTRAINT `PatientProfile_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Consultation` ADD CONSTRAINT `Consultation_clinicId_fkey` FOREIGN KEY (`clinicId`) REFERENCES `Clinic`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Consultation` ADD CONSTRAINT `Consultation_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `Appointment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Consultation` ADD CONSTRAINT `Consultation_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Consultation` ADD CONSTRAINT `Consultation_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConsultationTranscript` ADD CONSTRAINT `ConsultationTranscript_consultationId_fkey` FOREIGN KEY (`consultationId`) REFERENCES `Consultation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Prescription` ADD CONSTRAINT `Prescription_clinicId_fkey` FOREIGN KEY (`clinicId`) REFERENCES `Clinic`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Prescription` ADD CONSTRAINT `Prescription_consultationId_fkey` FOREIGN KEY (`consultationId`) REFERENCES `Consultation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Prescription` ADD CONSTRAINT `Prescription_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Prescription` ADD CONSTRAINT `Prescription_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PrescriptionSettings` ADD CONSTRAINT `PrescriptionSettings_clinicId_fkey` FOREIGN KEY (`clinicId`) REFERENCES `Clinic`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PrescriptionTemplate` ADD CONSTRAINT `PrescriptionTemplate_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PatientDocument` ADD CONSTRAINT `PatientDocument_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

