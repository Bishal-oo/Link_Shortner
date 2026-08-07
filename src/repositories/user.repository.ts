import {prisma} from "@/config/db"
import type {User} from "@prisma/client"

export type { User }

export async function createUser (
    input:{
        email: string,
        passwordHash: string
    }
): Promise<User>{
    return prisma.user.create({
        data:{
            email: input.email,
            passwordHash: input.passwordHash
        }
    })
}

export async function findByEmail (
    email: string
): Promise<User |null>
{
    return prisma.user.findUnique({
        where: {email}
    })
}

export async function findUserById(id: string):Promise<User | null>{
    return prisma.user.findUnique({
        where: {id}
    })
}