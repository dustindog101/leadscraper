import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'

// POST /api/auth/check-credentials
// Returns a SPECIFIC error message for failed login attempts.
// This intentionally leaks whether an email is registered — acceptable
// for a small-team B2B tool (not a public consumer app).
// Body: { email, password }
// Returns: { ok: true } on success, { error: "..." } on failure
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { email, password } = body as { email?: string; password?: string }

  if (!email || !password) {
    return NextResponse.json({ error: 'Please enter your email and password' })
  }

  const user = await db.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  })

  if (!user) {
    return NextResponse.json({ error: 'No account found with that email' })
  }

  if (user.status === 'pending') {
    return NextResponse.json({ error: 'Your account is pending admin approval' })
  }
  if (user.status === 'rejected') {
    return NextResponse.json({ error: 'Your account access has been denied. Contact an admin.' })
  }
  if (user.status !== 'active') {
    return NextResponse.json({ error: 'Your account is not active. Contact an admin.' })
  }

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) {
    return NextResponse.json({ error: 'Incorrect password' })
  }

  return NextResponse.json({ ok: true })
}
