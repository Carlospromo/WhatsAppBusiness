import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validTag } from "@/lib/collaboration";
import { accountsForUser, canAccessAccount } from "@/lib/account";
export async function GET(request:Request){const user=await getCurrentUser();if(!user)return NextResponse.json({error:"No autorizado"},{status:401});const accountId=new URL(request.url).searchParams.get("accountId");const accounts=await accountsForUser(user);if(accountId&&!await canAccessAccount(user,accountId))return NextResponse.json({error:"Prohibido"},{status:403});return NextResponse.json(await prisma.conversationTag.findMany({where:{accountId:accountId??{in:accounts.map(a=>a.id)}},orderBy:{name:"asc"}}));}
export async function POST(request:Request){const user=await getCurrentUser();if(!user)return NextResponse.json({error:"No autorizado"},{status:401});if(user.role!=="ADMIN")return NextResponse.json({error:"Prohibido"},{status:403});const body=await request.json().catch(()=>({}));const tag=validTag(body.name,body.color);if(!tag||typeof body.accountId!=="string"||!await canAccessAccount(user,body.accountId))return NextResponse.json({error:"Etiqueta inválida"},{status:400});return NextResponse.json(await prisma.conversationTag.create({data:{...tag,accountId:body.accountId}}),{status:201});}
