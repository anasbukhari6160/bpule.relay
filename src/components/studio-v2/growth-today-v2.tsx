'use client'

import { useEffect, useState, useCallback } from 'react'
import { Copy, RefreshCw, AlertCircle, Check, ThumbsDown, Image, ChevronRight } from 'lucide-react'
import type { DailyGrowthBrief } from '@/lib/domain/types'

export function GrowthTodayV2() {
  const [data, setData] = useState<DailyGrowthBrief | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [posted, setPosted] = useState(false)
  const [generatingImage, setGeneratingImage] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [rejectionCount, setRejectionCount] = useState(0)
  const [selectedAngle, setSelectedAngle] = useState<{ title: string; angle: string } | null>(null)

  const fetchBrief = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/growth-v2/daily')
      if (!res.ok) return false
      const json = await res.json()
      if (json.brief) { setData(json.brief); return true }
      return false
    } catch { return false }
  }, [])

  const generateBrief = useCallback(async (rejectTitle?: string, rejectAngle?: string) => {
    setGenerating(true)
    setError('')
    setImageUrl(null)
    try {
      const res = await fetch('/api/growth-v2/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(rejectTitle ? { rejectTitle, rejectAngle } : {}),
        }),
      })
      if (!res.ok) throw new Error('Failed')
      const json = await res.json()
      if (json.brief) setData(json.brief)
    } catch { setError('Generation failed. Try again.') }
    finally { setGenerating(false) }
  }, [])

  useEffect(() => {
    fetchBrief().then(ok => { if (!ok) generateBrief() }).finally(() => setLoading(false))
  }, [fetchBrief, generateBrief])

  const handleCopy = () => {
    const text = selectedAngle ? `${selectedAngle.title}\n\n${selectedAngle.angle}` : data?.postCaption
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handlePosted = () => {
    setPosted(true)
    fetch('/api/growth-v2/daily', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markPosted: true }),
    }).catch(() => {})
    setTimeout(() => setPosted(false), 2000)
  }

  const handleRejectAndNext = async () => {
    if (!data) return
    setRejectionCount(c => c + 1)
    setSelectedAngle(null)
    const title = data.alternateIdeas?.[0]?.title ?? data.postCaption?.split('\n')[0]?.slice(0, 100) ?? ''
    await generateBrief(title, undefined)
  }

  const handleSelectAlternate = (title: string, angle: string) => {
    setRejectionCount(0)
    setSelectedAngle({ title, angle })
  }

  const handleGenerateImage = async () => {
    if (!data?.visualPrompt) return
    setGeneratingImage(true)
    setImageUrl(null)
    try {
      const res = await fetch('/api/content/intelligence/v2/daily-brief/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: data.visualPrompt }),
      })
      if (!res.ok) throw new Error('Image generation failed')
      const json = await res.json()
      if (json.url) setImageUrl(json.url)
    } catch {
      setError('Image generation failed. Try again.')
    } finally {
      setGeneratingImage(false)
    }
  }

  return (
    <div className="min-h-screen bg-bone">
      <header className="sticky top-0 z-10 border-b border-line bg-bone/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.15em] text-orange-signal">Relay Growth</span>
            <span className="h-3 w-px bg-line" />
            <span className="text-sm font-medium text-ink/70">Brand account</span>
            {rejectionCount > 0 && (
              <span className="ml-2 rounded-full bg-orange-signal/10 px-2 py-0.5 text-[10px] font-medium text-orange-signal">
                {rejectionCount} skipped
              </span>
            )}
          </div>
          <span className="font-mono text-[11px] text-ink/30">
            {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
        {loading && !data && (
          <div className="flex flex-col items-center justify-center py-32">
            <div className="mb-4 h-6 w-6 animate-spin rounded-full border-2 border-orange/30 border-t-orange" />
            <p className="text-sm text-ink/40">Preparing today&apos;s post...</p>
          </div>
        )}

        {error && !generating && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-status-danger/20 bg-status-danger/5 px-4 py-3">
            <AlertCircle className="h-4 w-4 shrink-0 text-status-danger" />
            <p className="text-sm text-ink/70 flex-1">{error}</p>
            <button onClick={() => generateBrief()} className="text-sm font-medium text-orange-signal hover:underline">Retry</button>
          </div>
        )}

        {data && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-line bg-bone-raised overflow-hidden">
              <div className="flex items-center gap-3 border-b border-line px-5 py-3">
                <div className="h-10 w-10 rounded-full bg-orange-signal/10 flex items-center justify-center text-orange-signal font-semibold text-sm">R</div>
                <div>
                  <p className="text-sm font-medium text-ink">Relay</p>
                  <p className="text-[11px] text-ink/40">Revenue Intelligence · 1st</p>
                </div>
              </div>

              <div className="px-5 py-5">
                {selectedAngle ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-orange-signal/10 px-2 py-0.5 text-[10px] font-medium text-orange-signal">Angle selected</span>
                      <button onClick={() => setSelectedAngle(null)} className="text-xs text-ink/40 hover:text-ink/60">← Back to post</button>
                    </div>
                    <p className="text-base font-medium text-ink">{selectedAngle.title}</p>
                    <p className="text-sm leading-relaxed text-ink/60">{selectedAngle.angle}</p>
                  </div>
                ) : data.postCaption ? (
                  <div className="whitespace-pre-wrap text-[15px] leading-[1.7] text-ink/80">{data.postCaption}</div>
                ) : (
                  <p className="text-sm text-ink/40">No post generated yet. Click below.</p>
                )}
              </div>

              {imageUrl && (
                <div className="px-5 pb-4">
                  <div className="overflow-hidden rounded-xl border border-line">
                    <img src={imageUrl} alt="Generated visual" className="w-full" />
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3 bg-bone/50">
                <button
                  onClick={handleCopy}
                  disabled={!selectedAngle && !data.postCaption}
                  className="flex items-center gap-2 rounded-lg bg-orange-signal px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-orange-dark disabled:opacity-50"
                >
                  <Copy className="h-4 w-4" />
                  {copied ? 'Copied!' : 'Copy post'}
                </button>
                <button
                  onClick={handlePosted}
                  className="flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink/60 transition-colors hover:border-status-success/40 hover:text-status-success"
                >
                  <Check className="h-4 w-4" />
                  {posted ? 'Posted!' : 'Mark posted'}
                </button>
                {data.visualPrompt && (
                  <button
                    onClick={handleGenerateImage}
                    disabled={generatingImage}
                    className="flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink/60 transition-colors hover:border-orange-signal/40 hover:text-orange-signal disabled:opacity-50"
                  >
                    <Image className={`h-4 w-4 ${generatingImage ? 'animate-pulse' : ''}`} />
                    {generatingImage ? 'Generating...' : imageUrl ? 'Regenerate image' : 'Generate image'}
                  </button>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={handleRejectAndNext}
                    disabled={generating}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink/40 transition-colors hover:text-status-danger disabled:opacity-50"
                    title="Skip this idea and generate a fresh one"
                  >
                    <ThumbsDown className="h-4 w-4" />
                    Skip
                  </button>
                  <button
                    onClick={() => generateBrief()}
                    disabled={generating}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink/40 transition-colors hover:text-orange-signal disabled:opacity-50"
                  >
                    <RefreshCw className={`h-4 w-4 ${generating ? 'animate-spin' : ''}`} />
                    {generating ? 'Generating...' : 'New post'}
                  </button>
                </div>
              </div>
            </div>

            {data.alternateIdeas && data.alternateIdeas.length > 0 && (
              <div className="rounded-xl border border-line bg-bone-raised p-4">
                <p className="mb-3 font-mono text-[11px] uppercase tracking-wider text-ink/30">Other angles — click to use</p>
                <div className="space-y-2">
                  {data.alternateIdeas.map((idea, i) => (
                    <button
                      key={i}
                      onClick={() => handleSelectAlternate(idea.title, idea.angle)}
                      className="group flex w-full items-start gap-3 rounded-lg bg-bone px-3 py-2 text-left transition-colors hover:bg-orange-signal/5"
                    >
                      <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink/20 transition-colors group-hover:text-orange-signal" />
                      <div>
                        <p className="text-sm text-ink/70 group-hover:text-ink/90">{idea.title}</p>
                        {idea.angle && (
                          <p className="mt-0.5 text-xs text-ink/40 line-clamp-2">{idea.angle.slice(0, 140)}</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {data.visualPrompt && (
              <details className="rounded-xl border border-line bg-bone-raised p-4">
                <summary className="cursor-pointer text-sm text-ink/50">Visual direction</summary>
                <p className="mt-2 text-xs text-ink/50 leading-relaxed">{data.visualPrompt}</p>
              </details>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
