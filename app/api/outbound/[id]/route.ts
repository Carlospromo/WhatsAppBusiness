import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessAccount } from "@/lib/account";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) { const user=await getCurrentUser(); if (!user) return NextResponse.json({ error:"No autorizado" },{status:401}); const {id}=await params; const request=await prisma.outboundMessageRequest.findUnique({where:{id},select:{id:true,accountId:true,status:true,attemptCount:true,safeError:true,createdAt:true,sentAt:true,requestedById:true}}); if (!request || !await canAccessAccount(user,request.accountId)) return NextResponse.json({error:"No encontrada"},{status:404}); return NextResponse.json({id:request.id,status:request.status,attemptCount:request.attemptCount,safeError:request.safeError,createdAt:request.createdAt,sentAt:request.sentAt}); }
