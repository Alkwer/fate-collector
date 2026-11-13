import { z } from 'zod'

// Every schema depends on this configured instance, including shared lazy chunks.
// Entry-point side effects alone cannot guarantee execution before chunk imports.
// Keep validation interpreted: strict CSP rejects even a caught eval probe.
z.config({ jitless: true })
export { z }
