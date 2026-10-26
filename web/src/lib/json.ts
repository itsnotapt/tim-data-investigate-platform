/**
 * JSON for the whole app: whole numbers beyond ±(2^53 − 1) stay exact, as `BigInt`. The api
 * sends them as plain JSON numbers, which `JSON.parse` alone would round.
 */

/** What a reviver is told about a primitive value: its text in the JSON. */
interface ReviverContext {
  source?: string;
}

/** The `JSON` members TypeScript's lib doesn't declare. */
const { rawJSON } = JSON as unknown as { rawJSON: (text: string) => unknown };

/** Every whole number beyond ±(2^53 − 1) has at least 16 digits. */
const LONG_DIGITS = /\d{16}/;
const WHOLE_NUMBER_TEXT = /^[+-]?\d+$/;

/**
 * `value`, the number `text` reads as; or, when `text` is a whole number beyond ±(2^53 − 1),
 * that number exactly as a `BigInt`.
 */
export function exactNumber(text: string, value: number): number | bigint {
  return Number.isSafeInteger(value) || !WHOLE_NUMBER_TEXT.test(text) ? value : BigInt(text);
}

function exactWhole(_key: string, value: unknown, context?: ReviverContext): unknown {
  return typeof value === 'number' && context?.source !== undefined
    ? exactNumber(context.source, value)
    : value;
}

/**
 * `JSON.parse`, with whole numbers beyond ±(2^53 − 1) as `BigInt`. Without the reviver's source
 * text (an older browser), they round. Text with no run of 16 digits is parsed without a reviver.
 */
export function parseJson(text: string): unknown {
  return LONG_DIGITS.test(text) ? JSON.parse(text, exactWhole) : JSON.parse(text);
}

type Replacer = (this: unknown, key: string, value: unknown) => unknown;

/**
 * `JSON.stringify`, with a `BigInt` written as a plain JSON number. Like `JSON.stringify`, it
 * gives `undefined` for `undefined`.
 */
export function stringifyJson(value: unknown, replacer?: Replacer, space?: number): string {
  return JSON.stringify(
    value,
    function (this: unknown, key, v: unknown) {
      const replaced = replacer ? replacer.call(this, key, v) : v;
      return typeof replaced === 'bigint' ? rawJSON(replaced.toString()) : replaced;
    },
    space,
  );
}
