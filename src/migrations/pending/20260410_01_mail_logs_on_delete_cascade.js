function escapeIdentifier(value) {
    return String(value).replaceAll("`", "``");
}

async function findExistingMailLogsForeignKey(connection) {
    const [rows] = await connection.query(
        `
        SELECT rc.CONSTRAINT_NAME, rc.DELETE_RULE
        FROM information_schema.REFERENTIAL_CONSTRAINTS rc
        INNER JOIN information_schema.KEY_COLUMN_USAGE kcu
            ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
           AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
        WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
          AND rc.TABLE_NAME = 'mail_logs'
          AND rc.REFERENCED_TABLE_NAME = 'users'
          AND kcu.TABLE_NAME = 'mail_logs'
          AND kcu.COLUMN_NAME = 'userId'
          AND kcu.REFERENCED_TABLE_NAME = 'users'
          AND kcu.REFERENCED_COLUMN_NAME = 'id'
        ORDER BY rc.CONSTRAINT_NAME ASC
        LIMIT 1
        `,
    );

    return rows[0] || null;
}

async function up(connection) {
    const existingForeignKey = await findExistingMailLogsForeignKey(connection);

    if (existingForeignKey?.DELETE_RULE === "CASCADE") {
        return {
            status: "already_applied",
            constraintName: existingForeignKey.CONSTRAINT_NAME,
        };
    }

    if (existingForeignKey?.CONSTRAINT_NAME) {
        await connection.query(
            `ALTER TABLE mail_logs DROP FOREIGN KEY \`${escapeIdentifier(existingForeignKey.CONSTRAINT_NAME)}\``,
        );
    }

    await connection.query(`
        ALTER TABLE mail_logs
        ADD CONSTRAINT mail_logs_ibfk_1
        FOREIGN KEY (userId) REFERENCES users(id)
        ON DELETE CASCADE
    `);

    return {
        status: "applied",
        constraintName: "mail_logs_ibfk_1",
    };
}

module.exports = {
    id: "20260410_01_mail_logs_on_delete_cascade",
    description: "Add ON DELETE CASCADE to mail_logs.userId foreign key",
    up,
};
