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
        gdprConsent: normalizeBoolean(rawUser.gdprConsent, "gdprConsent"),
        companyId: normalizeOptionalString(rawUser.companyId),
    };
}

function createUserRepository(pool) {
    async function upsertUser(rawUser) {
        const user = mapPersistedUser(rawUser);

        await pool.query(
            `
            INSERT INTO users (id, email, firstName, lastName, gdprConsent, companyId)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                email = VALUES(email),
                firstName = VALUES(firstName),
                lastName = VALUES(lastName),
                gdprConsent = VALUES(gdprConsent),
                companyId = VALUES(companyId),
                updatedAt = CURRENT_TIMESTAMP
            `,
            [
                user.id,
                user.email,
                user.firstName,
                user.lastName,
                user.gdprConsent,
                user.companyId,
            ],
        );

        return user;
    }

    return {
        upsertUser,
    };
}

module.exports = {
    createUserRepository,
    mapPersistedUser,
};
