import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'

// POST /api/auth/reset-password
// Unauthenticated user sets a new password using a reset token.
// Body: { token, newPassword }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { token, newPassword } = body as { token?: string; newPassword?: string }

  if (!token || !newPassword) {
    return NextResponse.json(
      { error: 'token and newPassword are required' },
      { status: 400 }
    )
  }

  if (newPassword.length < 6) {
    return NextResponse.json(
      { error: 'Password must be at least 6 characters' },
      { status: 400 }
    )
  }

  const reset = await db.passwordReset.findUnique({
    where: { token },
    include: { user: true },
  })

  if (!reset) {
    return NextResponse.json({ error: 'Invalid or unknown reset token' }, { status: 400 })
  }

  if (reset.usedAt) {
    return NextResponse.json({ error: 'This reset link has already been used' }, { status: 400 })
  }

  if (reset.expiresAt < new Date()) {
    return NextResponse.json({ error: 'This reset link has expired' }, { status: 400 })
  }

  // Update the password
  const newHash = await bcrypt.hash(newPassword, 10)
  await db.user.update({
    where: { id: reset.userId },
    data: { passwordHash: newHash },
  })

  // Mark token as used
  await db.passwordReset.update({
    where: { id: reset.id },
    data: { usedAt: new Date() },
  })

  // Invalidate all other outstanding tokens for this user
  await db.passwordReset.updateMany({
    where: { userId: reset.userId, usedAt: null, id: { not: reset.id } },
    data: { usedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
