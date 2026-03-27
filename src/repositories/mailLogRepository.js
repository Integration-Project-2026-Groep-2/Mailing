function createMailLogRepository(pool) {
    async function insertMailLog({ userId, templateId, status }) {
        await pool.query(
            `
            INSERT INTO mail_logs (userId, templateId, status)
            VALUES (?, ?, ?)
            `,
            [userId, templateId, status],
        );
    }

    return {
        insertMailLog,
    };
}

module.exports = {
    createMailLogRepository,
};
