'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type User } from '@/lib/api/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { KeyRound, Users, Shield, Loader2, Trash2, UserCog, Check, X, Clock } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface SettingsViewProps {
  session: { user: { id: string; email: string; name?: string | null; role: string } }
}

export function SettingsView({ session }: SettingsViewProps) {
  const isAdmin = session.user.role === 'admin'

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your account, password, and team members.
        </p>
      </div>

      <ChangePasswordCard />

      {isAdmin && <TeamManagementCard currentUserId={session.user.id} />}
    </div>
  )
}

// ============== Change Password ==============

function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.changePassword(currentPassword, newPassword),
    onSuccess: () => {
      toast.success('Password changed successfully')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match')
      return
    }
    if (newPassword.length < 6) {
      toast.error('New password must be at least 6 characters')
      return
    }
    mutation.mutate()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <KeyRound className="h-4 w-4" /> Change Password
        </CardTitle>
        <CardDescription>Update your account password. All sessions will remain active.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3 max-w-md">
          <div className="space-y-1.5">
            <Label htmlFor="current">Current password</Label>
            <Input
              id="current"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new">New password</Label>
            <Input
              id="new"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
              minLength={6}
            />
            <p className="text-xs text-muted-foreground">Minimum 6 characters.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirm new password</Label>
            <Input
              id="confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              minLength={6}
            />
          </div>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Update Password
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

// ============== Team Management (admin only) ==============

function TeamManagementCard({ currentUserId }: { currentUserId: string }) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: api.listUsers,
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.updateUser(id, { status }),
    onSuccess: (_data, vars) => {
      toast.success(
        vars.status === 'active' ? 'User approved' :
        vars.status === 'rejected' ? 'User rejected' :
        'User set to pending'
      )
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      api.updateUser(id, { role }),
    onSuccess: () => {
      toast.success('Role updated')
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: api.deleteUser,
    onSuccess: () => {
      toast.success('User deleted')
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const pendingUsers = data?.users.filter((u) => u.status === 'pending') ?? []
  const activeUsers = data?.users.filter((u) => u.status !== 'pending') ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" /> Team Members
          {pendingUsers.length > 0 && (
            <Badge variant="default" className="gap-1 animate-pulse">
              <Clock className="h-3 w-3" /> {pendingUsers.length} pending
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Manage who has access. Admins can approve new signups, reset passwords, change roles, and remove users.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : !data || data.users.length === 0 ? (
          <p className="text-sm text-muted-foreground">No users found.</p>
        ) : (
          <div className="space-y-4">
            {/* Pending users first (need action) */}
            {pendingUsers.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" /> Pending Approval
                </h3>
                <div className="space-y-2">
                  {pendingUsers.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center justify-between gap-3 p-3 rounded-md border border-amber-200 bg-amber-50"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{u.name || u.email}</span>
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <Clock className="h-2.5 w-2.5" /> pending
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {u.email} · requested {formatDistanceToNow(new Date(u.createdAt), { addSuffix: true })}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          onClick={() => statusMutation.mutate({ id: u.id, status: 'active' })}
                          disabled={statusMutation.isPending}
                          className="gap-1"
                        >
                          <Check className="h-3.5 w-3.5" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => statusMutation.mutate({ id: u.id, status: 'rejected' })}
                          disabled={statusMutation.isPending}
                          className="gap-1"
                        >
                          <X className="h-3.5 w-3.5" /> Reject
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Active/rejected users */}
            {activeUsers.length > 0 && (
              <div>
                {pendingUsers.length > 0 && (
                  <h3 className="text-sm font-medium mb-2">Team</h3>
                )}
                <div className="space-y-2">
                  {activeUsers.map((u) => (
                    <UserRow
                      key={u.id}
                      user={u}
                      currentUserId={currentUserId}
                      onRoleChange={(role) => roleMutation.mutate({ id: u.id, role })}
                      onDelete={() => {
                        if (confirm(`Delete user "${u.email}"? This cannot be undone.`)) {
                          deleteMutation.mutate(u.id)
                        }
                      }}
                      roleLoading={roleMutation.isPending}
                      deleteLoading={deleteMutation.isPending}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function UserRow({
  user,
  currentUserId,
  onRoleChange,
  onDelete,
  roleLoading,
  deleteLoading,
}: {
  user: User
  currentUserId: string
  onRoleChange: (role: string) => void
  onDelete: () => void
  roleLoading: boolean
  deleteLoading: boolean
}) {
  const isSelf = user.id === currentUserId

  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-md border">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{user.name || user.email}</span>
          {isSelf && (
            <Badge variant="outline" className="text-[10px]">you</Badge>
          )}
          {user.role === 'admin' ? (
            <Badge variant="default" className="text-[10px] gap-1">
              <Shield className="h-2.5 w-2.5" /> admin
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px]">member</Badge>
          )}
          {user.status === 'rejected' && (
            <Badge variant="destructive" className="text-[10px]">rejected</Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {user.email} · joined {formatDistanceToNow(new Date(user.createdAt), { addSuffix: true })}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <ResetPasswordDialog user={user} />
        <Select
          value={user.role}
          onValueChange={onRoleChange}
          disabled={isSelf || roleLoading}
        >
          <SelectTrigger className="h-8 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">admin</SelectItem>
            <SelectItem value="member">member</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          disabled={isSelf || deleteLoading}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

// ============== Admin Reset Password Dialog ==============

function ResetPasswordDialog({ user }: { user: { id: string; email: string; name?: string | null } }) {
  const [open, setOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.updateUser(user.id, { password: newPassword }),
    onSuccess: () => {
      toast.success(`Password reset for ${user.email}`)
      setNewPassword('')
      setOpen(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" title="Reset password">
          <UserCog className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Set a new password for <strong>{user.name || user.email}</strong>. They&apos;ll need to use this new password next time they sign in.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="admin-reset-pass">New password</Label>
          <Input
            id="admin-reset-pass"
            type="text"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="At least 6 characters"
            minLength={6}
          />
          <p className="text-xs text-muted-foreground">
            Tip: use a temporary password and ask them to change it after signing in.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || newPassword.length < 6}
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Reset Password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
