'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Loader2, KeyRound, CheckCircle2, Globe } from 'lucide-react'

interface ResetPasswordScreenProps {
  token: string
}

export function ResetPasswordScreen({ token }: ResetPasswordScreenProps) {
  const router = useRouter()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [done, setDone] = useState(false)

  const mutation = useMutation({
    mutationFn: (pw: string) => api.resetPassword(token, pw),
    onSuccess: () => {
      toast.success('Password reset successfully — please sign in')
      setDone(true)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }
    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }
    mutation.mutate(newPassword)
  }

  if (done) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-emerald-50 via-background to-amber-50 p-4">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center mb-6 gap-3">
            <div className="h-14 w-14 rounded-xl bg-emerald-500 flex items-center justify-center text-white">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-semibold tracking-tight">Password Reset</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Your password has been updated.
              </p>
            </div>
          </div>
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-sm mb-4">
                You can now sign in with your new password.
              </p>
              <Button onClick={() => router.push('/')} className="w-full">
                Go to Sign In
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-emerald-50 via-background to-amber-50 p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-6 gap-3">
          <div className="h-14 w-14 rounded-xl bg-primary flex items-center justify-center text-primary-foreground">
            <Globe className="h-7 w-7" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Set New Password</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Enter a new password for your account.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <KeyRound className="h-5 w-5" /> Reset Password
            </CardTitle>
            <CardDescription>
              This link expires in 1 hour and can only be used once.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  minLength={6}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  minLength={6}
                />
              </div>
              <Button type="submit" className="w-full" disabled={mutation.isPending}>
                {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Reset Password
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => router.push('/')}
              >
                Back to Sign In
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
