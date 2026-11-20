-- CreateTable
CREATE TABLE `ClinicDepartment` (
    `id` VARCHAR(191) NOT NULL,
    `clinicId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ClinicDepartment_clinicId_idx`(`clinicId`),
    UNIQUE INDEX `ClinicDepartment_clinicId_name_key`(`clinicId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DoctorDepartment` (
    `doctorId` VARCHAR(191) NOT NULL,
    `departmentId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DoctorDepartment_departmentId_idx`(`departmentId`),
    PRIMARY KEY (`doctorId`, `departmentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DoctorDetail` (
    `doctorId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(32) NULL,
    `registrationNumber` VARCHAR(80) NULL,
    `bio` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`doctorId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppointmentDetail` (
    `appointmentId` VARCHAR(191) NOT NULL,
    `appointmentRef` VARCHAR(32) NOT NULL,
    `departmentId` VARCHAR(191) NULL,
    `patientEmail` VARCHAR(191) NULL,
    `patientGender` VARCHAR(20) NULL,
    `patientPhone` VARCHAR(32) NULL,
    `whatsappConsent` BOOLEAN NOT NULL DEFAULT false,
    `consentAt` DATETIME(3) NULL,
    `source` VARCHAR(40) NOT NULL DEFAULT 'dashboard',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AppointmentDetail_appointmentRef_key`(`appointmentRef`),
    INDEX `AppointmentDetail_departmentId_idx`(`departmentId`),
    PRIMARY KEY (`appointmentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ClinicDepartment` ADD CONSTRAINT `ClinicDepartment_clinicId_fkey` FOREIGN KEY (`clinicId`) REFERENCES `Clinic`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DoctorDepartment` ADD CONSTRAINT `DoctorDepartment_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DoctorDepartment` ADD CONSTRAINT `DoctorDepartment_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `ClinicDepartment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DoctorDetail` ADD CONSTRAINT `DoctorDetail_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `Doctor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AppointmentDetail` ADD CONSTRAINT `AppointmentDetail_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `Appointment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AppointmentDetail` ADD CONSTRAINT `AppointmentDetail_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `ClinicDepartment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

