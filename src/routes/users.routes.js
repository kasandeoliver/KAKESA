"use strict";

const express = require("express");
const db = require("../config/database");
const { requireRoles } = require("../middleware/auth");

const router = express.Router();
const roles = ["admin", "chairperson", "secretary", "member"];

function parseId(value) {
    if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

router.get("/", requireRoles("admin", "chairperson", "secretary"), async (req, res, next) => {
    const search = typeof req.query.search === "string"
        ? req.query.search.trim().slice(0, 100)
        : "";
    const requestedPage = Number.parseInt(req.query.page, 10);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? Math.min(requestedPage, 1000000)
        : 1;
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;

    try {
        const [users, total] = await Promise.all([
            db.query(
                `SELECT id, full_name AS "fullName", email, role, status,
                        created_at AS "createdAt"
                 FROM users
                 WHERE ($1 = '' OR LOWER(full_name) LIKE LOWER($1) || '%'
                        OR LOWER(email) LIKE LOWER($1) || '%')
                 ORDER BY created_at DESC, id DESC
                 LIMIT $2 OFFSET $3`,
                [search, limit, offset]
            ),
            db.query(
                `SELECT COUNT(*)::INTEGER AS total
                 FROM users
                 WHERE ($1 = '' OR LOWER(full_name) LIKE LOWER($1) || '%'
                        OR LOWER(email) LIKE LOWER($1) || '%')`,
                [search]
            )
        ]);

        res.json({
            success: true,
            users: users.rows,
            pagination: { page, limit, total: total.rows[0].total }
        });
    } catch (error) {
        next(error);
    }
});

router.patch("/:id/role", requireRoles("admin"), async (req, res, next) => {
    const id = parseId(req.params.id);
    const role = req.body.role;

    if (!Number.isSafeInteger(id) || id < 1 || !roles.includes(role)) {
        return res.status(400).json({
            success: false,
            message: "A valid user ID and role are required."
        });
    }
    if (id === Number(req.user.id) && role !== "admin") {
        return res.status(400).json({
            success: false,
            message: "You cannot remove your own administrator role."
        });
    }

    try {
        const user = await db.withTransaction(async (client) => {
            const result = await client.query(
                `UPDATE users
                 SET role = $1, updated_at = NOW()
                 WHERE id = $2
                 RETURNING id, full_name AS "fullName", email, role, status`,
                [role, id]
            );
            if (!result.rowCount) return null;
            await client.query(
                `INSERT INTO audit_logs (actor_id, action, target_type, target_id)
                 VALUES ($1, 'user.role_changed', 'user', $2)`,
                [req.user.id, id]
            );
            return result.rows[0];
        });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "Member not found."
            });
        }
        res.json({ success: true, user });
    } catch (error) {
        next(error);
    }
});

router.patch("/:id/status", requireRoles("admin"), async (req, res, next) => {
    const id = parseId(req.params.id);
    const status = req.body.status;

    if (!Number.isSafeInteger(id) || id < 1 || !["active", "suspended"].includes(status)) {
        return res.status(400).json({
            success: false,
            message: "A valid user ID and account status are required."
        });
    }
    if (id === Number(req.user.id) && status !== "active") {
        return res.status(400).json({
            success: false,
            message: "You cannot suspend your own account."
        });
    }

    try {
        const user = await db.withTransaction(async (client) => {
            const result = await client.query(
                `UPDATE users
                 SET status = $1, updated_at = NOW()
                 WHERE id = $2
                 RETURNING id, full_name AS "fullName", email, role, status`,
                [status, id]
            );
            if (!result.rowCount) return null;
            await client.query(
                `INSERT INTO audit_logs (actor_id, action, target_type, target_id)
                 VALUES ($1, 'user.status_changed', 'user', $2)`,
                [req.user.id, id]
            );
            return result.rows[0];
        });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "Member not found."
            });
        }
        res.json({ success: true, user });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
