import { randomUUID } from 'node:crypto';

/**
 * GitHub Actions workflow commands. Message data is escaped so text from a
 * pull request (paths, error details) cannot inject further commands.
 */
export function escapeData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export function errorCommand(message: string): string {
  return `::error title=PR Guardian::${escapeData(message)}`;
}

export function warningCommand(message: string): string {
  return `::warning title=PR Guardian::${escapeData(message)}`;
}

export function noticeCommand(message: string): string {
  return `::notice title=PR Guardian::${escapeData(message)}`;
}

/** One entry for the GITHUB_OUTPUT file, using a random heredoc delimiter. */
export function outputEntry(name: string, value: string): string {
  const delimiter = `ghadelimiter_${randomUUID()}`;
  return `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
}
