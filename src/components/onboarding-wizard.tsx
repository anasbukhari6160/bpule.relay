'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { ContentProfile, ContentIdeaCard } from '@/lib/domain/types'
import { generateDailyIdeas } from '@/lib/content/daily-ideas'

interface OnboardingState {
  displayName: string
  personaRole: string
  personaCompany: string
  personaLocation: string
  sourceText: string
  sourceType: string
  identity: {
    role: string
    seniority: string
    industries: string[]
    expertise: ContentProfile['expertise']
    opinions: ContentProfile['opinions']
    projects: ContentProfile['projects']
    experiences: ContentProfile['experiences']
    technologies: string[]
    audiences: string[]
    territories: string[]
    contentGoals: string[]
  } | null
  selectedGoals: string[]
  selectedAudiences: string[]
  selectedInterests: string[]
  selectedTerritories: string[]
  voiceSelection: string
  selectedComfort: string[]
}

type OnboardingStep = 'identity' | 'import' | 'understanding' | 'goals' | 'audience' | 'interests' | 'territories' | 'voice' | 'comfort' | 'complete'

const STEPS: OnboardingStep[] = ['identity', 'import', 'understanding', 'goals', 'audience', 'interests', 'territories', 'voice', 'comfort']

const ROLE_OPTIONS = [
  'Software Engineer', 'Senior Software Engineer', 'Staff Engineer',
  'Founder', 'CEO', 'CTO', 'VP Engineering',
  'Product Manager', 'Designer', 'Consultant',
  'Marketing Professional', 'Sales Professional', 'Other',
]

const GOAL_OPTIONS = [
  { id: 'get_clients', label: 'Get clients' },
  { id: 'build_authority', label: 'Build authority' },
  { id: 'grow_my_network', label: 'Grow my network' },
  { id: 'get_job_opportunities', label: 'Get job opportunities' },
  { id: 'build_a_personal_brand', label: 'Build a personal brand' },
  { id: 'share_what_i_learn', label: 'Share what I learn' },
  { id: 'grow_my_company', label: 'Grow my company' },
  { id: 'meet_people_in_my_industry', label: 'Meet people in my industry' },
]

const COMFORT_OPTIONS = [
  'Technical lessons', 'Work experiences', 'Opinions',
  'Career journey', 'Mistakes/lessons', 'Behind the scenes',
  'Industry trends', 'Personal reflections',
]

const VOICE_OPTIONS = [
  { id: 'direct', label: 'Direct', example: 'Straight to the point. No fluff.' },
  { id: 'thoughtful', label: 'Thoughtful', example: 'Nuanced and considered.' },
  { id: 'technical', label: 'Technical', example: 'Precise and detailed.' },
  { id: 'conversational', label: 'Conversational', example: 'Like talking to a peer.' },
  { id: 'opinionated', label: 'Opinionated', example: 'Strong takes, clearly stated.' },
  { id: 'educational', label: 'Educational', example: 'Teaching something useful.' },
]

const ONBOARDING_STORAGE_KEY = 'studio-onboarding-v2'

export function OnboardingWizard() {
  const router = useRouter()
  const redirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hydratedRef = useRef(false)
  const [step, setStep] = useState<OnboardingStep>('identity')
  const [state, setState] = useState<OnboardingState>({
    displayName: '',
    personaRole: '',
    personaCompany: '',
    personaLocation: '',
    sourceText: '',
    sourceType: 'bio',
    identity: null,
    selectedGoals: [],
     selectedAudiences: [],
     selectedInterests: [],
     selectedTerritories: [],
     voiceSelection: '',
     selectedComfort: [],
  })
  const [extracting, setExtracting] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [suggestedIdeas, setSuggestedIdeas] = useState<ContentIdeaCard[]>([])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ONBOARDING_STORAGE_KEY)
      if (!raw) {
        hydratedRef.current = true
        return
      }
      const parsed = JSON.parse(raw) as { step?: OnboardingStep; state?: OnboardingState }
      if (parsed.step && STEPS.includes(parsed.step)) {
        setStep(parsed.step)
      }
      if (parsed.state) {
        setState((prev) => ({ ...prev, ...parsed.state }))
      }
    } catch {
      // Ignore malformed local data and continue with defaults.
    } finally {
      hydratedRef.current = true
    }
  }, [])

  useEffect(() => {
    if (!hydratedRef.current || step === 'complete') return
    try {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ step, state }))
    } catch {
      // Ignore storage failures.
    }
  }, [state, step])

  useEffect(() => {
    return () => {
      if (redirectTimeoutRef.current) clearTimeout(redirectTimeoutRef.current)
    }
  }, [])

  const currentStepIndex = STEPS.indexOf(step)

  const update = useCallback((patch: Partial<OnboardingState>) => {
    setState((prev) => ({ ...prev, ...patch }))
  }, [])

  const canProceed = (): boolean => {
    switch (step) {
      case 'identity': return state.displayName.trim().length > 0
      case 'import': return true // Can skip
      case 'understanding': return true // Can proceed after viewing
      case 'goals': return state.selectedGoals.length > 0
      case 'audience': return state.selectedAudiences.length > 0
      case 'interests': return state.selectedInterests.length > 0
      case 'territories': return state.selectedTerritories.length >= 2
      case 'voice': return state.voiceSelection !== ''
      case 'comfort': return true // Can skip
      default: return true
    }
  }

  const handleExtractSource = async () => {
    if (state.sourceText.trim().length < 20) {
      update({ identity: null })
      setStep('goals')
      return
    }
    setExtracting(true)
    setError('')
    try {
      const res = await fetch('/api/content/onboarding/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceText: state.sourceText, sourceType: state.sourceType }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `Request failed (${res.status})`)
      }
      const data = await res.json()
      if (data.identity) {
        update({
          identity: data.identity,
          selectedGoals: data.identity.contentGoals?.slice(0, 3) ?? [],
          selectedAudiences: data.identity.audiences?.slice(0, 4) ?? [],
          selectedTerritories: data.identity.territories?.slice(0, 5) ?? [],
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not parse source. Please try again or skip.')
    }
    setExtracting(false)
    setStep('understanding')
  }

  const handleComplete = async () => {
    setCreating(true)
    setError('')
    try {
      // Map component state field names to the API's expected contract.
      // Without this, selectedComfort/platforms/humorStyle silently drop.
      const res = await fetch('/api/content/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: state.displayName,
          platforms: ['linkedin'],
          personaRole: state.personaRole,
          personaCompany: state.personaCompany,
          personaLocation: state.personaLocation,
          contentComfort: state.selectedComfort,
          sourceText: state.sourceText,
          sourceType: state.sourceType,
          selectedGoals: state.selectedGoals,
          selectedAudiences: state.selectedAudiences,
          selectedInterests: state.selectedInterests,
          selectedTerritories: state.selectedTerritories,
          voiceSelection: state.voiceSelection,
          humorStyle: state.voiceSelection,
          identity: state.identity,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.error || `Setup failed (${res.status})`)
      }

      if (data.redirectTo) {
        if (data.profile) {
          const ideas = generateDailyIdeas({
            profile: data.profile,
            clusters: [],
            history: [],
            memories: [],
            journey: [],
            contentGoals: state.selectedGoals,
            audiences: state.selectedAudiences,
            territories: state.selectedTerritories,
          })
          setSuggestedIdeas(ideas.slice(0, 5))
        }

        try {
          localStorage.removeItem(ONBOARDING_STORAGE_KEY)
        } catch {
          // Ignore storage failures.
        }

        setStep('complete')
        // Redirect after a brief pause
        redirectTimeoutRef.current = setTimeout(() => {
          router.push(data.redirectTo)
        }, 3000)
      } else {
        setError(data?.error || 'Creation failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Creation failed. Please try again.')
    }
    setCreating(false)
  }

  const goNext = () => {
    const idx = STEPS.indexOf(step)
    if (idx < STEPS.length - 1) {
      setStep(STEPS[idx + 1])
    }
  }

  const goBack = () => {
    const idx = STEPS.indexOf(step)
    if (idx > 0) {
      setStep(STEPS[idx - 1])
    }
  }

  if (step === 'complete') {
    return (
      <div className="mx-auto max-w-lg space-y-6 px-4 py-12 text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-green-100 p-3">
          <svg className="h-6 w-6 text-status-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-ink">You&apos;re all set!</h2>
        <p className="text-sm text-graphite">
          Your Content Identity is ready. Redirecting you to your personalized Studio...
        </p>
        {suggestedIdeas.length > 0 && (
          <div className="mt-6 text-left">
            <p className="mb-3 text-xs font-medium uppercase tracking-wider text-graphite">
              Your first ideas
            </p>
            <div className="space-y-2">
              {suggestedIdeas.map((idea) => (
                <div key={idea.id} className="rounded-lg border border-ink/10 p-3">
                  <p className="text-sm font-medium text-ink">{idea.title}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      {/* Progress */}
      <div className="mb-8">
        <div className="flex items-center justify-between text-xs text-graphite">
          <span>Step {currentStepIndex + 1} of {STEPS.length}</span>
          <span>{Math.round(((currentStepIndex + 1) / STEPS.length) * 100)}%</span>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-ink/10">
          <div
            className="h-full rounded-full bg-ink transition-all"
            style={{ width: `${((currentStepIndex + 1) / STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Step Content */}
      <div className="min-h-[400px]">
        {step === 'identity' && (
          <StepIdentity state={state} update={update} />
        )}
        {step === 'import' && (
          <StepImport state={state} update={update} onExtract={handleExtractSource} extracting={extracting} />
        )}
        {step === 'understanding' && (
          <StepUnderstanding state={state} update={update} />
        )}
        {step === 'goals' && (
          <StepGoals state={state} update={update} />
        )}
        {step === 'audience' && (
          <StepAudience state={state} update={update} />
        )}
        {step === 'interests' && (
          <StepInterests state={state} update={update} />
        )}
        {step === 'territories' && (
          <StepTerritories state={state} update={update} />
        )}
        {step === 'voice' && (
          <StepVoice state={state} update={update} />
        )}
        {step === 'comfort' && (
          <StepComfort state={state} update={update} />
        )}
      </div>

      {/* Error */}
      {error && (
        <p className="mt-4 rounded-lg bg-status-danger/5 p-3 text-xs text-status-danger">{error}</p>
      )}

      {/* Navigation */}
      <div className="mt-8 flex items-center justify-between">
        <button
          onClick={goBack}
          disabled={currentStepIndex === 0}
          className="rounded-lg px-4 py-2 text-sm text-graphite hover:text-ink disabled:opacity-0"
        >
          Back
        </button>
        {step === 'comfort' ? (
          <button
            onClick={handleComplete}
            disabled={!canProceed() || creating}
            className="rounded-lg bg-solid px-6 py-2.5 text-sm font-medium text-on-solid hover:bg-solid/90 disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Complete setup'}
          </button>
        ) : (
          <button
            onClick={goNext}
            disabled={!canProceed()}
            className="rounded-lg bg-solid px-6 py-2.5 text-sm font-medium text-on-solid hover:bg-solid/90 disabled:opacity-50"
          >
            Continue
          </button>
        )}
      </div>
    </div>
  )
}

function StepIdentity({ state, update }: { state: OnboardingState; update: (p: Partial<OnboardingState>) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-ink">What best describes you?</h2>
        <p className="mt-1 text-sm text-graphite">We&apos;ll adapt the rest of onboarding to your role.</p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ROLE_OPTIONS.map((role) => (
          <button
            key={role}
            onClick={() => update({ personaRole: role })}
            className={`rounded-lg border px-3 py-2.5 text-sm text-left transition-colors ${
              state.personaRole === role
                ? 'border-ink bg-solid text-on-solid'
                : 'border-ink/15 hover:border-ink/30'
            }`}
          >
            {role}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        <div>
          <input
            type="text"
            value={state.displayName}
            onChange={(e) => update({ displayName: e.target.value })}
            placeholder="Your name (e.g. Sarah Chen)"
            aria-required="true"
            className="w-full rounded-lg border border-ink/15 px-3 py-2.5 text-sm focus:border-ink/30 focus:outline-none"
          />
          <p className="mt-1 text-xs text-graphite">Required to continue.</p>
        </div>
        <input
          type="text"
          value={state.personaCompany}
          onChange={(e) => update({ personaCompany: e.target.value })}
          placeholder="Company (optional)"
          className="w-full rounded-lg border border-ink/15 px-3 py-2.5 text-sm focus:border-ink/30 focus:outline-none"
        />
        <input
          type="text"
          value={state.personaLocation}
          onChange={(e) => update({ personaLocation: e.target.value })}
          placeholder="Location (optional)"
          className="w-full rounded-lg border border-ink/15 px-3 py-2.5 text-sm focus:border-ink/30 focus:outline-none"
        />
      </div>
    </div>
  )
}

function StepImport({ state, update, onExtract, extracting }: { state: OnboardingState; update: (p: Partial<OnboardingState>) => void; onExtract: () => void; extracting: boolean }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-ink">Let Relay learn about you</h2>
        <p className="mt-1 text-sm text-graphite">Paste your LinkedIn, bio, resume, or past posts. Skip if you prefer.</p>
      </div>
      <textarea
        value={state.sourceText}
        onChange={(e) => update({ sourceText: e.target.value })}
        placeholder="Paste your LinkedIn summary, bio, or CV here..."
        className="w-full rounded-lg border border-ink/15 p-3 text-sm focus:border-ink/30 focus:outline-none"
        rows={8}
      />
      <div className="flex items-center gap-3">
        <button
          onClick={onExtract}
          disabled={extracting || (state.sourceText.trim().length > 0 && state.sourceText.trim().length < 20)}
          className="rounded-lg bg-solid px-4 py-2 text-sm font-medium text-on-solid hover:bg-solid/90 disabled:opacity-50"
        >
          {extracting ? 'Analyzing...' : 'Analyze'}
        </button>
        <button
          onClick={() => update({ identity: state.identity })}
          className="text-sm text-graphite underline underline-offset-2 hover:text-ink"
        >
          Skip this step
        </button>
      </div>
    </div>
  )
}

function StepUnderstanding({ state, update: _update }: { state: OnboardingState; update: (p: Partial<OnboardingState>) => void }) {
  const identity = state.identity
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-ink">Here&apos;s what Relay understood</h2>
        <p className="mt-1 text-sm text-graphite">Review and continue. You can edit everything later.</p>
      </div>
      {!identity ? (
        <div className="rounded-lg border border-dashed border-ink/20 p-6 text-center">
          <p className="text-sm text-graphite">No source provided. You can add details in your Content Identity later.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-graphite">You are</p>
            <p className="mt-1 text-sm font-medium text-ink">{identity.role} · {identity.seniority}</p>
          </div>
          {(identity.expertise?.length ?? 0) > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-graphite">Strongest expertise</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {identity.expertise.slice(0, 8).map((e) => (
                  <span key={e.area} className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                    {e.area}
                  </span>
                ))}
              </div>
            </div>
          )}
          {(identity.industries?.length ?? 0) > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-graphite">Experience</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {identity.industries.map((ind) => (
                  <span key={ind} className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                    {ind}
                  </span>
                ))}
              </div>
            </div>
          )}
          {(identity.territories?.length ?? 0) > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-graphite">You could credibly talk about</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {identity.territories.slice(0, 8).map((t) => (
                  <span key={t} className="rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-medium text-purple-700">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StepGoals({ state, update }: { state: OnboardingState; update: (p: Partial<OnboardingState>) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-ink">What should your content do for you?</h2>
        <p className="mt-1 text-sm text-graphite">Select all that apply.</p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {GOAL_OPTIONS.map((goal) => {
          const selected = state.selectedGoals.includes(goal.id)
          return (
            <button
              key={goal.id}
              onClick={() => {
                const goals = selected
                  ? state.selectedGoals.filter((g) => g !== goal.id)
                  : [...state.selectedGoals, goal.id]
                update({ selectedGoals: goals })
              }}
              className={`rounded-lg border px-3 py-2.5 text-sm text-left transition-colors ${
                selected ? 'border-ink bg-solid text-on-solid' : 'border-ink/15 hover:border-ink/30'
              }`}
            >
              {goal.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function defaultAudiences(role: string): string[] {
  const r = role.toLowerCase()
  if (/founder|ceo|cto|chief|president|owner/.test(r)) return ['founders', 'investors', 'tech leaders', 'potential hires']
  if (/engineer|developer|architect|devops|sre/.test(r)) return ['software engineers', 'engineering managers', 'CTOs', 'peers in tech']
  if (/designer|ux|ui|creative/.test(r)) return ['designers', 'product managers', 'founders', 'creative professionals']
  if (/product|pm/.test(r)) return ['product managers', 'founders', 'engineers', 'startup community']
  if (/sales|account|business.dev|growth/.test(r)) return ['sales leaders', 'founders', 'B2B buyers', 'revenue teams']
  if (/marketing|content/.test(r)) return ['marketers', 'founders', 'content creators', 'growth leaders']
  if (/consultant|freelance/.test(r)) return ['potential clients', 'peers in my industry', 'decision makers', 'founders']
  if (/recruiter|talent|hr/.test(r)) return ['hiring managers', 'job seekers', 'HR leaders', 'founders']
  return ['peers in my field', 'industry professionals', 'decision makers', 'thought leaders']
}

function StepAudience({ state, update }: { state: OnboardingState; update: (p: Partial<OnboardingState>) => void }) {
  const suggested = state.identity?.audiences ?? defaultAudiences(state.personaRole)
  const [custom, setCustom] = useState('')

  const toggleAudience = (aud: string) => {
    const selected = state.selectedAudiences.includes(aud)
      ? state.selectedAudiences.filter((a) => a !== aud)
      : [...state.selectedAudiences, aud]
    update({ selectedAudiences: selected })
  }

  const addCustom = () => {
    if (custom.trim() && !state.selectedAudiences.includes(custom.trim())) {
      update({ selectedAudiences: [...state.selectedAudiences, custom.trim()] })
      setCustom('')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-ink">Who should your content reach?</h2>
        <p className="mt-1 text-sm text-graphite">Suggested based on your profile.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {suggested.map((aud) => (
          <button
            key={aud}
            onClick={() => toggleAudience(aud)}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              state.selectedAudiences.includes(aud)
                ? 'border-ink bg-solid text-on-solid'
                : 'border-ink/15 hover:border-ink/30'
            }`}
          >
            {aud}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Add another audience..."
          className="flex-1 rounded-lg border border-ink/15 px-3 py-2 text-sm focus:border-ink/30 focus:outline-none"
          onKeyDown={(e) => { if (e.key === 'Enter') addCustom() }}
        />
        <button onClick={addCustom} className="rounded-lg border border-ink/15 px-3 py-2 text-sm hover:border-ink/30">
          Add
        </button>
      </div>
    </div>
  )
}

function defaultTerritories(role: string): string[] {
  const r = role.toLowerCase()
  if (/founder|ceo|cto|chief|president|owner/.test(r)) return ['startup lessons', 'fundraising', 'team building', 'product strategy', 'leadership']
  if (/engineer|developer|architect/.test(r)) return ['software engineering', 'system design', 'coding best practices', 'tech leadership', 'developer tools']
  if (/devops|sre|platform|infra/.test(r)) return ['infrastructure', 'reliability', 'cloud architecture', 'automation', 'observability']
  if (/designer|ux|ui|creative/.test(r)) return ['design systems', 'user experience', 'product design', 'accessibility', 'design leadership']
  if (/product|pm/.test(r)) return ['product management', 'user research', 'product strategy', 'roadmap planning', 'stakeholder management']
  if (/sales|account|business.dev/.test(r)) return ['sales strategy', 'B2B sales', 'closing techniques', 'sales operations', 'relationship building']
  if (/marketing|content/.test(r)) return ['content marketing', 'growth strategy', 'brand building', 'SEO', 'social media']
  if (/consultant|freelance/.test(r)) return ['consulting insights', 'client management', 'niche expertise', 'personal branding', 'industry trends']
  if (/recruiter|talent|hr/.test(r)) return ['hiring strategy', 'talent acquisition', 'employer branding', 'career development', 'team culture']
  return ['industry insights', 'professional development', 'leadership', 'trends', 'lessons learned']
}

const INTEREST_OPTIONS = [
  'AI & Machine Learning', 'Building Products', 'Startups & Founding',
  'Developer Tools', 'Open Source', 'Cloud & Infrastructure',
  'Security & Privacy', 'Data Engineering', 'Web3 & Crypto',
  'Remote Work & Culture', 'Hiring & Teams', 'Technical Leadership',
  'Side Projects', 'No-Code / Low-Code', 'Mobile Dev', 'DevOps & SRE',
]

function StepInterests({ state, update }: { state: OnboardingState; update: (p: Partial<OnboardingState>) => void }) {
  const [custom, setCustom] = useState('')

  const toggleInterest = (interest: string) => {
    const selected = state.selectedInterests.includes(interest)
      ? state.selectedInterests.filter((i) => i !== interest)
      : [...state.selectedInterests, interest]
    update({ selectedInterests: selected })
  }

  const addCustom = () => {
    if (custom.trim() && !state.selectedInterests.includes(custom.trim())) {
      update({ selectedInterests: [...state.selectedInterests, custom.trim()] })
      setCustom('')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-ink">What do you follow on the internet?</h2>
        <p className="mt-1 text-sm text-graphite">Select topics you read about, not just your job. This is where your best content angles come from.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {INTEREST_OPTIONS.map((interest) => {
           const selected = state.selectedInterests.includes(interest)
           return (
            <button
              key={interest}
              onClick={() => toggleInterest(interest)}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                selected ? 'border-ink bg-solid text-on-solid' : 'border-ink/15 hover:border-ink/30'
              }`}
            >
              {interest}
            </button>
           )
          })}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Add another interest (e.g. 'rust programming')..."
          className="flex-1 rounded-lg border border-ink/15 px-3 py-2 text-sm focus:border-ink/30 focus:outline-none"
          onKeyDown={(e) => { if (e.key === 'Enter') addCustom() }}
        />
        <button onClick={addCustom} className="rounded-lg border border-ink/15 px-3 py-2 text-sm hover:border-ink/30">
          Add
        </button>
      </div>
      <p className="text-xs text-graphite">{state.selectedInterests.length} selected</p>
    </div>
  )
}

function StepTerritories({ state, update }: { state: OnboardingState; update: (p: Partial<OnboardingState>) => void }) {
  const suggested = state.identity?.territories ?? defaultTerritories(state.personaRole)
  const [custom, setCustom] = useState('')

  const toggleTerritory = (terr: string) => {
    const selected = state.selectedTerritories.includes(terr)
      ? state.selectedTerritories.filter((t) => t !== terr)
      : [...state.selectedTerritories, terr]
    update({ selectedTerritories: selected })
  }

  const addCustom = () => {
    if (custom.trim() && !state.selectedTerritories.includes(custom.trim())) {
      update({ selectedTerritories: [...state.selectedTerritories, custom.trim()] })
      setCustom('')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-ink">What do you want to become known for?</h2>
        <p className="mt-1 text-sm text-graphite">Select 3–6 topics.</p>
      </div>
      {suggested.length === 0 && state.selectedTerritories.length === 0 && (
        <p className="rounded-lg border border-dashed border-ink/20 p-4 text-sm text-graphite">
          No suggestions yet — add at least 2 topics below to continue.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {[...new Set([...suggested, ...state.selectedTerritories])].map((terr) => (
          <button
            key={terr}
            onClick={() => toggleTerritory(terr)}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              state.selectedTerritories.includes(terr)
                ? 'border-ink bg-solid text-on-solid'
                : 'border-ink/15 hover:border-ink/30'
            }`}
          >
            {terr}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Add a topic..."
          className="flex-1 rounded-lg border border-ink/15 px-3 py-2 text-sm focus:border-ink/30 focus:outline-none"
          onKeyDown={(e) => { if (e.key === 'Enter') addCustom() }}
        />
        <button onClick={addCustom} className="rounded-lg border border-ink/15 px-3 py-2 text-sm hover:border-ink/30">
          Add
        </button>
      </div>
    </div>
  )
}

function StepVoice({ state, update }: { state: OnboardingState; update: (p: Partial<OnboardingState>) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-ink">How should you sound?</h2>
        <p className="mt-1 text-sm text-graphite">Choose the style that feels most like you.</p>
      </div>
      <div className="space-y-2">
        {VOICE_OPTIONS.map((voice) => (
          <button
            key={voice.id}
            onClick={() => update({ voiceSelection: voice.id })}
            className={`w-full rounded-lg border p-3 text-left transition-colors ${
              state.voiceSelection === voice.id
                ? 'border-ink bg-solid text-on-solid'
                : 'border-ink/15 hover:border-ink/30'
            }`}
          >
            <p className="text-sm font-medium">{voice.label}</p>
            <p className={`mt-0.5 text-xs ${state.voiceSelection === voice.id ? 'text-bone/70' : 'text-graphite'}`}>
              {voice.example}
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}

function StepComfort({ state, update }: { state: OnboardingState; update: (p: Partial<OnboardingState>) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-ink">What are you comfortable posting about?</h2>
        <p className="mt-1 text-sm text-graphite">Relay will prioritize these. You can change anytime.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {COMFORT_OPTIONS.map((item) => {
          const selected = state.selectedComfort.includes(item)
          return (
            <button
              key={item}
              onClick={() => {
                const comfort = selected
                  ? state.selectedComfort.filter((c) => c !== item)
                  : [...state.selectedComfort, item]
                update({ selectedComfort: comfort })
              }}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                selected ? 'border-ink bg-solid text-on-solid' : 'border-ink/15 hover:border-ink/30'
              }`}
            >
              {item}
            </button>
          )
        })}
      </div>
    </div>
  )
}
