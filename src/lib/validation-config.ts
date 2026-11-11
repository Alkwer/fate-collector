import { z } from 'zod'

// Run before App's dependencies construct any schemas. Firefox reports Zod's
// caught eval capability probe as a CSP violation; the interpreted validator
// preserves all checks without weakening script-src.
z.config({ jitless: true })
