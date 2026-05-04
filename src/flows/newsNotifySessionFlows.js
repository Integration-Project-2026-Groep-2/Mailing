const { getLogger } = require("../services/loggingService");

const logger = getLogger();

async function sendToParticipant(
    participantId,
    payload,
    { userRepository, mailLogRepository, sendgridService },
) {
    const user =
        (await userRepository.findUserByCrmMasterId(participantId)) ||
        (await userRepository.findUserById(participantId));
    if (!user || !user.email || user.isActive === false) {
        return;
    }

    try {
        await sendgridService.sendNotifySessionEmail({
            recipientEmail: user.email,
            sessionId: payload.sessionId,
            sessionName: payload.sessionName,
            subjectLine: payload.subjectLine,
            message: payload.message,
        });
        await mailLogRepository.insertMailLog({
            userId: user.id,
            templateId: sendgridService.notifySessionTemplateId,
            status: "SENT",
        });
    } catch (error) {
        await mailLogRepository.insertMailLog({
            userId: user.id,
            templateId: sendgridService.notifySessionTemplateId,
            status: "FAILED",
        });
        throw error;
    }
}

async function processNotifySession(
    payload,
    { userRepository, mailLogRepository, sendgridService },
) {
    const participantIds = Array.isArray(payload.participantIds)
        ? payload.participantIds
        : [];

    for (const participantId of participantIds) {
        try {
            await sendToParticipant(participantId, payload, {
                userRepository,
                mailLogRepository,
                sendgridService,
            });
        } catch (error) {
            logger.error(`Failed sending notify-session email to participant ${participantId} for session ${payload.sessionId}: ${error.message}`);
        }
    }
}

module.exports = {
    processNotifySession,
};
