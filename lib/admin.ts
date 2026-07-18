import { Role } from "@prisma/client";
import { prisma } from "./prisma";
export const requireAdminRole=(role:Role)=>role===Role.ADMIN;
export async function isLastActiveAdmin(id:string){return (await prisma.user.count({where:{role:Role.ADMIN,isActive:true,NOT:{id}}}))===0;}
export function validUserInput(body:unknown){const b=body as Record<string,unknown>;const email=typeof b?.email==="string"?b.email.trim().toLowerCase():"";const name=typeof b?.name==="string"?b.name.trim():"";const password=typeof b?.password==="string"?b.password:"";const role=typeof b?.role==="string"?b.role:"";return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&name.length>0&&name.length<=100&&password.length>=12&&["ADMIN","AGENT","VIEWER"].includes(role)?{email,name,password,role:role as Role}:null;}
