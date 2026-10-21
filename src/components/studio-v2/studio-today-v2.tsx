'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Shuffle, Check, AlertCircle, Plus, Users, RefreshCw, Download, Image, Sparkles } from 'lucide-react'
import type { DailyContentIdea } from '@/lib/domain/types'

type Platform = 'linkedin' | 'x'

interface Props {
  personaId: string
  personaName?: string
  displayName: string
}

interface BriefData {
  brief: { id: string; status: string; localDate: string }
  ideas: DailyContentIdea[]
  platform?: Platform
}

const imageKey = (ideaId: string) => `studio-image-${ideaId}`
/** Persist a generated image with its post idea so it survives reopen/refresh. */
function persistImage(ideaId: string, url: string) {
  try { sessionStorage.setItem(imageKey(ideaId), url) } catch { /* quota or unavailable */ }
}

export function StudioTodayV2({ personaId, displayName }: Props) {
  const router = useRouter()
  const [platform, setPlatform] = useState<Platform>('linkedin')
  const [personas, setPersonas] = useState<Array<{ id: string; displayName: string }>>([])
  const [personasLoading, setPersonasLoading] = useState(false)
  const [data, setData] = useState<BriefData | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  // Track whether a brief exists for today so we can show a "Generate" CTA
  // instead of auto-generating on every mount (which spends AI tokens on
  // persona browsing).
  const [briefExists, setBriefExists] = useState(false)
  const [copied, setCopied] = useState(false)
  const [posted, setPosted] = useState(false)
  const [activeIdeaId, setActiveIdeaId] = useState<string | null>(null)
  const [customMode, setCustomMode] = useState(false)
  const [customText, setCustomText] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageLoading, setImageLoading] = useState(false)
  const [imageError, setImageError] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)



  const fetchBrief = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/content/intelligence/v2/daily-brief?personaId=${personaId}&platform=${platform}`)
      if (!res.ok) return false
      const json = await res.json()
      if (json.ideas?.length > 0) {
        const merged = applyEditedCaptions({ ...json, platform })
        setData(merged)
        const rec = merged.ideas.find((i: DailyContentIdea) => i.ideaType === 'recommended')
        setActiveIdeaId(rec?.id ?? merged.ideas[0].id)
        setBriefExists(true)
        return true
      }
      setBriefExists(false)
      return false
    } catch { setBriefExists(false); return false }
  }, [personaId, platform])

  // After loading, check sessionStorage for any captions edited in the
  // post-editor and apply them to the live data (BUG-17: edited posts persist).
  const applyEditedCaptions = useCallback((briefData: BriefData): BriefData => {
    try {
      const updated = { ...briefData, ideas: briefData.ideas.map(idea => {
        const stored = sessionStorage.getItem(`studio-idea-${idea.id}`)
        if (!stored) return idea
        const parsed = JSON.parse(stored)
        return parsed.postCaption && parsed.postCaption !== idea.postCaption
          ? { ...idea, postCaption: parsed.postCaption }
          : idea
      })}
      return updated
    } catch { return briefData }
  }, [])

  const generateBrief = useCallback(async () => {
    setGenerating(true)
    setError('')
    setImageUrl(null)
    try {
      const res = await fetch('/api/content/intelligence/v2/daily-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personaId, platform }),
      })
      if (!res.ok) throw new Error('Failed')
      const json = await res.json()
      if (json.ideas?.length > 0) {
        const merged = applyEditedCaptions({ ...json, platform })
        setData(merged)
        setActiveIdeaId(merged.ideas[0].id)
      }
    } catch { setError('Generation failed. Try again.') }
    finally { setGenerating(false) }
  }, [personaId, platform, applyEditedCaptions])

  const tryAnother = useCallback(async () => {
    if (!data) return
    setGenerating(true)
    setImageUrl(null)
    try {
      const res = await fetch('/api/content/intelligence/v2/daily-brief/idea', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personaId,
          platform,
          excludeIdeas: data.ideas.map(i => ({ title: i.title, territory: i.territory ?? '', angle: i.angle ?? '' })),
        }),
      })
      if (!res.ok) throw new Error('Failed')
      const json = await res.json()
      if (json.idea) {
        setData({ ...data, ideas: [...data.ideas, json.idea] })
        setActiveIdeaId(json.idea.id)
        setPosted(false)
        setCopied(false)
      }
    } catch { /* keep current */ }
    finally { setGenerating(false) }
  }, [personaId, data, platform])

  useEffect(() => {
    // Reset state when persona changes — prevents stale ideas from showing
    // against the wrong persona (BUG-14: switch profile).
    setData(null)
    setActiveIdeaId(null)
    setBriefExists(false)
    setError('')
    // Only fetch — never auto-generate on mount (ENH-01: explicit Generate button).
    fetchBrief().finally(() => setLoading(false))
  }, [fetchBrief])

  // A generated image is part of the post: restore it when the same idea is
  // reopened or the page is refreshed (QA BUG-11-14).
  useEffect(() => {
    if (!activeIdeaId) { setImageUrl(null); return }
    try {
      const stored = sessionStorage.getItem(imageKey(activeIdeaId))
      if (stored) setImageUrl(stored)
    } catch { /* ignore */ }
  }, [activeIdeaId])

  // Fetch persona list for the switcher (BUG-14: in-component switch).
  useEffect(() => {
    if (personas.length > 0) return
    setPersonasLoading(true)
    fetch('/api/content/personas')
      .then(r => r.ok ? r.json() : { personas: [] })
      .then(json => setPersonas(json.personas ?? []))
      .catch(() => {})
      .finally(() => setPersonasLoading(false))
  }, [personas.length])


  const handleCopy = () => {
    if (!activeIdea?.postCaption) return
    navigator.clipboard.writeText(activeIdea.postCaption)
    setCopied(true)
    fetch(`/api/content/intelligence/v2/daily-brief/copied`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ideaId: activeIdea.id }),
    }).catch(() => {})
    setTimeout(() => setCopied(false), 2000)
  }

  const handlePosted = () => {
    if (!activeIdea) return
    setPosted(true)
    fetch(`/api/content/intelligence/v2/daily-brief/copied`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ideaId: activeIdea.id, markPosted: true }),
    }).catch(() => {})
    setTimeout(() => setPosted(false), 2000)
  }


  const activeIdea = data?.ideas.find(i => i.id === activeIdeaId) ?? data?.ideas[0]
  const trendLabel = activeIdea?.trendGrounded ? 'Trending topic' : 'Editorial'

  const generateImage = useCallback(async () => {
    if (!activeIdea) return
    setImageLoading(true)
    setImageError('')
    try {
      const prompt = activeIdea.visualPrompt || `${activeIdea.title}. ${activeIdea.angle || ''}`
      const res = await fetch('/api/content/intelligence/v2/daily-brief/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      if (!res.ok) throw new Error('Image generation failed')
      const json = await res.json()
      if (json.url) {
        setImageUrl(json.url)
        persistImage(activeIdea.id, json.url)
      } else {
        throw new Error(json.error || 'No image')
      }
    } catch {
      generateCanvasImage()
    } finally {
      setImageLoading(false)
    }
  }, [activeIdea])

  const generateCanvasImage = useCallback(() => {
    if (!canvasRef.current || !activeIdea) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = 1200, H = 630
    canvas.width = W
    canvas.height = H
    const grad = ctx.createLinearGradient(0, 0, W, H)
    grad.addColorStop(0, '#1a1a2e')
    grad.addColorStop(1, '#16213e')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = '#3b82f6'
    ctx.fillRect(60, 100, 60, 4)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 36px system-ui, sans-serif'
    const title = activeIdea.title
    const words = title.split(' ')
    let line = '', y = 180
    const maxW = W - 120
    for (const word of words) {
      const test = line + word + ' '
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line.trim(), 60, y)
        line = word + ' '
        y += 50
      } else { line = test }
    }
    ctx.fillText(line.trim(), 60, y)
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.font = '20px system-ui, sans-serif'
    ctx.fillText(displayName, 60, H - 60)
    ctx.fillStyle = '#3b82f6'
    ctx.font = 'bold 16px system-ui, sans-serif'
    ctx.fillText('RELAY', W - 100, H - 60)
    const dataUrl = canvas.toDataURL('image/png')
    setImageUrl(dataUrl)
    if (activeIdea) persistImage(activeIdea.id, dataUrl)
  }, [activeIdea, displayName])

  const downloadImage = () => {
    if (!imageUrl) return
    const a = document.createElement('a')
    a.href = imageUrl
    a.download = `relay-post-${Date.now()}.png`
    a.click()
  }


  return (
    <div className="min-h-screen bg-bone">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-line bg-bone/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.15em] text-cobalt">Studio</span>
             <span className="h-3 w-px bg-line" />
             <span className="text-sm font-medium text-ink/70">{displayName}</span>
           </div>
           <div className="flex items-center gap-2">
             {/* Platform toggle */}
             <div className="flex rounded-lg border border-line p-0.5">
               <button
                 onClick={() => setPlatform('linkedin')}
                 className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${platform === 'linkedin' ? 'bg-cobalt text-on-accent' : 'text-ink/50 hover:text-ink/80'}`}
               >
                 LinkedIn
               </button>
               <button
                 onClick={() => setPlatform('x')}
                 className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${platform === 'x' ? 'bg-cobalt text-on-accent' : 'text-ink/50 hover:text-ink/80'}`}
               >
                 X
               </button>
             </div>
              {/* Persona switcher (BUG-14: in-component switch) */}
              {personas.length > 1 && (
                <select
                  value={personaId}
                  onChange={(e) => {
                    const id = e.target.value
                    if (id && id !== personaId) router.push(`/content-v2/${id}/today`)
                  }}
                  className="rounded-lg border border-line bg-bone px-2 py-1 text-xs text-ink/70 hover:border-cobalt/40 focus:outline-none focus:border-cobalt"
                  disabled={personasLoading}
                >
                  {personas.map((p) => (
                    <option key={p.id} value={p.id}>{p.displayName}</option>
                  ))}
                </select>
              )}
              <button
                onClick={() => router.push('/content?manage=1')}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-ink/50 transition-colors hover:bg-bone-raised hover:text-cobalt"
                title="Manage personas"
              >
                <Users className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Manage</span>
              </button>
             <button
               onClick={() => router.push('/content/new')}
               className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-ink/50 transition-colors hover:bg-bone-raised hover:text-cobalt"
             >
               <Plus className="h-3.5 w-3.5" />
               <span className="hidden sm:inline">Persona</span>
             </button>
             <span className="font-mono text-[11px] text-ink/30 hidden sm:block">
               {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
             </span>
           </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
        {/* Loading state */}
        {loading && !data && (
          <div className="flex flex-col items-center justify-center py-32">
            <div className="mb-4 h-6 w-6 animate-spin rounded-full border-2 border-cobalt/30 border-t-cobalt" />
            <p className="text-sm text-ink/40">Preparing today&apos;s post...</p>
          </div>
        )}

        {/* Error state */}
        {error && !generating && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-status-danger/20 bg-status-danger/5 px-4 py-3">
            <AlertCircle className="h-4 w-4 shrink-0 text-status-danger" />
            <p className="text-sm text-ink/70 flex-1">{error}</p>
            <button onClick={generateBrief} className="text-sm font-medium text-cobalt hover:underline">Retry</button>
          </div>
        )}

        {/* No brief yet — prompt to generate (ENH-01: explicit CTA, no auto-spend) */}
        {!loading && !activeIdea && !error && (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-cobalt/10">
              <Sparkles className="h-8 w-8 text-cobalt" />
            </div>
            <h2 className="text-lg font-medium text-ink">Ready to create</h2>
            <p className="mt-2 max-w-sm text-center text-sm text-ink/50">
              Generate a post for {displayName} on {platform === 'linkedin' ? 'LinkedIn' : 'X'}.
            </p>
            {!customMode ? (
              <div className="mt-6 flex flex-col items-center gap-3">
                <button
                  onClick={generateBrief}
                  disabled={generating}
                  className="flex items-center gap-2 rounded-lg bg-cobalt px-6 py-2.5 text-sm font-medium text-on-accent transition-colors hover:bg-cobalt-dark disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  Generate Post
                </button>
                <button
                  onClick={() => setCustomMode(true)}
                  className="text-sm text-ink/40 hover:text-ink/70 transition-colors"
                >
                  or write your own
                </button>
              </div>
            ) : (
              <div className="mt-4 w-full max-w-lg space-y-3">
                <textarea
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  rows={6}
                  placeholder="Write your post idea, thought, or paste a draft to refine..."
                  className="w-full rounded-lg border border-line bg-bone p-3 text-sm leading-relaxed text-ink focus:border-cobalt focus:outline-none resize-y"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (!customText.trim()) return
                      const id = `custom-${Date.now()}`
                      setData({
                        brief: { id, status: 'custom', localDate: new Date().toISOString().slice(0, 10) },
                        ideas: [{
                          id,
                          title: customText.slice(0, 80),
                          angle: '',
                          whyNow: '',
                          postCaption: customText,
                          postPlatform: platform,
                        } as DailyContentIdea],
                        platform,
                      })
                      setActiveIdeaId(id)
                      setCustomMode(false)
                    }}
                    disabled={!customText.trim()}
                    className="flex items-center gap-2 rounded-lg bg-cobalt px-4 py-2 text-sm font-medium text-on-accent hover:bg-cobalt-dark disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" />
                    Use this post
                  </button>
                  <button
                    onClick={() => { setCustomMode(false); setCustomText('') }}
                    className="text-sm text-ink/40 hover:text-ink/70"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Main content */}
        {activeIdea && (
          <div className="space-y-6">
            {/* Post preview card */}
            <div className="rounded-2xl border border-line bg-bone-raised overflow-hidden">
              {/* Post header */}
              <div className="flex items-center gap-3 border-b border-line px-5 py-3">
                <div className="h-10 w-10 rounded-full bg-cobalt/10 flex items-center justify-center text-cobalt font-semibold text-sm">
                  {displayName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-ink">{displayName}</p>
                  <p className="text-[11px] text-ink/40">Original Creator · 1st</p>
                </div>
                <div className="ml-auto">
                  <span className="rounded-full bg-cobalt/8 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-cobalt">
                    {trendLabel}
                  </span>
                </div>
              </div>

              {/* Post body */}
               <div className="px-5 py-5">
                 <h2 className={`mb-3 font-semibold text-ink leading-snug ${platform === 'x' ? 'text-base' : 'text-xl'}`}>{activeIdea.title}</h2>
                 {activeIdea.postCaption && (
                   <>
                     <div className={`whitespace-pre-wrap text-ink/80 ${platform === 'x' ? 'text-sm leading-[1.6]' : 'text-[15px] leading-[1.7]'}`}>
                       {activeIdea.postCaption}
                     </div>
                     {platform === 'x' && (
                       <div className="mt-2 flex items-center gap-2">
                         <span className={`font-mono text-xs ${activeIdea.postCaption.length > 280 ? 'text-status-danger' : activeIdea.postCaption.length > 250 ? 'text-amber-500' : 'text-ink/30'}`}>
                           {activeIdea.postCaption.length}/280
                         </span>
                       </div>
                     )}
                   </>
                 )}
                 {activeIdea.angle && !activeIdea.postCaption && (
                   <p className="text-sm leading-relaxed text-ink/60">{activeIdea.angle}</p>
                 )}
               </div>

              {/* Actions */}
              <div className="flex items-center gap-2 border-t border-line px-5 py-3 bg-bone/50">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-2 rounded-lg bg-cobalt px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-cobalt-dark"
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
                <button
                  onClick={tryAnother}
                  disabled={generating}
                  className="flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink/60 transition-colors hover:border-cobalt/40 hover:text-cobalt disabled:opacity-50"
                >
                  <Shuffle className={`h-4 w-4 ${generating ? 'animate-spin' : ''}`} />
                  {generating ? 'Generating...' : 'Try another'}
                </button>
                 <button
                   onClick={() => {
                     // Store full idea data for the editor
                     try {
                       sessionStorage.setItem(`studio-idea-${activeIdea.id}`, JSON.stringify({
                         id: activeIdea.id,
                         title: activeIdea.title,
                         angle: activeIdea.angle,
                         whyNow: activeIdea.whyNow,
                         postCaption: activeIdea.postCaption,
                         territory: activeIdea.territory,
                         trendGrounded: activeIdea.trendGrounded,
                         platform: activeIdea.postPlatform,
                         visualType: activeIdea.visualType,
                         visualConcept: activeIdea.visualConcept,
                         visualPrompt: activeIdea.visualPrompt,
                         visualReason: activeIdea.visualReason,
                         qualityResult: (activeIdea as any).qualityResult,
                       }))
                     } catch { /* sessionStorage unavailable */ }
                     router.push(`/studio/post-detail?ideaId=${activeIdea.id}`)
                   }}
                   className="ml-auto rounded-lg px-3 py-2 text-sm text-ink/40 transition-colors hover:text-ink/70"
                 >
                   Edit
                 </button>
              </div>
            </div>

            {/* Image generation */}
            <div className="rounded-2xl border border-line bg-bone-raised p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Image className="h-4 w-4 text-cobalt" />
                  <span className="text-sm font-medium text-ink">Post Image</span>
                </div>
                <button
                  onClick={generateImage}
                  disabled={imageLoading}
                  className="flex items-center gap-1.5 rounded-lg bg-cobalt px-3 py-1.5 text-xs font-medium text-on-accent hover:bg-cobalt-dark disabled:opacity-50"
                >
                  <RefreshCw className={`h-3 w-3 ${imageLoading ? 'animate-spin' : ''}`} />
                  {imageLoading ? 'Creating...' : imageUrl ? 'Regenerate' : 'Generate'}
                </button>
              </div>

              {imageError && (
                <div className="mb-3 flex items-center gap-2 rounded-lg bg-status-danger/5 px-3 py-2">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-status-danger" />
                  <p className="text-xs text-ink/60">{imageError}</p>
                </div>
              )}

              {imageUrl ? (
                <div className="space-y-3">
                  <div className="overflow-hidden rounded-lg border border-line bg-bone">
                    <img src={imageUrl} alt="Post visual" className="w-full object-contain" />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={downloadImage}
                      className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-ink/60 hover:border-cobalt/40 hover:text-cobalt"
                    >
                      <Download className="h-3 w-3" />
                      Download
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-line/50 py-12 text-center">
                  <Image className="mb-3 h-8 w-8 text-ink/20" />
                  <p className="text-sm text-ink/40">Generate an image for this post</p>
                  <p className="mt-1 text-[11px] text-ink/30">AI-generated visual via DALL-E</p>
                </div>
              )}


            </div>

            <canvas ref={canvasRef} className="hidden" />

            {/* Source context */}
            {activeIdea.whyNow && activeIdea.trendGrounded && (
              <div className="flex items-center gap-2 rounded-xl bg-cobalt/5 px-4 py-3">
                <span className="h-2 w-2 rounded-full bg-cobalt" />
                <p className="text-xs text-ink/50">
                  <span className="font-medium text-cobalt">Why now:</span> {activeIdea.whyNow}
                </p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
