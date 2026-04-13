async function sendToUser(
    user,
    payload,
    { mailLogRepository, sendgridService },
) {
    try {
        await sendgridService.sendNotifyAllUsersEmail({
            recipientEmail: user.email,
            subjectLine: payload.subjectLine,
            updateType: payload.updateType,
            message: payload.message,
        });
        await mailLogRepository.insertMailLog({
            userId: user.id,
            templateId: sendgridService.notifyAllUsersTemplateId,
            status: "SENT",
        });
    } catch (error) {
        await mailLogRepository.insertMailLog({
            userId: user.id,
            templateId: sendgridService.notifyAllUsersTemplateId,
            status: "FAILED",
        });
        throw error;
    }
}

async function processNotifyAllUsers(
    payload,
    { userRepository, mailLogRepository, sendgridService },
) {
    const activeUsers = await userRepository.findActiveUsers();

    for (const user of activeUsers) {
        try {
            await sendToUser(user, payload, {
                mailLogRepository,
                sendgridService,
            });
        } catch (error) {
            console.error("Failed sending notify-all-users email", {
                userId: user.id,
                recipientEmail: user.email,
                errorMessage: error.message,
            });
        }
    }
}

module.exports = {
    processNotifyAllUsers,
};
