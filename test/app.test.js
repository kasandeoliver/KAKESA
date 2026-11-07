"use strict";

const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
const app = require("../index");

let server;
let baseUrl;

before(async () => {
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
});

test("serves the KAKESA homepage with security headers", async () => {
    const response = await fetch(baseUrl);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /KAKESA/);
    assert.ok(response.headers.has("content-security-policy"));
});

test("serves workspace pages and their shared assets", async () => {
    for (const resource of [
        "/dashboard.html",
        "/pages/meetings.html",
        "/pages/members.html",
        "/pages/minutes.html",
        "/assets/css/style.css",
        "/assets/js/workspace.js"
    ]) {
        const response = await fetch(`${baseUrl}${resource}`);
        assert.equal(response.status, 200, `${resource} should be served`);
    }
});

test("health endpoint reports database configuration status explicitly", async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();

    assert.ok([200, 503].includes(response.status));
    assert.equal(body.application, "KAKESA");
    assert.ok(["connected", "not_configured", "unavailable"].includes(body.database));
});

test("registration validates input before database access", async () => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: "A", email: "not-an-email", password: "short" })
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.success, false);
});

test("member APIs require an authenticated session", async () => {
    const response = await fetch(`${baseUrl}/api/users`);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.success, false);
});

test("mutating API requests reject a different Origin", async () => {
    const response = await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: { Origin: "https://example.invalid" }
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.success, false);
});

test("mutating APIs reject non-object request bodies", async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([])
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.success, false);
});
