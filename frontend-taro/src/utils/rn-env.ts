import { normalizeRuntimeEnv } from './runtime-env'

export function isRnEnv(env?: string | null) {
  return normalizeRuntimeEnv(env) === 'rn'
}
