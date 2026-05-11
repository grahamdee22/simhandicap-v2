/** Bearer for native OAuth when Supabase JS has no in-memory session (e.g. Google implicit). */
export let googleOAuthAccessToken: string | null = null;

export function setGoogleOAuthAccessToken(token: string | null): void {
  googleOAuthAccessToken = token;
}

export function clearGoogleOAuthAccessToken(): void {
  googleOAuthAccessToken = null;
}
