export function redactBearerTokens(text) {
  return text.replace(/Bearer\\s+[^\\s,;]+/, "Bearer [REDACTED]");
}
