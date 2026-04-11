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
        process.env.SENDGRID_USER_CONFIRMED_TEMPLATE_ID ||
        "d-13e4548a8ebc4c19a738878b8d3bf9a8"
    ).trim();
    const invoiceFinalizedTemplateId = (
        process.env.SENDGRID_INVOICE_FINALIZED_TEMPLATE_ID ||
        "d-6046aa6c0e3349fdb0df5bedf7dad483"
    ).trim();

    if (!enabled) {
        return {
            enabled,
            confirmationTemplateId,
            invoiceFinalizedTemplateId,
            async sendUserConfirmedEmail() {
                return;
            },
            async sendInvoiceFinalizedEmail() {
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

    if (!invoiceFinalizedTemplateId) {
        throw new Error(
            "SENDGRID_INVOICE_FINALIZED_TEMPLATE_ID is required for invoice.finalized emails",
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
                is_active: user.isActive,
                confirmed_at: user.confirmedAt || "",
            },
        });
    }

    async function sendInvoiceFinalizedEmail(invoice) {
        const invoiceNumber = invoice.invoiceNumber || "";
        const recipientEmail = invoice.recipientEmail || "";
        const pdfUrl = invoice.pdfUrl || "";
        const totalAmount = String(invoice.totalAmount ?? "");
        const invoiceType = invoice.type || "";

        await sgMail.send({
            to: recipientEmail,
            from: fromEmail,
            templateId: invoiceFinalizedTemplateId,
            dynamicTemplateData: {
                invoiceNumber,
                recipientEmail,
                pdfUrl,
                totalAmount,
                type: invoiceType,
            },
        });
    }

    return {
        enabled,
        confirmationTemplateId,
        invoiceFinalizedTemplateId,
        sendUserConfirmedEmail,
        sendInvoiceFinalizedEmail,
    };
}

module.exports = {
    createSendgridService,
};
