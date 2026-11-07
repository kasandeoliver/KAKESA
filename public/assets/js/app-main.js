"use strict";

const modal = document.getElementById("authModal");
const loginPanel = document.getElementById("loginPanel");
const registerPanel = document.getElementById("registerPanel");
const formMessage = document.getElementById("formMessage");

document.getElementById("year").textContent = new Date().getFullYear();

function showMessage(message, type = "") {
    formMessage.textContent = message;
    formMessage.className = `form-message ${type}`;
}

function openLogin() {
    modal.classList.add("show");
    loginPanel.classList.remove("hidden");
    registerPanel.classList.add("hidden");
    showMessage("");
}

function openRegister() {
    modal.classList.add("show");
    loginPanel.classList.add("hidden");
    registerPanel.classList.remove("hidden");
    showMessage("");
}

document.getElementById("openLogin").addEventListener("click", openLogin);
document.getElementById("openRegister").addEventListener("click", openRegister);
document.getElementById("heroRegister").addEventListener("click", openRegister);
document.getElementById("closeModal").addEventListener(
    "click",
    () => modal.classList.remove("show")
);
document.getElementById("showRegister").addEventListener("click", openRegister);
document.getElementById("showLogin").addEventListener("click", openLogin);

modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.classList.remove("show");
});

async function submitAuthForm(event, endpoint, getPayload) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector("button[type='submit']");
    submitButton.disabled = true;

    try {
        showMessage(endpoint.endsWith("register") ? "Creating your account..." : "Signing you in...");
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify(getPayload(form))
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "The request could not be completed.");

        showMessage(result.message, "success");
        form.reset();
        window.location.assign("/dashboard.html");
    } catch (error) {
        showMessage(error.message || "Could not connect to KAKESA.", "error");
    } finally {
        submitButton.disabled = false;
    }
}

document.getElementById("registerForm").addEventListener("submit", (event) =>
    submitAuthForm(event, "/api/auth/register", (form) => ({
        fullName: form.fullName.value.trim(),
        email: form.email.value.trim(),
        password: form.password.value
    }))
);

document.getElementById("loginForm").addEventListener("submit", (event) =>
    submitAuthForm(event, "/api/auth/login", (form) => ({
        email: form.email.value.trim(),
        password: form.password.value
    }))
);

document.getElementById("mobileMenu").addEventListener("click", () => {
    document.querySelector(".nav-links").classList.toggle("menu-open");
});
