-- CreateTable
CREATE TABLE `ref_locks` (
    `hash` CHAR(64) NOT NULL,

    PRIMARY KEY (`hash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
