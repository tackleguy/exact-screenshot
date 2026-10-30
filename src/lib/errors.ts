/**
 * What visitors see when something fails: a short, plain sentence, never a raw database or network message
 * ("Could not find the table 'public.activities' in the schema cache", "JWT expired", "Failed to fetch").
 * Messages written for people (route errors, sign-in problems) pass through unchanged.
 */
type ErrorLike = { message?: unknown; code?: unknown; status?: unknown } | null | undefined;

/** Database, permission, network and code-level wording that should never reach the page. */
const TECHNICAL = /schema cache|relation "|column "|table '|function |permission denied|violates|duplicate key|syntax error|\bJWT\b|PGRST|postgres|supabase|row-level security|failed to fetch|networkerror|load failed|fetch failed|typeerror|unexpected token|not valid json|\bnull\b|undefined|status code|\b[45]\d\d\b|\bkey\b|token|signature|unauthori[sz]ed|forbidden|uuid|invalid input/i;

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  const m = (error as ErrorLike)?.message;
  return typeof m === "string" ? m : "";
}

/** True when the database simply doesn't have this feature's table yet (its migration isn't applied). */
export function isMissingTable(error: unknown): boolean {
  const e = error as ErrorLike;
  return e?.code === "PGRST205" || e?.code === "42P01" || /schema cache|does not exist/i.test(messageOf(error));
}

/** A sentence fit to show: the error's own message when it was written for people, otherwise `fallback`. */
export function friendlyError(error: unknown, fallback: string): string {
  const message = messageOf(error).trim();
  if (!message || message.length > 160 || TECHNICAL.test(message)) return fallback;
  return message;
}
