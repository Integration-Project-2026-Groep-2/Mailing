const { randomUUID } = require("crypto");

async function resolveLocalIdForCrmIdentity(rawUser, userRepository) {
    const existingByEmail = await userRepository.findUserByEmail(rawUser.email);
    const existingByCrmMasterId = await userRepository.findUserByCrmMasterId(
        rawUser.id,
    );

    if (
        existingByEmail &&
        existingByCrmMasterId &&
        existingByEmail.id !== existingByCrmMasterId.id
    ) {
        throw new Error(
            "CRM reconciliation conflict: email and crmMasterId resolve to different users",
        );
    }

    if (existingByEmail) {
        return existingByEmail.id;
    }

    if (existingByCrmMasterId) {
        return existingByCrmMasterId.id;
    }

    return randomUUID();
}

function processCrmUserConfirmedUser(
    rawUser,
    { userRepository, mailLogRepository, sendgridService },
) {
    return (async () => {
        const localId = await resolveLocalIdForCrmIdentity(
            rawUser,
            userRepository,
        );
        const persistedUser = await userRepository.upsertUser({
            id: localId,
            crmMasterId: rawUser.id,
            email: rawUser.email,
            firstName: rawUser.firstName,
            lastName: rawUser.lastName,
            isActive: rawUser.isActive,
            companyId: rawUser.companyId,
        });

        try {
            await sendgridService.sendUserConfirmedEmail({
                ...persistedUser,
                confirmedAt: rawUser.confirmedAt,
            });
            await mailLogRepository.insertMailLog({
                userId: persistedUser.id,
                templateId: sendgridService.confirmationTemplateId,
                status: "SENT",
            });
        } catch (error) {
            await mailLogRepository.insertMailLog({
                userId: persistedUser.id,
                templateId: sendgridService.confirmationTemplateId,
                status: "FAILED",
            });
            throw error;
        }
    })();
}

function processCrmUserDeactivatedUser(payload, { userRepository }) {
    return (async () => {
        let user = await userRepository.findUserByCrmMasterId(payload.id);

        if (!user) {
            user = await userRepository.findUserByEmail(payload.email);
            if (user) {
                await userRepository.setCrmMasterIdByLocalId(
                    user.id,
                    payload.id,
                );
            }
        }

        if (!user) {
            return 0;
        }

        return userRepository.deactivateUserByIdentity({
            id: user.id,
            email: user.email,
        });
    })();
}

function processCrmUserUpdatedUser(payload, { userRepository }) {
    return (async () => {
        const localId = await resolveLocalIdForCrmIdentity(
            payload,
            userRepository,
        );

        await userRepository.upsertUser({
            id: localId,
            crmMasterId: payload.id,
            email: payload.email,
            firstName: payload.firstName,
            lastName: payload.lastName,
            isActive: payload.isActive,
            companyId: payload.companyId,
        });
    })();
}

module.exports = {
    processCrmUserConfirmedUser,
    processCrmUserDeactivatedUser,
    processCrmUserUpdatedUser,
};
