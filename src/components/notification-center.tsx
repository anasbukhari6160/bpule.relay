'use client'

import { useEffect, useState, useCallback } from 'react'
import { Bell, Check, X, Info, CheckCircle2, AlertTriangle } from 'lucide-react'
import { cn } from 'cn'

interface Notification {
  id: string
  type: 'success' | 'warning' | 'info'
  title: string
  body?: string
  createdAt: number
  read: boolean
}

const STORAGE_KEY = 'relay_notifications'

function loadNotifications(): Notification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveNotifications(notifications: Notification[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.slice(0, 50)))
}

export function pushNotification(n: Omit<Notification, 'id' | 'createdAt' | 'read'>) {
  const notifications = loadNotifications()
  notifications.unshift({ ...n, id: crypto.randomUUID(), createdAt: Date.now(), read: false })
  saveNotifications(notifications)
}

const TYPE_ICON = {
  success: CheckCircle2,
  warning: AlertTriangle,
  info: Info,
}

const TYPE_TONE = {
  success: 'text-status-success',
  warning: 'text-status-warning',
  info: 'text-cobalt',
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])

  useEffect(() => {
    setNotifications(loadNotifications())
    const interval = setInterval(() => setNotifications(loadNotifications()), 5000)
    return () => clearInterval(interval)
  }, [])

  const unread = notifications.filter(n => !n.read).length

  const markAllRead = useCallback(() => {
    const updated = notifications.map(n => ({ ...n, read: true }))
    setNotifications(updated)
    saveNotifications(updated)
  }, [notifications])

  const dismiss = useCallback((id: string) => {
    const updated = notifications.filter(n => n.id !== id)
    setNotifications(updated)
    saveNotifications(updated)
  }, [notifications])

  const timeAgo = (ts: number) => {
    const mins = Math.round((Date.now() - ts) / 60000)
    if (mins < 1) return 'now'
    if (mins < 60) return `${mins}m`
    if (mins < 1440) return `${Math.round(mins / 60)}h`
    return `${Math.round(mins / 1440)}d`
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="relative rounded-md p-1.5 text-graphite transition-colors hover:bg-bone-raised hover:text-ink"
        aria-label="Notifications"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-orange text-[9px] font-medium text-on-accent">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden srf-console-edge">
            <div className="flex items-center justify-between border-b border-console-line px-4 py-3">
              <p className="text-[12px] font-medium text-console-text">Notifications</p>
              {unread > 0 && (
                <button onClick={markAllRead} className="text-[11px] text-orange hover:text-orange-light">
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Bell className="mx-auto size-6 text-console-mute" />
                  <p className="mt-2 text-[12px] text-console-mute">No notifications yet</p>
                </div>
              ) : (
                notifications.slice(0, 20).map(n => {
                  const Icon = TYPE_ICON[n.type]
                  return (
                    <div key={n.id} className={cn('flex items-start gap-3 border-b border-console-line/50 px-4 py-3', !n.read && 'bg-orange/[0.03]')}>
                      <Icon className={cn('size-4 mt-0.5 shrink-0', TYPE_TONE[n.type])} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] text-console-text">{n.title}</p>
                        {n.body && <p className="mt-0.5 text-[11px] text-console-mute">{n.body}</p>}
                        <p className="mt-1 text-[10px] text-console-mute">{timeAgo(n.createdAt)}</p>
                      </div>
                      <button onClick={() => dismiss(n.id)} className="shrink-0 rounded p-0.5 text-console-mute hover:text-console-text">
                        <X className="size-3" />
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
