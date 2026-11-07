"use strict";

require("dotenv").config();

const app = require("./index");
const db = require("./src/config/database");

const PORT = Number.parseInt(process.env.PORT || "3000", 10);

async function startServer() {
    if (process.env.DATABASE_URL) {
        try {
            await db.initializeDatabase();
            console.log("KAKESA PostgreSQL schema is ready.");
        } catch (error) {
            console.error(
                "PostgreSQL initialization failed:",
                error.code || error.name,
                error.message
            );
            console.error("The web server will start, but database-backed APIs will return an error.");
        }
    } else {
        console.warn("Set DATABASE_URL in .env to enable accounts, meetings and minutes.");
    }

    app.listen(PORT, () => {
        console.log(`KAKESA running at http://localhost:${PORT}`);
    });
}

startServer();
