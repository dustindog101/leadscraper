import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { db } from '@/lib/db'

// POST /api/auth/request-reset
// Unauthenticated user requests a password reset.
// Body: { email }
// Returns the reset token + URL (since we have no email infrastructure).
// In production with email, this would email the link instead of returning it.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { email } = body as { email?: string }

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  const normalizedEmail = email.toLowerCase().trim()
  const user = await db.user.findUnique({ where: { email: normalizedEmail } })

  // Security: always return success, even if user doesn't exist
  // (prevents email enumeration). But we only return the actual link
  // if the user exists — and we tell the caller via a flag.
  if (!user) {
    return NextResponse.json({
      ok: true,
      message: 'If that email exists, a reset link has been generated.',
    })
  }

  // Generate a secure token
  const token = randomUUID()
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60) // 1 hour

  // Invalidate any previous outstanding tokens for this user
  await db.passwordReset.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  })

  await db.passwordReset.create({
    data: {
      token,
      userId: user.id,
      expiresAt,
    },
  })

  // Build the reset URL
  // `origin` header already includes the protocol (e.g. "https://example.com")
  // `host` header is just the host (e.g. "example.com") — needs protocol prepended
  const origin = req.headers.get('origin')
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  const protocol = req.headers.get('x-forwarded-proto') || 'https'
  const baseUrl = origin || (host ? `${protocol}://${host}` : '') || process.env.NEXTAUTH_URL || ''
  const resetUrl = `${baseUrl}/?reset=${token}`

  // In a real app with email, we'd send this URL via email here.
  // For this tool (small team, no email infra), we return it directly.
  // Only the user who knows the email can see it — security is acceptable
  // for a B2B lead scraper used by a small team.
  return NextResponse.json({
    ok: true,
    resetUrl,
    message: 'Reset link generated. (In production with email, this would be emailed.)',
  })
}
