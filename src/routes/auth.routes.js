"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const db = require("../config/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many sign-in attempts. Please wait and try again."
    }
});

function completeLogin(req, res, user, statusCode = 200) {
    req.session.regenerate((error) => {
        if (error) return res.status(500).json({
            success: false,
            message: "Could not start your session."
        });

        req.session.userId = String(user.id);
        req.session.save((saveError) => {
            if (saveError) return res.status(500).json({
                success: false,
                message: "Could not save your session."
            });

            res.status(statusCode).json({
                success: true,
                message: statusCode === 201
                    ? "Account created successfully."
                    : "Login successful.",
                user: {
                    id: user.id,
                    fullName: user.fullName,
                    email: user.email,
                    role: user.role
                }
            });
        });
    });
}

router.post("/register", authLimiter, async (req, res, next) => {
    const fullName = typeof req.body.fullName === "string"
        ? req.body.fullName.trim()
        : "";
    const email = typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    const password = typeof req.body.password === "string"
        ? req.body.password
        : "";

    if (fullName.length < 2 || fullName.length > 150) {
        return res.status(400).json({
            success: false,
            message: "Enter a name between 2 and 150 characters."
        });
    }
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({
            success: false,
            message: "Enter a valid email address."
        });
    }
    if (password.length < 10 || password.length > 128) {
        return res.status(400).json({
            success: false,
            message: "Password must be between 10 and 128 characters."
        });
    }

    try {
        const passwordHash = await bcrypt.hash(password, 12);
        const result = await db.query(
            `INSERT INTO users (full_name, email, password_hash)
             VALUES ($1, $2, $3)
             RETURNING id, full_name AS "fullName", email, role`,
            [fullName, email, passwordHash]
        );
        completeLogin(req, res, result.rows[0], 201);
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({
                success: false,
                message: "An account with this email already exists."
            });
        }
        next(error);
    }
});

router.post("/login", authLimiter, async (req, res, next) => {
    const email = typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    const password = typeof req.body.password === "string"
        ? req.body.password
        : "";

    if (!email || !password) {
        return res.status(400).json({
            success: false,
            message: "Enter your email and password."
        });
    }

    try {
        const result = await db.query(
            `SELECT id, full_name AS "fullName", email, password_hash, role
             FROM users
             WHERE email = $1 AND status = 'active'`,
            [email]
        );
        const user = result.rows[0];
        const valid = user
            ? await bcrypt.compare(password, user.password_hash)
            : false;

        if (!valid) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });
        }

        delete user.password_hash;
        completeLogin(req, res, user);
    } catch (error) {
        next(error);
    }
});

router.get("/me", requireAuth, (req, res) => {
    res.json({
        success: true,
        user: req.user
    });
});

router.post("/logout", (req, res) => {
    if (!req.session) {
        return res.json({ success: true, message: "You have logged out." });
    }

    req.session.destroy((error) => {
        if (error) {
            return res.status(500).json({
                success: false,
                message: "Could not log out."
            });
        }
        res.clearCookie("kakesa.sid");
        res.json({ success: true, message: "You have logged out." });
    });
});

module.exports = router;
