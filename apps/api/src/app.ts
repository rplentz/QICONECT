import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { healthRouter } from "./routes/health.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { clinicRouter } from "./routes/clinic.routes.js";
import { patientRouter } from "./routes/patient.routes.js";
import { appointmentRouter } from "./routes/appointment.routes.js";
import { recordRouter } from "./routes/record.routes.js";
import { registrationRouter } from "./routes/registration.routes.js";
import { encounterRouter } from "./routes/encounter.routes.js";

export const app = express();

app.disable("x-powered-by");
app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
app.use(express.json({ limit: "16mb" }));

app.use("/api/v1/health", healthRouter);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1", clinicRouter);
app.use("/api/v1", patientRouter);
app.use("/api/v1", appointmentRouter);
app.use("/api/v1", recordRouter);
app.use("/api/v1", registrationRouter);
app.use("/api/v1", encounterRouter);

app.use(notFoundHandler);
app.use(errorHandler);
