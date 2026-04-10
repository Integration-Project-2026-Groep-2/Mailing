const fs = require("fs/promises");
const path = require("path");

const migrationsDir = path.resolve(__dirname, "..", "migrations", "pending");

function escapeIdentifier(value) {
    return String(value).replaceAll("`", "``");
}

async function ensureMigrationTable(connection) {
    await connection.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id VARCHAR(191) PRIMARY KEY,
            description VARCHAR(255) NOT NULL,
            appliedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

async function loadPendingMigrationModules() {
    let entries = [];
    try {
        entries = await fs.readdir(migrationsDir, { withFileTypes: true });
    } catch (error) {
        if (error.code === "ENOENT") {
            return [];
        }

        throw error;
    }

    const migrationFiles = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));

    return migrationFiles.map((fileName) => {
        const modulePath = path.join(migrationsDir, fileName);
        // eslint-disable-next-line global-require, import/no-dynamic-require
        const migration = require(modulePath);

        if (!migration || typeof migration.up !== "function" || !migration.id) {
            throw new Error(
                `Invalid migration module: ${modulePath}. Expected { id, description, up }`,
            );
        }

        return {
            fileName,
            modulePath,
            ...migration,
        };
    });
}

async function getAppliedMigrationIds(connection) {
    const [rows] = await connection.query(
        "SELECT id FROM schema_migrations ORDER BY id ASC",
    );

    return new Set(rows.map((row) => row.id));
}

async function recordMigration(connection, migration) {
    await connection.query(
        `
        INSERT INTO schema_migrations (id, description)
        VALUES (?, ?)
        `,
        [migration.id, migration.description || migration.fileName],
    );
}

function createMigrationService(pool) {
    async function listMigrations() {
        const connection = await pool.getConnection();
        try {
            await ensureMigrationTable(connection);
            const appliedMigrationIds =
                await getAppliedMigrationIds(connection);
            const migrations = await loadPendingMigrationModules();

            return migrations.map((migration) => ({
                id: migration.id,
                description: migration.description || migration.fileName,
                fileName: migration.fileName,
                applied: appliedMigrationIds.has(migration.id),
            }));
        } finally {
            connection.release();
        }
    }

    async function applyPendingMigrations() {
        const connection = await pool.getConnection();
        const applied = [];
        const skipped = [];

        try {
            await ensureMigrationTable(connection);
            const appliedMigrationIds =
                await getAppliedMigrationIds(connection);
            const migrations = await loadPendingMigrationModules();

            for (const migration of migrations) {
                if (appliedMigrationIds.has(migration.id)) {
                    skipped.push({
                        id: migration.id,
                        reason: "already_applied",
                    });
                    continue;
                }

                const result = await migration.up(connection);
                await recordMigration(connection, migration);
                applied.push({
                    id: migration.id,
                    description: migration.description || migration.fileName,
                    result: result || null,
                });
            }

            return {
                applied,
                skipped,
                pendingCount: migrations.filter(
                    (migration) => !appliedMigrationIds.has(migration.id),
                ).length,
            };
        } finally {
            connection.release();
        }
    }

    return {
        listMigrations,
        applyPendingMigrations,
    };
}

module.exports = { createMigrationService };
