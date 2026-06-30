'use client'

import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { LoginScreen } from '@/components/views/login-screen'
import { Dashboard } from '@/components/views/dashboard'
import { ResetPasswordScreen } from '@/components/views/reset-password-screen'
import { Loader2 } from 'lucide-react'

function HomeContent() {
  const { data: session, status } = useSession()
  const searchParams = useSearchParams()
  const resetToken = searchParams.get('reset')

  // If there's a reset token in the URL, show the reset password screen
  // (regardless of session — user might be signed in but resetting anyway)
  if (resetToken && status !== 'loading') {
    return <ResetPasswordScreen token={resetToken} />
  }

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

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  )
}
