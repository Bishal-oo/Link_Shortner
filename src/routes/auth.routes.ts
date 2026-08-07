import { Router } from "express";
import { validate } from "@/middlewares/validate.middleware";
import { requireAuth } from "@/middlewares/auth.middleware";
import { signupSchema, loginSchema } from "@/types/auth.types.schema";
import {
  signupHandler,
  loginHandler,
  logoutHandler,
  meHandler,
} from "@/controllers/auth.controller";

export const authRouter = Router();

authRouter.post("/auth/signup", validate(signupSchema), signupHandler);
authRouter.post("/auth/login", validate(loginSchema), loginHandler);
authRouter.post("/auth/logout", logoutHandler);
authRouter.get("/auth/me", requireAuth, meHandler);