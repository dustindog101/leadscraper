import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'

// POST /api/seed — create a new user account.
// - First user ever: becomes active admin (no approval needed)
// - All subsequent users: created as pending members (need admin approval)
export async function POST(req: Request) {
  const { email, password, name } = await req.json().catch(() => ({}))

  if (!email || !password) {
    return NextResponse.json(
      { error: 'Email and password are required' },
      { status: 400 }
    )
  }

  // Email format validation
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  if (!emailValid) {
    return NextResponse.json(
      { error: 'Please enter a valid email address' },
      { status: 400 }
    )
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: 'Password must be at least 6 characters' },
      { status: 400 }
    )
  }

  const normalizedEmail = email.toLowerCase().trim()

  const existing = await db.user.findUnique({
    where: { email: normalizedEmail },
  })
  if (existing) {
    return NextResponse.json(
      { error: 'An account with that email already exists' },
      { status: 409 }
    )
  }

  const userCount = await db.user.count()
  const isFirstUser = userCount === 0
  const role = isFirstUser ? 'admin' : 'member'
  const status = isFirstUser ? 'active' : 'pending'

  const passwordHash = await bcrypt.hash(password, 10)
  const user = await db.user.create({
    data: {
      email: normalizedEmail,
      name: name || email.split('@')[0],
      passwordHash,
      role,
      status,
    },
    select: { id: true, email: true, name: true, role: true, status: true },
  })

  if (isFirstUser) {
    return NextResponse.json({
      user,
      message: `Welcome, ${user.name}! Your admin account is ready.`,
    })
  }

  return NextResponse.json({
    user,
    message:
      'Account created! An admin needs to approve your account before you can sign in. ' +
      'Ask a teammate to approve you in Settings → Team Members.',
    pending: true,
  })
}
