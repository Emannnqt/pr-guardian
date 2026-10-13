// INTENTIONALLY INSECURE DEMO FILE for PR Guardian. Do not merge.
import { execSync } from 'node:child_process';
import https from 'node:https';

export function deploy(branch: string): void {
  execSync(`git push origin ${branch}`);
}

export const agent = new https.Agent({ rejectUnauthorized: false });
