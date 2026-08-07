import type { Request, Response } from "express";
import { signup, login } from "@/services/auth.service";
import { findUserById, type User } from "@/repositories/user.repository";
import { signToken } from "@/utils/jwt";
import { AUTH_COOKIE } from "@/middlewares/auth.middleware";
import { UnauthorizedError } from "@/errors/UnauthorizedError";
import { env } from "@/config/env";

const COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24; // 1 day (keep in step with JWT_EXPIRES_IN)

/** Cookie flags. Central so login/logout stay consistent. */
function cookieOptions() {
  return {
    httpOnly: true, // JS can't read it → immune to XSS token theft
    sameSite: "lax" as const, // sent on top-level navigation + same-site requests
    secure: env.NODE_ENV === "production", // HTTPS-only in prod; off for http://localhost
    maxAge: COOKIE_MAX_AGE_MS,
    path: "/",
  };
}

/* Shape the user object we return — NEVER include passwordHash. 
 publicUser is a small whitelist/sanitizer helper. It takes a full User record from the database and returns a new object containing only the fields that are safe to send to the client.
*/
function publicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    quota: u.quota,
    createdAt: u.createdAt,
  };
}

/** POST /auth/signup */
export async function signupHandler(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as { email: string; password: string };
  const user = await signup({ email, password });
  res.cookie(AUTH_COOKIE, signToken(user.id), cookieOptions());
  res.status(201).json({ user: publicUser(user) });
}

/** POST /auth/login */
export async function loginHandler(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as { email: string; password: string };
  const user = await login({ email, password });
  res.cookie(AUTH_COOKIE, signToken(user.id), cookieOptions());
  res.json({ user: publicUser(user) });
}

/** POST /auth/logout — clear the cookie. */
export async function logoutHandler(_req: Request, res: Response): Promise<void> {
  res.clearCookie(AUTH_COOKIE, { path: "/" });
  res.status(204).send();
}

/** GET /auth/me — the current user (requireAuth guarantees req.user). */
export async function meHandler(req: Request, res: Response): Promise<void> {
  const user = await findUserById(req.user!.id);
  if (!user) throw new UnauthorizedError(); // token valid but user deleted
  res.json({ user: publicUser(user) });
}