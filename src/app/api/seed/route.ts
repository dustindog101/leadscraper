import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'

// POST /api/seed — bootstrap the first admin user.
// Safe to call multiple times; idempotent.
export async function POST(req: Request) {
  const { email, password, name } = await req.json().catch(() => ({}))

  if (!email || !password) {
    return NextResponse.json(
      { error: 'Email and password are required' },
      { status: 400 }
    )
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: 'Password must be at least 6 characters' },
      { status: 400 }
    )
  }

  const existing = await db.user.findUnique({
    where: { email: email.toLowerCase() },
  })
  if (existing) {
    return NextResponse.json(
      { error: 'A user with that email already exists' },
      { status: 409 }
    )
  }

  const userCount = await db.user.count()
  const role = userCount === 0 ? 'admin' : 'member'

  const passwordHash = await bcrypt.hash(password, 10)
  const user = await db.user.create({
    data: {
      email: email.toLowerCase(),
      name: name || email.split('@')[0],
      passwordHash,
      role,
    },
    select: { id: true, email: true, name: true, role: true },
  })

  return NextResponse.json({ user, message: `Created ${role} account` })
}
