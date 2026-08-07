import bcrypt from "bcryptjs"

const SALT_ROUNDS =10

/** Hash a plaintext password for storage. */
export function hashPassword(plain: string) :Promise<string> {
    return bcrypt.hash(plain, SALT_ROUNDS)
}

/** Check a plaintext password against a stored hash. */
export function verifyPassword(plain: string, hash: string):Promise<boolean> {
    return bcrypt.compare(plain, hash)
}

// bcrypt stores the salt inside the hash string, so compare re-derives it automatically — you never store or manage salts yourself. We only ever persist the hash, never the plaintext.