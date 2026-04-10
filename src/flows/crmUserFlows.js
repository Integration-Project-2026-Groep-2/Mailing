function processCrmUserConfirmedUser(
    rawUser,
    { userRepository, mailLogRepository, sendgridService },
) {
    return (async () => {
        const existingByEmail = await userRepository.findUserByEmail(
            rawUser.email,
        );
        if (existingByEmail && existingByEmail.id !== rawUser.id) {
            const existingByCrmId = await userRepository.findUserById(
                rawUser.id,
            );
            if (!existingByCrmId) {
                await userRepository.replaceUserId(
                    existingByEmail.id,
                    rawUser.id,
                );
            }
        }

        const persistedUser = await userRepository.upsertUser(rawUser);

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
        const existingByEmail = await userRepository.findUserByEmail(
            payload.email,
        );
        if (existingByEmail && existingByEmail.id !== payload.id) {
            const existingByCrmId = await userRepository.findUserById(
                payload.id,
            );
            if (!existingByCrmId) {
                await userRepository.replaceUserId(
                    existingByEmail.id,
                    payload.id,
                );
            }
        }

        return userRepository.deactivateUserByIdentity({
            id: payload.id,
            email: payload.email,
        });
    })();
}

function processCrmUserUpdatedUser(payload, { userRepository }) {
    return (async () => {
        const existingByEmail = await userRepository.findUserByEmail(
            payload.email,
        );
        if (existingByEmail && existingByEmail.id !== payload.id) {
            const existingByCrmId = await userRepository.findUserById(
                payload.id,
            );
            if (!existingByCrmId) {
                await userRepository.replaceUserId(
                    existingByEmail.id,
                    payload.id,
                );
            }
        }

        await userRepository.upsertUser({
            id: payload.id,
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
