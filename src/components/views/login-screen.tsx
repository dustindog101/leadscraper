'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Loader2, Globe, KeyRound, Copy, ExternalLink, CheckCircle2 } from 'lucide-react'
import { api } from '@/lib/api/client'

export function LoginScreen() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  // Sign-in form
  const [signinEmail, setSigninEmail] = useState('')
  const [signinPassword, setSigninPassword] = useState('')

  // Sign-up form
  const [signupName, setSignupName] = useState('')
  const [signupEmail, setSignupEmail] = useState('')
  const [signupPassword, setSignupPassword] = useState('')

  // Forgot password dialog
  const [forgotOpen, setForgotOpen] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [resetUrl, setResetUrl] = useState<string | null>(null)

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await signIn('credentials', {
        email: signinEmail,
        password: signinPassword,
        redirect: false,
      })
      setLoading(false)
      if (res?.error) {
        // NextAuth wraps our custom authorize() error in "CredentialsSignin".
        // To get the specific message, we fetch it via a custom endpoint.
        let msg = 'Invalid email or password'
        try {
          const check = await fetch(`/api/auth/check-credentials`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: signinEmail, password: signinPassword }),
          })
          const data = await check.json()
          if (data.error) msg = data.error
        } catch {
          // fall back to generic
        }
        toast.error(msg)
        return
      }
      router.refresh()
    } catch (err) {
      setLoading(false)
      toast.error('Sign-in service unavailable. Please try again.')
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: signupName,
          email: signupEmail,
          password: signupPassword,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to create account')
        return
      }

      // If first user (admin, active) — auto-sign-in
      if (!data.pending) {
        const r = await signIn('credentials', {
          email: signupEmail,
          password: signupPassword,
          redirect: false,
        })
        if (r?.error) {
          toast.error('Account created but sign-in failed. Please sign in.')
          return
        }
        toast.success(`Account created — welcome, ${data.user?.name || 'admin'}!`)
        router.refresh()
      } else {
        // Pending approval — don't auto-sign-in (would fail anyway)
        toast.success('Account created! An admin needs to approve you before you can sign in.')
        setSignupName('')
        setSignupEmail('')
        setSignupPassword('')
        // Switch to sign-in tab so they see the message context
        const signinTab = document.querySelector('[role="tab"][data-state="inactive"]') as HTMLButtonElement
        if (signinTab) signinTab.click()
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault()
    setForgotLoading(true)
    try {
      const data = await api.requestReset(forgotEmail)
      if (data.resetUrl) {
        setResetUrl(data.resetUrl)
        toast.success('Reset link generated')
      } else {
        // Email doesn't exist — show generic success (prevent enumeration)
        setResetUrl(null)
        toast.success('If that email exists, a reset link has been generated.')
        setTimeout(() => {
          setForgotOpen(false)
          setForgotEmail('')
        }, 2000)
      }
    } catch (e: Error) {
      toast.error(e.message)
    } finally {
      setForgotLoading(false)
    }
  }

  function copyResetUrl() {
    if (resetUrl) {
      navigator.clipboard.writeText(resetUrl)
      toast.success('Reset link copied to clipboard')
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-emerald-50 via-background to-amber-50 p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8 gap-3">
          <div className="h-14 w-14 rounded-xl bg-primary flex items-center justify-center text-primary-foreground">
            <Globe className="h-7 w-7" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Cybershare Lead Scraper</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Find businesses with no website — your next client.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Welcome</CardTitle>
            <CardDescription>
              Sign in to your team workspace or create the first admin account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="signin">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign In</TabsTrigger>
                <TabsTrigger value="signup">Create Account</TabsTrigger>
              </TabsList>

              <TabsContent value="signin">
                <form onSubmit={handleSignIn} className="space-y-3 mt-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="signin-email">Email</Label>
                    <Input
                      id="signin-email"
                      type="email"
                      placeholder="you@cybershare.tech"
                      value={signinEmail}
                      onChange={(e) => setSigninEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="signin-password">Password</Label>
                      <button
                        type="button"
                        onClick={() => {
                          setForgotEmail(signinEmail)
                          setResetUrl(null)
                          setForgotOpen(true)
                        }}
                        className="text-xs text-primary hover:underline"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <Input
                      id="signin-password"
                      type="password"
                      placeholder="••••••••"
                      value={signinPassword}
                      onChange={(e) => setSigninPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                    />
                  </div>
                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Sign In
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-3 mt-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-name">Name</Label>
                    <Input
                      id="signup-name"
                      placeholder="Manny"
                      value={signupName}
                      onChange={(e) => setSignupName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="you@cybershare.tech"
                      value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-password">Password</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      placeholder="At least 6 characters"
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                      required
                      autoComplete="new-password"
                      minLength={6}
                    />
                    <p className="text-xs text-muted-foreground">
                      The first account becomes the admin. All other accounts need admin approval before they can sign in.
                    </p>
                  </div>
                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Create Account
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          For cybershare.tech · Local dev build
        </p>
      </div>

      {/* Forgot Password Dialog */}
      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" /> Reset Password
            </DialogTitle>
            <DialogDescription>
              Enter your email and we&apos;ll generate a password reset link.
              {' '}
              <strong>Since this tool has no email setup, the link will be shown here.</strong>
              {' '}
              In production with email, it would be emailed to you.
            </DialogDescription>
          </DialogHeader>

          {resetUrl ? (
            <div className="space-y-3 py-2">
              <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3 flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-emerald-800">Reset link generated!</p>
                  <p className="text-emerald-700 mt-0.5">
                    Click the link below to set a new password. The link expires in 1 hour.
                  </p>
                </div>
              </div>
              <div className="rounded-md border bg-muted/40 p-2 font-mono text-xs break-all">
                {resetUrl}
              </div>
              <div className="flex gap-2">
                <Button onClick={copyResetUrl} variant="outline" className="flex-1">
                  <Copy className="h-4 w-4 mr-2" /> Copy Link
                </Button>
                <Button
                  onClick={() => {
                    window.location.href = resetUrl
                  }}
                  className="flex-1"
                >
                  <ExternalLink className="h-4 w-4 mr-2" /> Open Reset Page
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleForgotPassword} className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="forgot-email">Email</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  placeholder="you@cybershare.tech"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  required
                  autoComplete="email"
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setForgotOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={forgotLoading}>
                  {forgotLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Generate Reset Link
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
