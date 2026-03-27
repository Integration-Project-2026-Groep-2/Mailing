const sgMail = require("@sendgrid/mail");

function parseBoolean(value, defaultValue = true) {
    if (value === undefined || value === null || value === "") {
        return defaultValue;
    }

    return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function createSendgridService() {
    const enabled = parseBoolean(process.env.SENDGRID_ENABLED, true);
    const apiKey = (process.env.SENDGRID_API_KEY || "").trim();
    const fromEmail = (process.env.SENDGRID_FROM_EMAIL || "").trim();
    const confirmationTemplateId = (
        process.env.SENDGRID_USER_CONFIRMED_TEMPLATE_ID || ""
    ).trim();

    if (!enabled) {
        return {
            enabled,
            confirmationTemplateId,
            async sendUserConfirmedEmail() {
                return;
            },
        };
    }

    if (!apiKey.startsWith("SG.")) {
        throw new Error(
            "SENDGRID_API_KEY is missing or malformed; expected key starting with 'SG.'",
        );
    }

    if (!fromEmail) {
        throw new Error(
            "SENDGRID_FROM_EMAIL is required when SENDGRID_ENABLED=true",
        );
    }

    if (!confirmationTemplateId) {
        throw new Error(
            "SENDGRID_USER_CONFIRMED_TEMPLATE_ID is required for crm.user.confirmed emails",
        );
    }

    sgMail.setApiKey(apiKey);

    async function sendUserConfirmedEmail(user) {
        await sgMail.send({
            to: user.email,
            from: fromEmail,
            templateId: confirmationTemplateId,
            dynamicTemplateData: {
                id: user.id,
                email: user.email,
                first_name: user.firstName || "",
                last_name: user.lastName || "",
                company_id: user.companyId || "",
                gdpr_consent: user.gdprConsent,
                confirmed_at: user.confirmedAt || "",
            },
        });
    }

    return {
        enabled,
        confirmationTemplateId,
        sendUserConfirmedEmail,
    };
}

module.exports = {
    createSendgridService,
};
