import { describe, expect, it } from 'vitest';
import { detailEntries } from './detailText';

const columns = [{ name: 'Timestamp' }, { name: 'CommandLine' }, { name: 'Host' }];

describe('detailEntries', () => {
  it("follows the run's columns, then keys not among them", () => {
    const entries = detailEntries(
      { Extra: 'x', Host: 'h1', SHA1: 'ab', Timestamp: 't', CommandLine: 'cmd' },
      columns,
    );
    expect(entries.map((e) => e.key)).toEqual([
      'Timestamp',
      'CommandLine',
      'Host',
      'Extra',
      'SHA1',
    ]);
  });

  it('leaves out empty values', () => {
    const entries = detailEntries({ a: '', b: null, c: {}, d: [], e: 0, f: 'ok', g: false });
    expect(entries.map((e) => e.key)).toEqual(['e', 'f', 'g']);
  });

  it('shows strings in an object exactly as they are, and other values as typed', () => {
    const [entry] = detailEntries({
      Evidence: {
        path: '"C:\\Windows\\svchost.exe" -k netsvcs',
        note: 'key: value',
        port: 443,
        portText: '443',
        ok: true,
        none: null,
        blank: '',
        list: [],
        map: {},
      },
    });
    expect(entry?.text).toBe(
      [
        'path: "C:\\Windows\\svchost.exe" -k netsvcs',
        'note: key: value',
        'port: 443',
        'portText: 443',
        'ok: true',
        'none: null',
        'blank: ""',
        'list: []',
        'map: {}',
      ].join('\n'),
    );
    const typed = entry?.lines?.flatMap((l) =>
      l.segments.filter((s) => s.kind === 'typed').map((s) => s.text),
    );
    expect(typed).toEqual(['443', 'true', 'null', '""', '[]', '{}']);
  });

  it('lays out nested objects and lists 2 spaces a level, a list item starting on its dash', () => {
    const [entry] = detailEntries({
      Processes: { procs: [{ name: 'a.exe', args: ['-x', 7] }, 'b.exe'], parent: { pid: 4 } },
    });
    expect(entry?.text).toBe(
      [
        'procs:',
        '  - name: a.exe',
        '    args:',
        '      - -x',
        '      - 7',
        '  - b.exe',
        'parent:',
        '  pid: 4',
      ].join('\n'),
    );
    expect(entry?.lines?.map((l) => l.indent)).toEqual([0, 2, 4, 6, 6, 2, 0, 2]);
    expect(entry?.lines?.[1]?.segments.map((s) => s.kind)).toEqual(['key', 'key', 'plain']);
  });

  it('puts a string with line breaks on indented lines under its key, and never folds a long one', () => {
    const long = `powershell.exe -enc ${'A'.repeat(100)}`;
    const [entry] = detailEntries({
      Script: { body: 'line one\nline two', items: ['a\nb'], cmd: long },
    });
    expect(entry?.text).toBe(
      ['body:', '  line one', '  line two', 'items:', '  -', '    a', '    b', `cmd: ${long}`].join(
        '\n',
      ),
    );
    expect(entry?.lines?.map((l) => l.indent)).toEqual([0, 2, 2, 0, 2, 4, 4, 0]);
  });

  it('copies an object as 2-space indented JSON, and any other value as its text', () => {
    const evidence = { path: 'C:\\Windows', ports: [443, '443'] };
    const [object, text, number] = detailEntries({ Evidence: evidence, Host: 'h1', Bytes: 2048 });
    expect(object?.copy).toBe(
      '{\n  "path": "C:\\\\Windows",\n  "ports": [\n    443,\n    "443"\n  ]\n}',
    );
    expect(JSON.parse(object?.copy ?? '')).toEqual(evidence);
    expect(text?.copy).toBe('h1');
    expect(number?.copy).toBe('2048');
  });

  it('marks paths, hashes, command lines, IPs, SIDs, objects and long text as technical', () => {
    const technical = (value: unknown) => detailEntries({ v: value })[0]?.technical;
    expect(technical('C:\\Windows\\System32\\svchost.exe')).toBe(true);
    expect(technical('/usr/bin/curl')).toBe(true);
    expect(technical('cmd.exe /c whoami')).toBe(true);
    expect(technical('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBe(
      true,
    );
    expect(technical('6f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b')).toBe(true);
    expect(technical('10.0.0.12')).toBe(true);
    expect(technical('S-1-5-21-3623811015-3361044348-30300820-1013')).toBe(true);
    expect(technical({ a: 1 })).toBe(true);
    expect(technical('word '.repeat(13))).toBe(true);
    expect(technical('alice')).toBe(false);
    expect(technical('Logon succeeded for the account')).toBe(false);
    expect(technical(443)).toBe(false);
    expect(technical('2026-10-01T08:00:00Z')).toBe(false);
    expect(technical('1729900800000')).toBe(false);
    expect(technical('10/26/2026')).toBe(false);
    expect(technical('2001:db8::8a2e:370:7334')).toBe(true);
  });
});
