export class WorkerError extends Error {
  constructor(code, message, { retryable = true, cause } = {}) {
    super(message, { cause });
    this.name = "WorkerError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function asWorkerError(error) {
  if (error instanceof WorkerError) return error;
  return new WorkerError("UNEXPECTED_ERROR", "O robo encontrou um erro inesperado.", { cause: error });
}
