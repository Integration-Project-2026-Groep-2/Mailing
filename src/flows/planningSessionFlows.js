async function sendToParticipant(
    participantId,
    payload,
    templateId,
    sendEmail,
    { userRepository, mailLogRepository },
) {
    const user = await userRepository.findUserById(participantId);
    if (!user || !user.email || user.isActive === false) {
        return;
    }

    try {
        await sendEmail({
            recipientEmail: user.email,
            ...payload,
        });
        await mailLogRepository.insertMailLog({
            userId: user.id,
            templateId,
            status: "SENT",
        });
    } catch (error) {
        await mailLogRepository.insertMailLog({
            userId: user.id,
            templateId,
            status: "FAILED",
        });
        throw error;
    }
}

async function processParticipants(
    payload,
    templateId,
    sendEmail,
    { userRepository, mailLogRepository },
) {
    const participantIds = Array.isArray(payload.participantIds)
        ? payload.participantIds
        : [];

    for (const participantId of participantIds) {
        try {
            await sendToParticipant(
                participantId,
                payload,
                templateId,
                sendEmail,
                {
                    userRepository,
                    mailLogRepository,
                },
            );
        } catch (error) {
            console.error("Failed sending planning email", {
                participantId,
                sessionId: payload.sessionId,
                errorMessage: error.message,
            });
        }
    }
}

async function processSessionUpdated(
    payload,
    { userRepository, mailLogRepository, sendgridService },
) {
    await processParticipants(
        payload,
        sendgridService.sessionUpdatedTemplateId,
        sendgridService.sendSessionUpdatedEmail,
        {
            userRepository,
            mailLogRepository,
        },
    );
}

async function processSessionCancelled(
    payload,
    { userRepository, mailLogRepository, sendgridService },
) {
    await processParticipants(
        payload,
        sendgridService.sessionCanceledTemplateId,
        sendgridService.sendSessionCanceledEmail,
        {
            userRepository,
            mailLogRepository,
        },
    );
}

async function processSessionRescheduled(
    payload,
    { userRepository, mailLogRepository, sendgridService },
) {
    await processParticipants(
        payload,
        sendgridService.sessionRescheduledTemplateId,
        sendgridService.sendSessionRescheduledEmail,
        {
            userRepository,
            mailLogRepository,
        },
    );
}

module.exports = {
    processSessionUpdated,
    processSessionCancelled,
    processSessionRescheduled,
};
