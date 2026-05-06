const { getLogger } = require("../services/loggingService");

const logger = getLogger();

/**
 * Processes incoming news warnings.
 * Sends an email notification via SendGrid to the administrator.
 * 
 * @param {Object} payload The parsed Warning payload
 * @param {Object} dependencies Dependencies including sendgridService
 */
async function processNewsWarning(payload, { sendgridService }) {
    const service = payload.service || "unknown-service";
    const rawWarnings = Array.isArray(payload.warnings) ? payload.warnings : (payload.warnings ? [payload.warnings] : []);

    const warnings = rawWarnings.map(w => ({
        timestamp: w.timestamp || new Date().toISOString(),
        issue: w.issue || "No issue description provided"
    }));

    if (warnings.length === 0) {
        logger.info(`Received empty news.warning message from service: ${service}`);
        return;
    }

    logger.warn(`[NewsWarning] Sending warning email for ${warnings.length} issues from service: ${service}`);

    try {
        await sendgridService.sendNewsWarningEmail({
            recipientEmail: "lucas.leonte@student.ehb.be",
            subjectLine: "WAARSCHUWING: Incidenten gedetecteerd!",
            service: service,
            warnings: warnings
        });
    } catch (error) {
        logger.error(`Failed to send news warning email: ${error.message}`);
        throw error;
    }
}

module.exports = {
    processNewsWarning,
};
