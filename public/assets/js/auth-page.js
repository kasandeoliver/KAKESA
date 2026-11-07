"use strict";

const authForm = document.getElementById("authForm");
const authMessage = document.getElementById("authMessage");

authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = authForm.querySelector("button[type='submit']");
    button.disabled = true;
    authMessage.textContent = "Please wait...";

    const payload = Object.fromEntries(new FormData(authForm));
    const endpoint = authForm.dataset.mode === "register"
        ? "/api/auth/register"
        : "/api/auth/login";

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "Authentication failed.");
        window.location.assign("/dashboard.html");
    } catch (error) {
        authMessage.textContent = error.message || "Could not connect to KAKESA.";
        authMessage.className = "form-message error";
    } finally {
        button.disabled = false;
    }
});
