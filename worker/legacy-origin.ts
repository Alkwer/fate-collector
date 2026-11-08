// Preserve existing helper endpoints and browser storage at the previous origin.
export default {
  fetch(request: Request, env: { APP: Fetcher }): Promise<Response> {
    return env.APP.fetch(request)
  },
}
