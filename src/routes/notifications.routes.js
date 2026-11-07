"use strict";

const express = require("express");
const db = require("../config/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, async (req, res, next) => {
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    try {
        const [notifications, unread] = await Promise.all([
            db.query(
                `SELECT id, message, is_read AS "isRead", created_at AS "createdAt"
                 FROM notifications
                 WHERE user_id = $1
                 ORDER BY created_at DESC, id DESC
                 LIMIT $2`,
                [req.user.id, limit]
            ),
            db.query(
                `SELECT COUNT(*)::INTEGER AS total
                 FROM notifications
                 WHERE user_id = $1 AND is_read = FALSE`,
                [req.user.id]
            )
        ]);
        res.json({
            success: true,
            notifications: notifications.rows,
            unreadCount: unread.rows[0].total
        });
    } catch (error) {
        next(error);
    }
});

router.patch("/:id/read", requireAuth, async (req, res, next) => {
    const rawId = req.params.id;
    const id = /^\d+$/.test(rawId) ? Number(rawId) : null;
    if (!Number.isSafeInteger(id) || id < 1) {
        return res.status(400).json({
            success: false,
            message: "Invalid notification ID."
        });
    }
    try {
        const result = await db.query(
            `UPDATE notifications SET is_read = TRUE
             WHERE id = $1 AND user_id = $2
             RETURNING id, is_read AS "isRead"`,
            [id, req.user.id]
        );
        if (!result.rowCount) {
            return res.status(404).json({
                success: false,
                message: "Notification not found."
            });
        }
        res.json({ success: true, notification: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
