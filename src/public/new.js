const createForm = document.getElementById("create-form");
const createStatusEl = document.getElementById("create-status");

createForm.addEventListener("submit", (event) => {
    event.preventDefault();
    createStatusEl.textContent = "Create action is not implemented yet.";
});
