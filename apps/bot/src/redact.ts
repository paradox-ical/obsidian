export function scrubSecrets(message: string, secrets: Array<string | undefined>): string {
  let scrubbed = message;
  for (const secret of secrets) {
    if (!secret || secret.length < 4) {
      continue;
    }
    scrubbed = scrubbed.split(secret).join("[redacted]");
  }
  return scrubbed;
}
