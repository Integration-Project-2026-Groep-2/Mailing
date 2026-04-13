const form = document.getElementById("notify-form");
const statusEl = document.getElementById("notify-status");
const sendBtn = document.getElementById("send-btn");

function setStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.classList.toggle("error-state", Boolean(isError));
}

async function submitNotifyAllUsers(event) {
    event.preventDefault();

    const formData = new FormData(form);
    const payload = {
        subjectLine: String(formData.get("subjectLine") || "").trim(),
        updateType: String(formData.get("updateType") || "").trim(),
        message: String(formData.get("message") || "").trim(),
    };

    if (!payload.subjectLine || !payload.updateType || !payload.message) {
        setStatus("All fields are required.", true);
        return;
    }

    sendBtn.disabled = true;
    setStatus("Sending e-mail to all active users...");

    try {
        const response = await fetch("/admin/notify-all-users", {
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

        const recipients = Number(responseBody.recipients || 0);
        setStatus(`Broadcast started for ${recipients} active users.`);
        form.reset();
    } catch (error) {
        setStatus(`Failed to send: ${error.message}`, true);
    } finally {
        sendBtn.disabled = false;
    }
}

form.addEventListener("submit", submitNotifyAllUsers);
