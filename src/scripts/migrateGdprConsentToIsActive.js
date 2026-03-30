const path = require("path");
const mysql = require("mysql2/promise");

require("dotenv").config({
    path: path.resolve(process.cwd(), ".env"),
});

async function run() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || "localhost",
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });

    try {
        const [existingColumnRows] = await connection.query(
            `
            SELECT COUNT(*) AS count
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = ?
              AND TABLE_NAME = 'users'
              AND COLUMN_NAME = 'gdprConsent'
            `,
            [process.env.DB_NAME],
        );

        const [targetColumnRows] = await connection.query(
            `
            SELECT COUNT(*) AS count
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = ?
              AND TABLE_NAME = 'users'
              AND COLUMN_NAME = 'isActive'
            `,
            [process.env.DB_NAME],
        );

        const hasGdprConsent = Number(existingColumnRows?.[0]?.count || 0) > 0;
        const hasIsActive = Number(targetColumnRows?.[0]?.count || 0) > 0;

        if (hasIsActive && !hasGdprConsent) {
            console.log(
                "Migration already applied: users.isActive exists and users.gdprConsent is absent.",
            );
            return;
        }

        if (!hasGdprConsent) {
            console.log(
                "No users.gdprConsent column found. Nothing to migrate.",
            );
            return;
        }

        if (hasIsActive) {
            throw new Error(
                "Both users.gdprConsent and users.isActive exist. Resolve manually before running this migration.",
            );
        }

        await connection.query(
            "ALTER TABLE users CHANGE COLUMN gdprConsent isActive BOOLEAN NOT NULL DEFAULT TRUE",
        );

        console.log(
            "Migration complete: users.gdprConsent renamed to users.isActive.",
        );
    } finally {
        await connection.end();
    }
}

run().catch((error) => {
    console.error(`Migration failed: ${error.message}`);
    process.exitCode = 1;
});
