-- CreateTable
CREATE TABLE `sellers` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `wa_id` VARCHAR(191) NOT NULL,
    `display_name` VARCHAR(191) NULL,
    `plan` ENUM('trial', 'founder', 'standard') NOT NULL DEFAULT 'trial',
    `free_left` INTEGER NOT NULL DEFAULT 5,
    `paid_until` DATETIME(3) NULL,
    `state` ENUM('new', 'welcomed', 'active') NOT NULL DEFAULT 'new',
    `stopped` BOOLEAN NOT NULL DEFAULT false,
    `blocked` BOOLEAN NOT NULL DEFAULT false,
    `last_inbound_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `sellers_wa_id_key`(`wa_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `consents` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `seller_id` BIGINT NOT NULL,
    `doc_version` VARCHAR(191) NOT NULL,
    `accepted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `consents_seller_id_idx`(`seller_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `verifications` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `seller_id` BIGINT NOT NULL,
    `status` ENUM('pending', 'processing', 'in_review', 'sent', 'rejected', 'failed') NOT NULL DEFAULT 'pending',
    `operator` VARCHAR(191) NULL,
    `amount_xof` INTEGER NULL,
    `tx_ref_hash` CHAR(64) NULL,
    `tx_datetime` DATETIME(3) NULL,
    `sms_present` BOOLEAN NOT NULL DEFAULT false,
    `verdict` ENUM('coherent', 'douteux', 'faux_probable') NULL,
    `reasons` JSON NOT NULL,
    `confidence` JSON NULL,
    `counted` BOOLEAN NOT NULL DEFAULT false,
    `reviewed_by` VARCHAR(191) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sent_at` DATETIME(3) NULL,

    INDEX `verifications_ref_idx`(`operator`, `tx_ref_hash`),
    INDEX `verifications_seller_idx`(`seller_id`, `created_at` DESC),
    INDEX `verifications_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `verification_items` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `verification_id` BIGINT NOT NULL,
    `wamid` VARCHAR(191) NOT NULL,
    `kind` ENUM('image', 'text') NOT NULL,
    `storage_key` VARCHAR(191) NULL,
    `mime_type` VARCHAR(191) NULL,
    `text` TEXT NULL,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `verification_items_wamid_key`(`wamid`),
    INDEX `verification_items_verification_id_idx`(`verification_id`),
    INDEX `verification_items_received_at_idx`(`received_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `seller_id` BIGINT NOT NULL,
    `amount_xof` INTEGER NOT NULL,
    `plan` ENUM('trial', 'founder', 'standard') NOT NULL,
    `method` VARCHAR(191) NULL,
    `external_id` VARCHAR(191) NULL,
    `period_start` DATE NOT NULL,
    `period_end` DATE NOT NULL,
    `recorded_by` VARCHAR(191) NULL,
    `paid_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payments_seller_id_idx`(`seller_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inbound_events` (
    `id` CHAR(64) NOT NULL,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `outbound_messages` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `seller_id` BIGINT NULL,
    `wamid` VARCHAR(191) NULL,
    `kind` VARCHAR(191) NOT NULL,
    `template` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'queued',
    `error` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `outbound_messages_wamid_key`(`wamid`),
    INDEX `outbound_messages_seller_id_idx`(`seller_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `actor` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `target` VARCHAR(191) NULL,
    `detail` JSON NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_log_at_idx`(`at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `settings` (
    `key` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `consents` ADD CONSTRAINT `consents_seller_id_fkey` FOREIGN KEY (`seller_id`) REFERENCES `sellers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `verifications` ADD CONSTRAINT `verifications_seller_id_fkey` FOREIGN KEY (`seller_id`) REFERENCES `sellers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `verification_items` ADD CONSTRAINT `verification_items_verification_id_fkey` FOREIGN KEY (`verification_id`) REFERENCES `verifications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_seller_id_fkey` FOREIGN KEY (`seller_id`) REFERENCES `sellers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `outbound_messages` ADD CONSTRAINT `outbound_messages_seller_id_fkey` FOREIGN KEY (`seller_id`) REFERENCES `sellers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

