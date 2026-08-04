import { Pool } from "pg";
import { migrateDatabase, poolConfigFromEnvironment, verifyDatabase } from "./migrations.js";

const command = process.argv[2];
if (command !== "migrate" && command !== "verify") {
  console.error("Usage: database-cli <migrate|verify>");
  process.exitCode = 2;
} else {
  const pool = new Pool(poolConfigFromEnvironment());
  try {
    if (command === "migrate") {
      const result = await migrateDatabase(pool);
      console.log(JSON.stringify(result));
    } else {
      await verifyDatabase(pool);
      console.log(JSON.stringify({ verified: true }));
    }
  } finally {
    await pool.end();
  }
}
