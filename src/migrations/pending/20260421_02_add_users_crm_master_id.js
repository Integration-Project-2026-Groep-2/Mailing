async function columnExists(connection, tableName, columnName) {
    const [rows] = await connection.query(
        `
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
        LIMIT 1
        `,
        [tableName, columnName],
    );

    return rows.length > 0;
}

async function indexExists(connection, tableName, indexName) {
    const [rows] = await connection.query(
        `
        SELECT 1
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND INDEX_NAME = ?
        LIMIT 1
        `,
        [tableName, indexName],
    );

    return rows.length > 0;
}

async function up(connection) {
    const hasCrmMasterId = await columnExists(
        connection,
        "users",
        "crmMasterId",
    );
    if (!hasCrmMasterId) {
        await connection.query(`
            ALTER TABLE users
            ADD COLUMN crmMasterId CHAR(36) NULL AFTER id
        `);
    }

    const hasCrmMasterIdIndex = await indexExists(
        connection,
        "users",
        "uq_users_crmMasterId",
    );
    if (!hasCrmMasterIdIndex) {
        await connection.query(`
            CREATE UNIQUE INDEX uq_users_crmMasterId
            ON users (crmMasterId)
        `);
    }

    return {
        status: "applied",
        columnAdded: !hasCrmMasterId,
        indexAdded: !hasCrmMasterIdIndex,
    };
}

module.exports = {
    id: "20260421_02_add_users_crm_master_id",
    description: "Add users.crmMasterId for CRM master UUID tracking",
    up,
};
