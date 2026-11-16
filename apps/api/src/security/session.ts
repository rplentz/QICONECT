import { createHash, randomBytes } from "node:crypto";
import type { Response } from "express";
import { env } from "../config/env.js";

export const SESSION_COOKIE = "qiconect_session";
export const sessionExpiry = () =>
  new Date(Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function setSessionCookie(response: Response, token: string): void {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: env.SESSION_TTL_HOURS * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
  });
}
