import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) { const user=await getCurrentUser(); if (!user) return NextResponse.json({ error:"No autorizado" },{status:401}); const {id}=await params; const request=await prisma.outboundMessageRequest.findUnique({where:{id},select:{id:true,status:true,safeError:true,createdAt:true,sentAt:true,requestedById:true}}); if (!request || (user.role === "VIEWER" && request.requestedById !== user.id)) return NextResponse.json({error:"No encontrada"},{status:404}); return NextResponse.json(request); }
