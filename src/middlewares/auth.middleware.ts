import type { RequestHandler } from "express";
import { verifyToken } from "@/utils/jwt";
import { UnauthorizedError } from "@/errors/UnauthorizedError";


export const AUTH_COOKIE = "token";

/**
 * Guard: require a valid JWT cookie. Sets req.user on success; throws a 401
 * (which the central error handler formats) on a missing/invalid/expired token.
 */

export const requireAuth: RequestHandler =(req,res,next)=>{
    const token = req.cookies?.[AUTH_COOKIE]
    if(!token) {
        throw new UnauthorizedError("Authentication required");
    }
    try {
        const { subject } = verifyToken(token)
        req.user = { id: subject}
        next()
    }catch{
        throw new UnauthorizedError("Invalid or expired sessions")
    }
}