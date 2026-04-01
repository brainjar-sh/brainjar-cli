import { Errors } from 'incur'

const { IncurError } = Errors

// ---------------------------------------------------------------------------
// Error codes — single source of truth
// ---------------------------------------------------------------------------

export const ErrorCode = {
  // HTTP-mapped
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  SERVER_ERROR: 'SERVER_ERROR',
  SERVER_UNAVAILABLE: 'SERVER_UNAVAILABLE',
  API_ERROR: 'API_ERROR',

  // Domain: souls
  SOUL_EXISTS: 'SOUL_EXISTS',
  SOUL_NOT_FOUND: 'SOUL_NOT_FOUND',

  // Domain: personas
  PERSONA_EXISTS: 'PERSONA_EXISTS',
  PERSONA_NOT_FOUND: 'PERSONA_NOT_FOUND',

  // Domain: brains
  BRAIN_EXISTS: 'BRAIN_EXISTS',
  BRAIN_NOT_FOUND: 'BRAIN_NOT_FOUND',

  // Domain: rules
  RULE_EXISTS: 'RULE_EXISTS',
  RULE_NOT_FOUND: 'RULE_NOT_FOUND',
  RULES_NOT_FOUND: 'RULES_NOT_FOUND',

  // Domain: state
  NO_ACTIVE_SOUL: 'NO_ACTIVE_SOUL',
  NO_ACTIVE_PERSONA: 'NO_ACTIVE_PERSONA',

  // Packs
  PACK_INVALID_VERSION: 'PACK_INVALID_VERSION',
  PACK_DIR_EXISTS: 'PACK_DIR_EXISTS',
  PACK_NO_MANIFEST: 'PACK_NO_MANIFEST',
  PACK_CORRUPT_MANIFEST: 'PACK_CORRUPT_MANIFEST',
  PACK_INVALID_MANIFEST: 'PACK_INVALID_MANIFEST',
  PACK_MISSING_FILE: 'PACK_MISSING_FILE',
  PACK_NOT_DIR: 'PACK_NOT_DIR',
  PACK_NOT_FOUND: 'PACK_NOT_FOUND',

  // Infra
  TIMEOUT: 'TIMEOUT',
  SERVER_UNREACHABLE: 'SERVER_UNREACHABLE',
  BINARY_NOT_FOUND: 'BINARY_NOT_FOUND',
  SERVER_START_FAILED: 'SERVER_START_FAILED',

  // Validation
  MUTUALLY_EXCLUSIVE: 'MUTUALLY_EXCLUSIVE',
  MISSING_ARG: 'MISSING_ARG',
  NO_OVERRIDES: 'NO_OVERRIDES',

  // Other
  INVALID_MODE: 'INVALID_MODE',
  SHELL_ERROR: 'SHELL_ERROR',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

// ---------------------------------------------------------------------------
// Message templates — parameterized messages are functions, static are strings
// Not every code needs an entry. Codes with context-dependent messages
// (e.g. PACK_INVALID_MANIFEST) keep messages inline at the call site.
// ---------------------------------------------------------------------------

export const Messages: Partial<Record<ErrorCode, string | ((...args: string[]) => string)>> = {
  // Souls
  SOUL_EXISTS: (name: string) => `Soul "${name}" already exists.`,
  SOUL_NOT_FOUND: (name: string) => `Soul "${name}" not found.`,

  // Personas
  PERSONA_EXISTS: (name: string) => `Persona "${name}" already exists.`,
  PERSONA_NOT_FOUND: (name: string) => `Persona "${name}" not found.`,

  // Brains
  BRAIN_EXISTS: (name: string) => `Brain "${name}" already exists.`,
  BRAIN_NOT_FOUND: (name: string) => `Brain "${name}" not found.`,

  // Rules
  RULE_EXISTS: (name: string) => `Rule "${name}" already exists.`,
  RULE_NOT_FOUND: (name: string) => `Rule "${name}" not found.`,

  // State
  NO_ACTIVE_SOUL: 'Cannot save brain: no active soul.',
  NO_ACTIVE_PERSONA: 'Cannot save brain: no active persona.',

  // Packs
  PACK_DIR_EXISTS: (dir: string) => `Pack directory "${dir}" already exists.`,
  PACK_NO_MANIFEST: (dir: string) => `No pack.yaml found in "${dir}". Is this a brainjar pack?`,
  PACK_NOT_DIR: (path: string) => `Pack path "${path}" is a file, not a directory. Packs are directories.`,
  PACK_NOT_FOUND: (path: string) => `Pack path "${path}" does not exist.`,

  // Infra
  SERVER_UNREACHABLE: (url: string) => `Cannot reach server at ${url}`,
}

// ---------------------------------------------------------------------------
// Hints — not every code has one
// ---------------------------------------------------------------------------

export const Hints: Partial<Record<ErrorCode, string | ((...args: string[]) => string)>> = {
  SOUL_EXISTS: 'Choose a different name or edit the existing soul.',
  SOUL_NOT_FOUND: 'Run `brainjar soul list` to see available souls.',
  PERSONA_EXISTS: 'Choose a different name or edit the existing persona.',
  PERSONA_NOT_FOUND: 'Run `brainjar persona list` to see available personas.',
  BRAIN_EXISTS: 'Use --overwrite to replace it, or choose a different name.',
  BRAIN_NOT_FOUND: 'Run `brainjar brain list` to see available brains.',
  RULE_EXISTS: 'Choose a different name or edit the existing rule.',
  RULE_NOT_FOUND: 'Run `brainjar rules list` to see available rules.',
  NO_ACTIVE_SOUL: 'Activate a soul first with `brainjar soul use <name>`.',
  NO_ACTIVE_PERSONA: 'Activate a persona first with `brainjar persona use <name>`.',
  PACK_DIR_EXISTS: 'Remove it first or use a different --out path.',
  BINARY_NOT_FOUND: "Run 'brainjar init' to install the server.",
}

// ---------------------------------------------------------------------------
// Factory — convenience for common patterns. Not mandatory.
// ---------------------------------------------------------------------------

export interface CreateErrorOptions {
  message?: string
  params?: string[]
  hint?: string
  retryable?: boolean
  cause?: Error
}

export function createError(code: ErrorCode, options?: CreateErrorOptions): InstanceType<typeof IncurError> {
  const template = Messages[code]
  const message = options?.message
    ?? (typeof template === 'function' ? template(...(options?.params ?? [])) : template)
    ?? code
  const hintTemplate = Hints[code]
  const hint = options?.hint
    ?? (typeof hintTemplate === 'function' ? (hintTemplate as (...args: string[]) => string)(...(options?.params ?? [])) : hintTemplate)

  return new IncurError({ code, message, hint, retryable: options?.retryable, cause: options?.cause })
}
