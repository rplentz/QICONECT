import { app } from "./app.js";
import { env } from "./config/env.js";
import { seedDemoData } from "./db/seed.js";

try {
  if (env.NODE_ENV === "development") {
    await seedDemoData();
  } else {
    throw new Error("Production clinic provisioning is not implemented; demo accounts are development-only.");
  }
  app.listen(env.API_PORT, () => {
    console.log(`QIConect API listening on port ${env.API_PORT}`);
  });
} catch (error) {
  console.error("Failed to start QIConect API:", error);
  process.exitCode = 1;
}
