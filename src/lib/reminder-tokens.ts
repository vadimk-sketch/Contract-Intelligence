import { SignJWT, jwtVerify } from 'jose'
import type { Bindings } from '../types/bindings'

// One-click reminder action tokens (no login required)
// Used for Acknowledge / Snooze / Mark Complete email links

export type ReminderAction = 'ack' | 'snooze' | 'complete'

export interface ReminderTokenPayload {
  rid: string  // reminder_id
  uid: string  // user_id (recipient)
  act: ReminderAction
  sd?: number  // snooze days (for action=snooze)
}

function getSecret(env: Bindings): Uint8Array {
  const raw = env.REMINDER_LINK_SECRET || 'dev-only-insecure-reminder-secret-change-me'
  return new TextEncoder().encode(raw)
}

export async function signReminderToken(
  env: Bindings,
  payload: ReminderTokenPayload,
  ttlDays = 30
): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttlDays}d`)
    .sign(getSecret(env))
}

export async function verifyReminderToken(
  env: Bindings,
  token: string
): Promise<ReminderTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(env))
    return payload as unknown as ReminderTokenPayload
  } catch {
    return null
  }
}
