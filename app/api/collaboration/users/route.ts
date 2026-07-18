import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export async function GET(){const user=await getCurrentUser();if(!user)return NextResponse.json({error:"No autorizado"},{status:401});if(user.role!=="ADMIN")return NextResponse.json({error:"Prohibido"},{status:403});return NextResponse.json(await prisma.user.findMany({where:{role:{in:["ADMIN","AGENT"]}},select:{id:true,name:true,role:true},orderBy:{name:"asc"}}));}
