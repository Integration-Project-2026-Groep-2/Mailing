function processInvoiceFinalized(
    payload,
    { mailLogRepository, sendgridService },
) {
    return (async () => {
        try {
            await sendgridService.sendInvoiceFinalizedEmail(payload);
            await mailLogRepository.insertMailLog({
                userId: null,
                templateId: sendgridService.invoiceFinalizedTemplateId,
                status: "SENT",
            });
        } catch (error) {
            await mailLogRepository.insertMailLog({
                userId: null,
                templateId: sendgridService.invoiceFinalizedTemplateId,
                status: "FAILED",
            });
            throw error;
        }
    })();
}

module.exports = {
    processInvoiceFinalized,
};
