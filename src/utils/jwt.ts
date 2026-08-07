import jwt from "jsonwebtoken";
import { env } from "@/config/env";


/** What we store inside the token. `sub` (subject) = the user's id. */
export interface AuthTokenPayload {
    subject: string
}

export function signToken(userId: string):string {
    return jwt.sign({sub:userId}, env.JWT_SECRECT,{
        expiresIn: env.JWT_EXPIRES_IN
    }as jwt.SignOptions)
}

export function verifyToken(token: string): AuthTokenPayload {
    const decoded = jwt.verify(token, env.JWT_SECRECT)
    if(typeof decoded === 'string' || !decoded.sub) {
        throw new Error("Malformed token payload")
    }
    return { subject: String(decoded.sub)}
}