/**
 * Golden set fixture contract.
 *
 * Every fixture is SYNTHETIC (fictional people and companies) and frozen.
 * Expectations are RANGES and SETS, never one exact number. `model` is an
 * optional simulated decision-model answer so fixtures can test the guards
 * (what happens when the model is wrong) as well as the happy path.
 */
import type { SimulatedModel } from '../helpers/score-source'

export type GoldenCategory =
  | 'explicit_buyer'
  | 'explicit_contractor'
  | 'startup_founder'
  | 'enterprise_founder'
  | 'technical_founder'
  | 'nontechnical_founder'
  | 'active_builder'
  | 'stale_founder'
  | 'job_seeker'
  | 'candidate'
  | 'recruiter'
  | 'service_provider'
  | 'agency'
  | 'competitor'
  | 'consultant'
  | 'product_seller'
  | 'multilingual'
  | 'historical_launch'
  | 'current_launch'
  | 'historical_hiring'
  | 'current_hiring'
  | 'company_hiring_employees'
  | 'company_requesting_agency'
  | 'funded_startup'
  | 'bootstrap_startup'
  | 'enterprise_employee'
  | 'multi_company_founder'
  | 'strong_fit_no_intent'
  | 'weak_fit_high_intent'
  | 'no_posts'
  | 'many_posts'
  | 'incomplete_profile'
  | 'upwork_style_buyer'
  | 'cold_passive_executive'
  | 'adversarial'

export type Qualification = 'STRONG' | 'WORTH_PURSUING' | 'MAYBE' | 'LOW' | 'SKIP'
export type Intent = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'
export type CP = 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'
export type Role = 'BUYER' | 'BUYER_AND_SELLER' | 'SELLER' | 'BUILDER' | 'RECRUITER' | 'CANDIDATE' | 'UNKNOWN'
export type Action =
  | 'CONTACT_NOW' | 'CONNECT_WITH_NOTE' | 'CONNECT_WITHOUT_NOTE' | 'RESEARCH_MORE' | 'OBSERVE' | 'WAIT' | 'CLOSE'

export interface GoldenExpectation {
  scoreRange?: [number, number]
  qualification?: Qualification[]
  buyerIntent?: Intent[]
  commercialPotential?: CP[]
  relationshipRole?: Role[]
  action?: Action[]
  currentIndustry?: string | null
  /** Industry that must NOT be resolved as current (planted from a past role or use case). */
  notIndustry?: string
  verifiedBudget?: boolean
  verifiedHiring?: boolean
  /** Sender id expected to rank first, for routing fixtures. */
  bestSender?: string
  confidence?: Array<'HIGH' | 'MEDIUM' | 'LOW'>
}

export interface GoldenFixture {
  id: string
  category: GoldenCategory
  /** Why this fixture exists / what it protects. */
  notes: string
  rawText: string
  /** Simulated decision-model answer; omitted = deterministic fallback. */
  model?: SimulatedModel | null
  expect: GoldenExpectation
  /** Strings that must NOT appear as positive evidence/reasons. */
  mustNotCredit?: string[]
}
