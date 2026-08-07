import { z } from 'zod';

const emailSchema = 
z.string().trim().toLowerCase().email()


const passwordSchema =
z.string().min(8).max(72);


export const signupSchema = z.object({
    body: z.object({
        email: emailSchema,
        password :passwordSchema
    })
})

export type SignupBody = z.infer<typeof signupSchema>["body"]

/**
 * POST /auth/login — note password is only `.min(1)`, NOT the full policy.
 * We never want to hint the password rules to an attacker, and an existing
 * account might predate a future rule change; the credential check itself is
 * the gate, not the schema.
 */
export const loginSchema = z.object({
    body: z.object({
        email: emailSchema,
        password: z.string().min(1)
    })
})