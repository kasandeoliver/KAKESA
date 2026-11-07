"use strict";

const db = require("../config/database");

async function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({
            success: false,
            message: "Please sign in to continue."
        });
    }

    try {
        const result = await db.query(
            `SELECT id, full_name AS "fullName", email, role, status
             FROM users
             WHERE id = $1`,
            [req.session.userId]
        );
        const user = result.rows[0];

        if (!user || user.status !== "active") {
            req.session.destroy((error) => {
                if (error) console.error("Could not invalidate inactive-user session:", error.message);
            });
            return res.status(401).json({
                success: false,
                message: "Your session is no longer valid."
            });
        }

        req.user = user;
        next();
    } catch (error) {
        next(error);
    }
}

function requireRoles(...roles) {
    return (req, res, next) => {
        requireAuth(req, res, (error) => {
            if (error) return next(error);
            if (res.headersSent) return;

            if (!roles.includes(req.user.role)) {
                return res.status(403).json({
                    success: false,
                    message: "You do not have permission to perform this action."
                });
            }

            next();
        });
    };
}

module.exports = {
    requireAuth,
    requireRoles
};
