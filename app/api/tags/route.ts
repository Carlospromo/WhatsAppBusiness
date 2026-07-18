import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validTag } from "@/lib/collaboration";
export async function GET(){if(!await getCurrentUser())return NextResponse.json({error:"No autorizado"},{status:401});return NextResponse.json(await prisma.conversationTag.findMany({orderBy:{name:"asc"}}));}
export async function POST(request:Request){const user=await getCurrentUser();if(!user)return NextResponse.json({error:"No autorizado"},{status:401});if(user.role!=="ADMIN")return NextResponse.json({error:"Prohibido"},{status:403});const body=await request.json().catch(()=>({}));const tag=validTag(body.name,body.color);if(!tag)return NextResponse.json({error:"Etiqueta inválida"},{status:400});return NextResponse.json(await prisma.conversationTag.create({data:tag}),{status:201});}
