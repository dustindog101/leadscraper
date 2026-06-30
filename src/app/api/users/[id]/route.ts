import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'

// PATCH /api/users/[id] — admin updates a user (role, name, or password)
// Body: { role?, name?, password? }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { role, name, password } = body as {
    role?: string
    name?: string
    password?: string
  }

  const target = await db.user.findUnique({ where: { id } })
  if (!target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Prevent admin from demoting themselves (locks everyone out)
  if (id === session.user.id && role && role !== 'admin') {
    return NextResponse.json(
      { error: 'You cannot demote yourself — promote another user to admin first' },
      { status: 400 }
    )
  }

  // Prevent admin from deleting themselves via password reset (edge case)
  const data: { role?: string; name?: string; passwordHash?: string } = {}
  if (role && ['admin', 'member'].includes(role)) data.role = role
  if (name) data.name = name
  if (password) {
    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 }
      )
    }
    data.passwordHash = await bcrypt.hash(password, 10)
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
  }

  const updated = await db.user.update({
    where: { id },
    data,
    select: { id: true, email: true, name: true, role: true },
  })

  // If password was changed, invalidate all reset tokens for this user
  if (password) {
    await db.passwordReset.updateMany({
      where: { userId: id, usedAt: null },
      data: { usedAt: new Date() },
    })
  }

  return NextResponse.json({ user: updated })
}

// DELETE /api/users/[id] — admin deletes a user
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })
  }

  const { id } = await params

  if (id === session.user.id) {
    return NextResponse.json(
      { error: 'You cannot delete your own account' },
      { status: 400 }
    )
  }

  const target = await db.user.findUnique({ where: { id } })
  if (!target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Prevent deleting the last admin (locks everyone out)
  if (target.role === 'admin') {
    const adminCount = await db.user.count({ where: { role: 'admin' } })
    if (adminCount <= 1) {
      return NextResponse.json(
        { error: 'Cannot delete the last admin — promote another user first' },
        { status: 400 }
      )
    }
  }

  await db.user.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
