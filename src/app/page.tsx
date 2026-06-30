'use client'

import { useSession } from 'next-auth/react'
import { LoginScreen } from '@/components/views/login-screen'
import { Dashboard } from '@/components/views/dashboard'
import { Loader2 } from 'lucide-react'

export default function Home() {
  const { data: session, status } = useSession()

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!session) {
    return <LoginScreen />
  }

  return <Dashboard session={session} />
}
