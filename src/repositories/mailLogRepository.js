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

    async function findLogs({ userId = null, limit = 50 } = {}) {
        const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 100);
        let rows;
        if (userId) {
            [rows] = await pool.execute(
                "SELECT id, userId, templateId, status, sentAt FROM mail_logs WHERE userId = ? ORDER BY sentAt DESC LIMIT ?",
                [userId, safeLimit],
            );
        } else {
            [rows] = await pool.execute(
                "SELECT id, userId, templateId, status, sentAt FROM mail_logs ORDER BY sentAt DESC LIMIT ?",
                [safeLimit],
            );
        }
        return rows;
    }

    return {
        insertMailLog,
        findLogs,
    };
}

module.exports = {
    createMailLogRepository,
};
