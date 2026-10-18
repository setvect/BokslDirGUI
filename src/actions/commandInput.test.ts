import { describe, expect, it } from 'vitest';
import { parseShellCommandInput } from './commandInput';

describe('direct program input', () => {
  it('preserves Windows paths, UNC paths and trailing backslashes', () => {
    expect(parseShellCommandInput('"C:\\Program Files\\도구.exe" "C:\\한글 폴더\\" "\\\\server\\share\\a b"'))
      .toEqual({ command: 'C:\\Program Files\\도구.exe', args: ['C:\\한글 폴더\\', '\\\\server\\share\\a b'] });
  });
  it('keeps empty arguments and concatenates quoted segments', () => {
    expect(parseShellCommandInput('tool "" --name="a b" \'c d\' "a""b"'))
      .toEqual({ command: 'tool', args: ['', '--name=a b', 'c d', 'a"b'] });
  });
  it('leaves shell expansion and operators literal for direct execution', () => {
    expect(parseShellCommandInput('tool $HOME %TEMP% ; & | > *.txt'))
      .toEqual({ command: 'tool', args: ['$HOME', '%TEMP%', ';', '&', '|', '>', '*.txt'] });
    expect(parseShellCommandInput('powershell.exe -Command \'Write-Output "한글 a"\''))
      .toEqual({ command: 'powershell.exe', args: ['-Command', 'Write-Output "한글 a"'] });
  });
  it.each(['', '   ', '"" argument', 'tool "unclosed', "tool 'unclosed", 'tool \0'])('rejects malformed input %j', input => {
    expect(parseShellCommandInput(input)).toBeNull();
  });
});
