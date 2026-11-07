"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");

let pool;

function getPool() {
    if (!process.env.DATABASE_URL) {
        const error = new Error("DATABASE_URL is not configured. See .env.example.");
        error.code = "DATABASE_NOT_CONFIGURED";
        throw error;
    }

    if (!pool) {
        const max = Number.parseInt(process.env.DB_POOL_MAX || "10", 10);
        if (!Number.isInteger(max) || max < 1 || max > 100) {
            throw new Error("DB_POOL_MAX must be an integer between 1 and 100.");
        }

        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            max,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
            ssl: process.env.DATABASE_SSL === "true"
                ? { rejectUnauthorized: true }
                : undefined
        });

        pool.on("error", (error) => {
            console.error("Unexpected PostgreSQL pool error:", error.message);
        });
    }

    return pool;
}

async function query(text, values) {
    return getPool().query(text, values);
}

async function withTransaction(callback) {
    const client = await getPool().connect();

    try {
        await client.query("BEGIN");
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

async function initializeDatabase() {
    const schema = await fs.readFile(
        path.join(__dirname, "..", "..", "database", "schema.sql"),
        "utf8"
    );
    await query(schema);
}

module.exports = {
    getPool,
    initializeDatabase,
    query,
    withTransaction
};
