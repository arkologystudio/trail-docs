export class CliError extends Error {
  constructor(exitCode, code, message, hint = "") {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.code = code;
    this.hint = hint;
  }
}
