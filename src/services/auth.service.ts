import {
    createUser,
    findByEmail,
    type User
} from "@/repositories/user.repository";
import { hashPassword, verifyPassword } from "@/utils/password";
import { ConflictError, UnauthorizedError } from "@/errors";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";

export async function signup(input: {
    email: string,
    password: string
}): Promise<User> {
    const passwordHash = await hashPassword(input.password);

    try {
        return await createUser({
            email: input.email,
            passwordHash
        })
    }catch(err) {
        if(
            err instanceof PrismaClientKnownRequestError && err.code === "P2002"
        ) {
            throw new ConflictError("An account with this email already exists")
        }
        throw err;
    }
}

export async function login(input: {
    email: string;
    password: string;
}): Promise<User> {
    const user = await findByEmail(input.email);
    if(!user) {
        throw new UnauthorizedError("Invalid email or password")
    }
    const ok = await verifyPassword(input.password, user.passwordHash);

    if(!ok) {
        throw new UnauthorizedError("Invalid email or password");
    }
    return user;
}