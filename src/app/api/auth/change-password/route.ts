import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'

// POST /api/auth/change-password
// Authenticated user changes their own password.
// Body: { currentPassword, newPassword }
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const { currentPassword, newPassword } = body as {
    currentPassword?: string
    newPassword?: string
  }

  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { error: 'currentPassword and newPassword are required' },
      { status: 400 }
    )
  }

  if (newPassword.length < 6) {
    return NextResponse.json(
      { error: 'New password must be at least 6 characters' },
      { status: 400 }
    )
  }

  if (currentPassword === newPassword) {
    return NextResponse.json(
      { error: 'New password must be different from current password' },
      { status: 400 }
    )
  }

  const user = await db.user.findUnique({ where: { id: session.user.id } })
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!valid) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
  }

  const newHash = await bcrypt.hash(newPassword, 10)
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash },
  })

  // Invalidate all outstanding password reset tokens for this user (security best practice)
  await db.passwordReset.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
