const createForm = document.getElementById("create-form");
const createStatusEl = document.getElementById("create-status");

function normalizeOptional(value) {
    const normalized = value.trim();
    return normalized === "" ? null : normalized;
}

createForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(createForm);
    const payload = {
        email: String(formData.get("email") || "").trim(),
        firstName: normalizeOptional(String(formData.get("firstName") || "")),
        lastName: normalizeOptional(String(formData.get("lastName") || "")),
        gdprConsent: String(formData.get("gdprConsent") || "false") === "true",
        companyId: normalizeOptional(String(formData.get("companyId") || "")),
    };

    createStatusEl.textContent = "Creating user and publishing sync event...";
    createStatusEl.classList.remove("error-state");

    try {
        const response = await fetch("/users", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        const responseBody = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(
                responseBody.error || `Request failed (${response.status})`,
            );
        }

        const createdUser = responseBody.user;
        createStatusEl.textContent = `Created locally for ${createdUser.email}. CRM reconciliation is pending.`;
        createForm.reset();
    } catch (error) {
        createStatusEl.textContent = `Failed to create user: ${error.message}`;
        createStatusEl.classList.add("error-state");
    }
});
