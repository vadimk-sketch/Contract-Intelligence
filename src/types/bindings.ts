// Cloudflare bindings interface
export interface Bindings {
  DB: D1Database
  DOCS: R2Bucket
  BACKUPS: R2Bucket
  AI: Ai

  // Vars
  APP_NAME: string
  APP_URL: string
  EMAIL_FROM: string
  EMAIL_FROM_NAME: string
  INGEST_EMAIL: string
  AI_BUDGET_MONTHLY_USD: string
  BRAND_COLOR: string
  ENVIRONMENT?: string  // "production" | "development" | undefined

  // Secrets (set via wrangler secret put or .dev.vars)
  ANTHROPIC_API_KEY?: string
  RESEND_API_KEY?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  SESSION_SECRET?: string
  REMINDER_LINK_SECRET?: string
  CRON_SECRET?: string  // shared secret for /api/jobs/cron/tick (GitHub Actions auth)
  DEV_AUTO_LOGIN_EMAIL?: string // dev-only auto-login bypass
}

export type AppRole = 'admin' | 'lead' | 'member' | 'readonly' | 'system'

export interface SessionUser {
  id: string
  email: string
  name: string
  role: AppRole
  department_id: string | null
}

export type AppEnv = {
  Bindings: Bindings
  Variables: {
    user?: SessionUser
    requestId: string
  }
}
