function normalizeOptionalString(value) {
    if (value === undefined || value === null) {
        return null;
    }

    const normalized = String(value).trim();
    return normalized === "" ? null : normalized;
}

function normalizeRequiredString(value, fieldName) {
    const normalized = normalizeOptionalString(value);
    if (!normalized) {
        throw new Error(`Missing required field: ${fieldName}`);
    }

    return normalized;
}

function normalizeBoolean(value, fieldName) {
    if (typeof value === "boolean") {
        return value;
    }

    if (typeof value === "number") {
        if (value === 1) {
            return true;
        }

        if (value === 0) {
            return false;
        }
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true" || normalized === "1") {
            return true;
        }

        if (normalized === "false" || normalized === "0") {
            return false;
        }
    }

    throw new Error(`Invalid boolean field: ${fieldName}`);
}

function mapPersistedUser(rawUser) {
    return {
        id: normalizeRequiredString(rawUser.id, "id"),
        email: normalizeRequiredString(rawUser.email, "email"),
        firstName: normalizeOptionalString(rawUser.firstName),
        lastName: normalizeOptionalString(rawUser.lastName),
        isActive: normalizeBoolean(rawUser.isActive, "isActive"),
        companyId: normalizeOptionalString(rawUser.companyId),
    };
}

function createUserRepository(pool) {
    async function findUserById(id) {
        const normalizedId = normalizeRequiredString(id, "id");
        const [rows] = await pool.query(
            `
            SELECT id, email, firstName, lastName, isActive, companyId
            FROM users
            WHERE id = ?
            LIMIT 1
            `,
            [normalizedId],
        );

        if (!rows[0]) {
            return null;
        }

        return mapPersistedUser(rows[0]);
    }

    async function findUserByEmail(email) {
        const normalizedEmail = normalizeRequiredString(email, "email");
        const [rows] = await pool.query(
            `
            SELECT id, email, firstName, lastName, isActive, companyId
            FROM users
            WHERE email = ?
            LIMIT 1
            `,
            [normalizedEmail],
        );

        if (!rows[0]) {
            return null;
        }

        return mapPersistedUser(rows[0]);
    }

    async function replaceUserId(oldId, newId) {
        const normalizedOldId = normalizeRequiredString(oldId, "oldId");
        const normalizedNewId = normalizeRequiredString(newId, "newId");

        if (normalizedOldId === normalizedNewId) {
            return;
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            await connection.query(
                `
                UPDATE mail_logs
                SET userId = ?
                WHERE userId = ?
                `,
                [normalizedNewId, normalizedOldId],
            );

            await connection.query(
                `
                UPDATE users
                SET id = ?, updatedAt = CURRENT_TIMESTAMP
                WHERE id = ?
                `,
                [normalizedNewId, normalizedOldId],
            );

            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    async function upsertUser(rawUser) {
        const user = mapPersistedUser(rawUser);

        await pool.query(
            `
            INSERT INTO users (id, email, firstName, lastName, isActive, companyId)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                email = VALUES(email),
                firstName = VALUES(firstName),
                lastName = VALUES(lastName),
                isActive = VALUES(isActive),
                companyId = VALUES(companyId),
                updatedAt = CURRENT_TIMESTAMP
            `,
            [
                user.id,
                user.email,
                user.firstName,
                user.lastName,
                user.isActive,
                user.companyId,
            ],
        );

        return user;
    }

    async function deactivateUserByIdentity(rawUser) {
        const normalizedId = normalizeRequiredString(rawUser.id, "id");
        const normalizedEmail = normalizeRequiredString(rawUser.email, "email");

        const [result] = await pool.query(
            `
            UPDATE users
            SET isActive = FALSE, updatedAt = CURRENT_TIMESTAMP
            WHERE id = ? AND email = ?
            `,
            [normalizedId, normalizedEmail],
        );

        if (result.affectedRows === 0) {
            const [fallbackResult] = await pool.query(
                `
                UPDATE users
                SET isActive = FALSE, updatedAt = CURRENT_TIMESTAMP
                WHERE email = ?
                `,
                [normalizedEmail],
            );

            return fallbackResult.affectedRows;
        }

        return result.affectedRows;
    }

    return {
        deactivateUserByIdentity,
        findUserById,
        findUserByEmail,
        replaceUserId,
        upsertUser,
    };
}

module.exports = {
    createUserRepository,
    mapPersistedUser,
};
