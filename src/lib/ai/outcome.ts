/**
 * Result of an AI auto-reply attempt, as the inbound router sees it.
 *
 *  - handled   the AI answered (or deliberately took over, e.g. a human-handover notice)
 *  - declined  the AI is off / not set up / chose not to answer; other handlers may run
 *  - failed    the AI should have answered but could not (model down, unparseable output,
 *              unexpected error). The customer must not be left in silence, and flows or
 *              automations must not answer in its place.
 */
export type AiOutcome = 'handled' | 'declined' | 'failed';

/**
 * Thrown by an AI handler when the model call fails *before* anything was sent.
 * The router retries once and then sends the "team will reply" fallback.
 */
export class AiUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}
