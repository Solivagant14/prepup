export type DomainErrorCode = "not_found" | "invalid" | "rule";

/** An expected failure the caller can show to the user, as opposed to a bug. */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
