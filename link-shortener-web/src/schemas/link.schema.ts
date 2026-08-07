import { preprocess, z } from "zod";



const RESERVED_ALIASES = new Set([
  "urls",
  "api",
  "admin",
  "health",
  "ready",
  "login",
  "logout",
  "signup",
  "static",
  "assets",
  "public",
  "favicon.ico",
  "robots.txt",
]);


const aliasSchema = z
    .string()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/,'alias may only contain letters, numbbers, - and _')
    .refine((alias)=> !RESERVED_ALIASES.has(alias.toLowerCase()) ,{
        message: "This alias is reserved and Cannot be used"
    })


const futureDate = z.coerce.date().refine((d)=> d.getTime() > Date.now(),{
    message: "ExpiresAt must be in the future"
})


const emptyToUndefined = (
    v: unknown
) =>(v === "" )? undefined:v

//preprocess runs before validation
export const createLinkSchema = z.object({
    originalUrl: z.url(),
    alias: preprocess(emptyToUndefined,aliasSchema.optional()),
    expiresAt: preprocess(emptyToUndefined, futureDate.optional())
})



export type CreateLinkInput = z.infer<typeof createLinkSchema>