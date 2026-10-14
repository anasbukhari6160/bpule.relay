'use client'

import { useState } from 'react'
import { Clock, Bell } from 'lucide-react'

const TIMEZONES = [
  'UTC', 'UTC+2', 'UTC+5', 'UTC-5', 'UTC-8', 'UTC+1', 'UTC+3', 'UTC+5:30', 'UTC+8', 'UTC+9', 'UTC+10',
]

export function WorkingHoursSettings() {
  const [timezone, setTimezone] = useState('UTC+5')
  const [startHour, setStartHour] = useState('09:00')
  const [endHour, setEndHour] = useState('17:00')
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <section className="srf-console">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
        <Clock className="size-4 text-orange" />
        <div className="flex-1">
          <p className="text-[12px] text-graphite">Working Hours</p>
          <p className="text-[14px] font-medium text-ink">When you&apos;re active</p>
        </div>
      </div>
      <div className="px-4 py-3 space-y-3">
        <div>
          <p className="text-[11px] text-stone mb-1">Timezone</p>
          <select value={timezone} onChange={e => setTimezone(e.target.value)} className="w-full rounded border border-line bg-bone-raised px-2 py-1.5 text-[13px] text-ink">
            {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] text-stone mb-1">Start</p>
            <input type="time" value={startHour} onChange={e => setStartHour(e.target.value)} className="w-full rounded border border-line bg-bone-raised px-2 py-1.5 text-[13px] text-ink" />
          </div>
          <div>
            <p className="text-[11px] text-stone mb-1">End</p>
            <input type="time" value={endHour} onChange={e => setEndHour(e.target.value)} className="w-full rounded border border-line bg-bone-raised px-2 py-1.5 text-[13px] text-ink" />
          </div>
        </div>
        <button onClick={handleSave} className="relay-cta text-[12px] w-full">
          {saved ? 'Saved ✓' : 'Save working hours'}
        </button>
      </div>
    </section>
  )
}

export function NotificationPreferences() {
  const [emailDigest, setEmailDigest] = useState(true)
  const [pushAlerts, setPushAlerts] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <section className="srf-console">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
        <Bell className="size-4 text-cobalt" />
        <div className="flex-1">
          <p className="text-[12px] text-graphite">Notifications</p>
          <p className="text-[14px] font-medium text-ink">How you&apos;re alerted</p>
        </div>
      </div>
      <div className="px-4 py-3 space-y-3">
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-[13px] text-ink">Daily email digest</span>
          <button onClick={() => setEmailDigest(!emailDigest)} className={`relative h-5 w-9 rounded-full transition-colors ${emailDigest ? 'bg-orange' : 'bg-line'}`}>
            <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-transform ${emailDigest ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
        </label>
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-[13px] text-ink">Push alerts for replies</span>
          <button onClick={() => setPushAlerts(!pushAlerts)} className={`relative h-5 w-9 rounded-full transition-colors ${pushAlerts ? 'bg-orange' : 'bg-line'}`}>
            <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-transform ${pushAlerts ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
        </label>
        <button onClick={handleSave} className="relay-cta text-[12px] w-full">
          {saved ? 'Saved ✓' : 'Save preferences'}
        </button>
      </div>
    </section>
  )
}
