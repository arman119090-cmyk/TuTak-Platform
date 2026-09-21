import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth/session';

export const POST = async (): Promise<Response> => {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
};
