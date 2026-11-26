-- Universal QR page: social links per business, and the platform of social_opened events.
ALTER TABLE `ReviewBusiness` ADD COLUMN `socialLinks` JSON NULL;
ALTER TABLE `ReviewEngagementEvent` ADD COLUMN `platform` VARCHAR(30) NULL;
