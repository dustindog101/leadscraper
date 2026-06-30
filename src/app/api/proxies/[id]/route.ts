import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

// DELETE /api/proxies/[id] — delete a proxy config
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  await db.proxyConfig.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}

// PATCH /api/proxies/[id] — update (enable/disable)
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { enabled, name, rotateMode } = body as {
    enabled?: boolean
    name?: string
    rotateMode?: string
  }

  const config = await db.proxyConfig.update({
    where: { id },
    data: {
      ...(enabled !== undefined ? { enabled } : {}),
      ...(name ? { name } : {}),
      ...(rotateMode ? { rotateMode } : {}),
    },
  })

  return NextResponse.json({ config })
}
