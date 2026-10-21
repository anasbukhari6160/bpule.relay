'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Copy, Check, RefreshCw, Image, ExternalLink, Download } from 'lucide-react'

interface PostData {
  id: string
  title: string
  angle: string
  whyNow: string
  postCaption: string
  territory?: string
  trendGrounded?: boolean
  platform?: string
  visualType?: string | null
  visualConcept?: string | null
  visualPrompt?: string | null
  qualityResult?: {
    overall: number
    dimensions: Record<string, number>
    failures: string[]
  } | null
}

export function SimplePostEditor({ post }: { post: PostData }) {
  const router = useRouter()
  const [caption, setCaption] = useState(post.postCaption)
  const [copied, setCopied] = useState(false)
  const [showVisual, setShowVisual] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageLoading, setImageLoading] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Persist edits to sessionStorage so the Studio view picks them up on return.
  const saveChanges = useCallback(() => {
    try {
      const existing = sessionStorage.getItem(`studio-idea-${post.id}`)
      const data = existing ? JSON.parse(existing) : {}
      sessionStorage.setItem(`studio-idea-${post.id}`, JSON.stringify({ ...data, postCaption: caption }))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch { /* sessionStorage unavailable */ }
  }, [caption, post.id])

  const handleCopy = () => {
    navigator.clipboard.writeText(caption)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleGenerateImage = async () => {
    if (!post.visualPrompt) return
    setImageLoading(true)
    setImageError(null)
    try {
      const res = await fetch('/api/content/intelligence/v2/daily-brief/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: post.visualPrompt }),
      })
      if (res.ok) {
        const json = await res.json()
        if (json.url) {
          setImageUrl(json.url)
        } else {
          setImageError(json.error || 'No image returned')
        }
      } else {
        const err = await res.json().catch(() => ({}))
        setImageError(err.error || `Image generation failed (${res.status})`)
      }
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Network error')
    }
    setImageLoading(false)
  }

  const quality = post.qualityResult
  const qualityLabel = quality
    ? quality.overall >= 7 ? 'Strong' : quality.overall >= 5 ? 'Good' : 'Needs work'
    : null
  const qualityColor = quality
    ? quality.overall >= 7 ? 'text-green-600' : quality.overall >= 5 ? 'text-amber-600' : 'text-red-500'
    : ''

  return (
    <div className="min-h-screen bg-bone">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-line bg-bone/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3">
          <button onClick={() => router.back()} className="rounded-lg p-2 hover:bg-bone-raised">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="font-mono text-xs uppercase tracking-wider text-cobalt">Post Editor</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 space-y-6">
        {/* Post info */}
        <div className="rounded-xl border border-line bg-bone-raised p-5 space-y-3">
          <h2 className="text-lg font-semibold text-ink">{post.title}</h2>
          <p className="text-sm text-graphite">{post.angle}</p>
          {post.whyNow && (
            <p className="text-xs text-ink/50"><span className="font-medium">Why now:</span> {post.whyNow}</p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {post.trendGrounded && (
              <span className="rounded-full bg-cobalt/10 px-2 py-0.5 text-xs text-cobalt">Trending</span>
            )}
            {post.territory && (
              <span className="rounded-full bg-bone px-2 py-0.5 text-xs text-ink/60">{post.territory}</span>
            )}
            {qualityLabel && (
              <span className={`rounded-full bg-bone px-2 py-0.5 text-xs font-medium ${qualityColor}`}>
                Quality: {qualityLabel} {quality ? `(${quality.overall}/10)` : ''}
              </span>
            )}
          </div>
        </div>

        {/* Caption editor */}
        <div className="rounded-xl border border-line bg-bone-raised p-5 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-ink">Post text</label>
            <span className="text-xs text-ink/40">{caption.length} chars</span>
          </div>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={10}
            className="w-full rounded-lg border border-line bg-bone p-3 text-sm leading-relaxed text-ink focus:border-cobalt focus:outline-none resize-y"
            placeholder="Write your post..."
          />
          <div className="flex items-center gap-2">
            <button
              onClick={saveChanges}
              className="flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink/60 hover:border-cobalt/40 hover:text-cobalt"
            >
              {saved ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {saved ? 'Saved!' : 'Save changes'}
            </button>
            <button
              onClick={() => { saveChanges(); router.back() }}
              className="flex items-center gap-2 rounded-lg bg-cobalt px-4 py-2 text-sm font-medium text-on-accent hover:bg-cobalt/90"
            >
              <Check className="h-4 w-4" />
              Okay
            </button>
            <button
              onClick={() => {
                const blob = new Blob([caption], { type: 'text/plain' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `relay-post-${Date.now()}.txt`
                a.click()
                URL.revokeObjectURL(url)
              }}
              className="flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink/60 hover:border-cobalt/40 hover:text-cobalt"
            >
              <Download className="h-4 w-4" />
              Download
            </button>
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink/60 hover:border-cobalt/40 hover:text-cobalt"
            >
              {copied ? <Check className="h-4 w-4 text-status-success" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Visual concept */}
        {(post.visualConcept || post.visualPrompt) && (
          <div className="rounded-xl border border-line bg-bone-raised p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Image className="h-4 w-4 text-cobalt" />
                <span className="text-sm font-medium text-ink">Visual concept</span>
              </div>
              <button
                onClick={() => setShowVisual(!showVisual)}
                className="text-xs text-ink/50 hover:text-ink"
              >
                {showVisual ? 'Hide' : 'Show'} details
              </button>
            </div>
            {post.visualConcept && (
              <p className="text-sm text-graphite">{post.visualConcept}</p>
            )}
            {showVisual && post.visualPrompt && (
              <div className="rounded-lg bg-bone p-3 space-y-2">
                <p className="text-xs font-mono text-ink/60 whitespace-pre-wrap">{post.visualPrompt}</p>
              </div>
            )}
            {imageUrl ? (
              <img src={imageUrl} alt="Post visual" className="w-full rounded-lg border border-line" />
            ) : (
              <div className="space-y-2">
                <button
                  onClick={handleGenerateImage}
                  disabled={imageLoading || !post.visualPrompt}
                  className="flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm text-ink/70 hover:border-cobalt/40 hover:text-cobalt disabled:opacity-50"
                >
                  <RefreshCw className={`h-3 w-3 ${imageLoading ? 'animate-spin' : ''}`} />
                  {imageLoading ? 'Generating...' : 'Generate image'}
                </button>
                {imageError && (
                  <p className="text-[11px] text-status-danger">{imageError}</p>
                )}
                {!post.visualPrompt && (
                  <p className="text-[11px] text-stone">No visual prompt set. Edit the idea to add one.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Quality breakdown */}
        {quality && quality.dimensions && (
          <div className="rounded-xl border border-line bg-bone-raised p-5 space-y-3">
            <span className="text-sm font-medium text-ink">Quality breakdown</span>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(quality.dimensions).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between rounded-lg bg-bone px-3 py-2">
                  <span className="text-xs text-ink/60 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                  <span className={`text-xs font-medium ${value >= 7 ? 'text-green-600' : value >= 4 ? 'text-amber-600' : 'text-red-500'}`}>
                    {value.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
