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
    const notifyAllUsersTemplateId = (
        process.env.SENDGRID_NOTIFY_ALL_USERS_TEMPLATE_ID ||
        "d-115dc059ed754b38863f9c5ec06c07ea"
    ).trim();
    const notifySessionTemplateId = (
        process.env.SENDGRID_NOTIFY_SESSION_TEMPLATE_ID ||
        "d-776ded87e0a04501ad73b57088f0fd7b"
    ).trim();
    const sessionUpdatedTemplateId = (
        process.env.SENDGRID_SESSION_UPDATED_TEMPLATE_ID ||
        "d-2b8f72c6d9544f36a40753951139878b"
    ).trim();
    const sessionCanceledTemplateId = (
        process.env.SENDGRID_SESSION_CANCELED_TEMPLATE_ID ||
        "d-99bfd7db77404490bca95f70005a5f4c"
    ).trim();
    const sessionRescheduledTemplateId = (
        process.env.SENDGRID_SESSION_RESCHEDULED_TEMPLATE_ID ||
        "d-33ced75f5e0342d4b8a2b3f573eec23a"
    ).trim();
    const newsWarningTemplateId = (
        process.env.SENDGRID_NEWS_WARNING_TEMPLATE_ID ||
        "d-3f1beae78e2547069a517c9df0f1545a"
    ).trim();

    if (!enabled) {
        return {
            enabled,
            confirmationTemplateId,
            invoiceFinalizedTemplateId,
            notifyAllUsersTemplateId,
            notifySessionTemplateId,
            sessionUpdatedTemplateId,
            sessionCanceledTemplateId,
            sessionRescheduledTemplateId,
            newsWarningTemplateId,
            async sendUserConfirmedEmail() {
                return;
            },
            async sendInvoiceFinalizedEmail() {
                return;
            },
            async sendNotifyAllUsersEmail() {
                return;
            },
            async sendNotifySessionEmail() {
                return;
            },
            async sendSessionUpdatedEmail() {
                return;
            },
            async sendSessionCanceledEmail() {
                return;
            },
            async sendSessionRescheduledEmail() {
                return;
            },
            async sendNewsWarningEmail() {
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

    if (!notifyAllUsersTemplateId) {
        throw new Error(
            "SENDGRID_NOTIFY_ALL_USERS_TEMPLATE_ID is required for news.notify.all emails",
        );
    }

    if (!notifySessionTemplateId) {
        throw new Error(
            "SENDGRID_NOTIFY_SESSION_TEMPLATE_ID is required for news.notify.session emails",
        );
    }

    if (!sessionUpdatedTemplateId) {
        throw new Error(
            "SENDGRID_SESSION_UPDATED_TEMPLATE_ID is required for planning.session.updated emails",
        );
    }

    if (!sessionCanceledTemplateId) {
        throw new Error(
            "SENDGRID_SESSION_CANCELED_TEMPLATE_ID is required for planning.session.cancelled emails",
        );
    }

    if (!sessionRescheduledTemplateId) {
        throw new Error(
            "SENDGRID_SESSION_RESCHEDULED_TEMPLATE_ID is required for planning.session.rescheduled emails",
        );
    }

    if (!newsWarningTemplateId) {
        throw new Error(
            "SENDGRID_NEWS_WARNING_TEMPLATE_ID is required for news.warning emails",
        );
    }

    sgMail.setApiKey(apiKey);

    function formatSendgridError(operation, error) {
        const statusCode =
            error?.code ||
            error?.statusCode ||
            error?.response?.statusCode ||
            error?.response?.body?.errors?.[0]?.status;
        const responseBody = error?.response?.body;
        const details =
            responseBody && typeof responseBody === "object"
                ? JSON.stringify(responseBody)
                : String(error?.message || "Unknown SendGrid error");

        const diagnosticError = new Error(
            `${operation} failed (status=${statusCode || "unknown"}): ${details}`,
        );
        diagnosticError.cause = error;
        diagnosticError.statusCode = statusCode;
        diagnosticError.responseBody = responseBody;
        return diagnosticError;
    }

    async function sendWithDiagnostics(operation, message) {
        try {
            await sgMail.send(message);
        } catch (error) {
            throw formatSendgridError(operation, error);
        }
    }

    function addIcsAttachment(message, icsData) {
        if (!icsData) {
            return message;
        }

        return {
            ...message,
            attachments: [
                ...(message.attachments || []),
                {
                    content: icsData,
                    filename: "invite.ics",
                    type: "text/calendar",
                    disposition: "attachment",
                },
            ],
        };
    }

    async function sendUserConfirmedEmail(user) {
        await sendWithDiagnostics("sendUserConfirmedEmail", {
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

        await sendWithDiagnostics("sendInvoiceFinalizedEmail", {
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

    async function sendNotifyAllUsersEmail(update) {
        await sendWithDiagnostics("sendNotifyAllUsersEmail", {
            to: update.recipientEmail,
            from: fromEmail,
            templateId: notifyAllUsersTemplateId,
            dynamicTemplateData: {
                subjectLine: update.subjectLine || "",
                updateType: update.updateType || "",
                message: update.message || "",
            },
        });
    }

    async function sendNotifySessionEmail(payload) {
        const message = {
            to: payload.recipientEmail,
            from: fromEmail,
            templateId: notifySessionTemplateId,
            dynamicTemplateData: {
                sessionId: payload.sessionId || "",
                sessionName: payload.sessionName || "",
                subjectLine: payload.subjectLine || "",
                message: payload.message || "",
            },
        };

        await sendWithDiagnostics(
            "sendNotifySessionEmail",
            addIcsAttachment(message, payload.icsData),
        );
    }

    async function sendSessionUpdatedEmail(payload) {
        const message = {
            to: payload.recipientEmail,
            from: fromEmail,
            templateId: sessionUpdatedTemplateId,
            dynamicTemplateData: {
                sessionId: payload.sessionId || "",
                sessionName: payload.sessionName || "",
                changeType: payload.changeType || "",
                newTime: payload.newTime || "",
                newLocation: payload.newLocation || "",
                timestamp: payload.timestamp || "",
            },
        };

        await sendWithDiagnostics(
            "sendSessionUpdatedEmail",
            addIcsAttachment(message, payload.icsData),
        );
    }

    async function sendSessionCanceledEmail(payload) {
        const message = {
            to: payload.recipientEmail,
            from: fromEmail,
            templateId: sessionCanceledTemplateId,
            dynamicTemplateData: {
                sessionId: payload.sessionId || "",
                sessionName: payload.sessionName || "",
                status: payload.status || "",
                reason: payload.reason || "",
                timestamp: payload.timestamp || "",
            },
        };

        await sendWithDiagnostics(
            "sendSessionCanceledEmail",
            addIcsAttachment(message, payload.icsData),
        );
    }

    async function sendSessionRescheduledEmail(payload) {
        const message = {
            to: payload.recipientEmail,
            from: fromEmail,
            templateId: sessionRescheduledTemplateId,
            dynamicTemplateData: {
                sessionId: payload.sessionId || "",
                sessionName: payload.sessionName || "",
                oldDate: payload.oldDate || "",
                oldStartTime: payload.oldStartTime || "",
                oldEndTime: payload.oldEndTime || "",
                newDate: payload.newDate || "",
                newStartTime: payload.newStartTime || "",
                newEndTime: payload.newEndTime || "",
                newLocation: payload.newLocation || "",
                reason: payload.reason || "",
                timestamp: payload.timestamp || "",
            },
        };

        await sendWithDiagnostics(
            "sendSessionRescheduledEmail",
            addIcsAttachment(message, payload.icsData),
        );
    }

    async function sendNewsWarningEmail(payload) {
        await sendWithDiagnostics("sendNewsWarningEmail", {
            to: payload.recipientEmail,
            from: fromEmail,
            templateId: newsWarningTemplateId,
            dynamicTemplateData: {
                subject_line: payload.subjectLine || "WAARSCHUWING: Incidenten gedetecteerd!",
                service: payload.service || "",
                warnings: payload.warnings || [],
            },
        });
    }

    return {
        enabled,
        confirmationTemplateId,
        invoiceFinalizedTemplateId,
        notifyAllUsersTemplateId,
        notifySessionTemplateId,
        sessionUpdatedTemplateId,
        sessionCanceledTemplateId,
        sessionRescheduledTemplateId,
        sendUserConfirmedEmail,
        sendInvoiceFinalizedEmail,
        sendNotifyAllUsersEmail,
        sendNotifySessionEmail,
        sendSessionUpdatedEmail,
        sendSessionCanceledEmail,
        sendSessionRescheduledEmail,
        sendNewsWarningEmail,
    };
}

module.exports = {
    createSendgridService,
};
