"use strict";

require("dotenv").config();

const db = require("../src/config/database");

async function promoteAdmin() {
    const email = process.argv[2]?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("Usage: npm run admin:promote -- member@example.com");
    }

    const result = await db.query(
        `UPDATE users
         SET role = 'admin', updated_at = NOW()
         WHERE email = $1 AND status = 'active'
         RETURNING id, full_name AS "fullName", email, role`,
        [email]
    );
    if (!result.rowCount) {
        throw new Error("No active account exists for that email. Register it first.");
    }

    await db.query(
        `INSERT INTO audit_logs (actor_id, action, target_type, target_id)
         VALUES ($1, 'user.initial_admin_promoted', 'user', $1)`,
        [result.rows[0].id]
    );
    console.log(`Administrator role assigned to ${result.rows[0].email}.`);
}

promoteAdmin()
    .catch((error) => {
        console.error("Could not promote administrator:", error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            await db.getPool().end();
        } catch (error) {
            if (error.code !== "DATABASE_NOT_CONFIGURED") {
                console.error("Could not close the PostgreSQL pool:", error.message);
                process.exitCode = 1;
            }
        }
    });
