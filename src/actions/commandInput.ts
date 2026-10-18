// Direct program arguments: quotes group text; backslashes and shell operators stay literal.
// A doubled matching quote inside a quoted argument represents one literal quote.
export function parseShellCommandInput(value: string): { command: string; args: string[] } | null {
  if (value.includes('\0')) return null;
  const parts: string[] = [];
  let part = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (let i = 0; i < value.length; i += 1) {
    const character = value[i];
    if (quote) {
      if (character === quote) {
        if (value[i + 1] === quote) { part += quote; i += 1; }
        else quote = null;
      } else part += character;
    } else if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/u.test(character)) {
      if (started) { parts.push(part); part = ''; started = false; }
    } else {
      part += character;
      started = true;
    }
  }
  if (quote) return null;
  if (started) parts.push(part);
  const [command, ...args] = parts;
  return command?.trim() ? { command, args } : null;
}
