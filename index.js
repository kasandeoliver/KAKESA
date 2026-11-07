"use strict";

require("dotenv").config();

const path = require("node:path");
const express = require("express");
const session = require("express-session");
const connectPgSimple = require("connect-pg-simple");
const helmet = require("helmet");
const db = require("./src/config/database");

const app = express();
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
    throw new Error("SESSION_SECRET must contain at least 32 characters in production.");
}

app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "true") {
    app.set("trust proxy", 1);
}

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            "default-src": ["'self'"],
            "font-src": ["'self'", "https://fonts.gstatic.com"],
            "style-src": ["'self'", "https://fonts.googleapis.com"],
            "img-src": ["'self'", "data:"],
            "connect-src": ["'self'"],
            "script-src": ["'self'"],
            "object-src": ["'none'"],
            "upgrade-insecure-requests": isProduction ? [] : null
        }
    }
}));

app.use(express.json({ limit: "1mb" }));

const sessionOptions = {
    name: "kakesa.sid",
    secret: process.env.SESSION_SECRET || "development-only-change-this-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: isProduction,
        maxAge: 8 * 60 * 60 * 1000
    }
};

if (process.env.DATABASE_URL) {
    const PgSession = connectPgSimple(session);
    sessionOptions.store = new PgSession({
        pool: db.getPool(),
        tableName: "user_sessions",
        createTableIfMissing: true,
        pruneSessionInterval: 15 * 60
    });
} else if (isProduction) {
    throw new Error("DATABASE_URL must be set in production.");
} else {
    console.warn("DATABASE_URL is not configured; database-backed APIs will be unavailable.");
}

app.use(session(sessionOptions));
app.use(express.static(path.join(__dirname, "public")));

app.use("/api", (req, res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    const origin = req.get("origin");
    if (!origin) return next();

    try {
        const requestOrigin = new URL(origin).origin;
        const expectedOrigin = process.env.APP_ORIGIN
            ? new URL(process.env.APP_ORIGIN).origin
            : `${req.protocol}://${req.get("host")}`;
        if (requestOrigin !== expectedOrigin) {
            return res.status(403).json({
                success: false,
                message: "Cross-origin requests are not allowed."
            });
        }
        next();
    } catch (error) {
        next(error);
    }
});

app.use("/api", (req, res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    if (req.path === "/auth/logout") return next();
    if (!req.is("application/json") || !req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        return res.status(400).json({
            success: false,
            message: "Send request data as a JSON object."
        });
    }
    next();
});

app.get("/api/health", async (req, res) => {
    try {
        await db.query("SELECT 1");
        res.status(200).json({
            success: true,
            application: "KAKESA",
            database: "connected"
        });
    } catch (error) {
        const notConfigured = error.code === "DATABASE_NOT_CONFIGURED";
        res.status(503).json({
            success: false,
            application: "KAKESA",
            database: notConfigured ? "not_configured" : "unavailable",
            message: notConfigured
                ? "Configure DATABASE_URL using .env.example."
                : "PostgreSQL is unavailable. Check DATABASE_URL and the database service."
        });
    }
});

app.use("/api/auth", require("./src/routes/auth.routes"));
app.use("/api/users", require("./src/routes/users.routes"));
app.use("/api/meetings", require("./src/routes/meetings.routes"));
app.use("/api/notifications", require("./src/routes/notifications.routes"));

app.use("/api", (req, res) => {
    res.status(404).json({
        success: false,
        message: "API endpoint not found."
    });
});

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    console.error("Request failed:", error.code || error.name, error.message);
    if (error.code === "DATABASE_NOT_CONFIGURED") {
        return res.status(503).json({
            success: false,
            message: "PostgreSQL is not configured. Follow the setup steps in README.md."
        });
    }
    if (error.code === "23503" || error.code === "23514") {
        return res.status(400).json({
            success: false,
            message: "One or more submitted values are invalid."
        });
    }
    res.status(500).json({
        success: false,
        message: "The request could not be completed."
    });
});

module.exports = app;
