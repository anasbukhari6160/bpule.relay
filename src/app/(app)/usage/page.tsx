import { redirect } from 'next/navigation'

// Send budget now lives in Settings; keep old links working.
export default function UsagePage() {
  redirect('/settings#send-budget')
}
