
import { z } from "zod"

/** POST /urls/:code/shares — grant a user access to a link. */
export const createShareSchema = z.object({
    params: z.object({
        code: z.string().min(1).max(20),
    }),
    body: z.object({
        email: z.string().trim().toLowerCase().email()
    })
})

export type createShareBody =
z.infer<typeof createShareSchema>["body"]

/** DELETE /urls/:code/shares/:userId — revoke a user's access. */
export const revokeShareSchema = z.object({
    params: z.object({
        code: z.string().min(1).max(20),
        userId : z.string().uuid()
    })
})

