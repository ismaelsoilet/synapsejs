/**
 * SynapseJS - Zero-Dependency 5-Field Standard Cron Expression Parser
 *
 * Evaluates standard cron strings (minute, hour, day-of-month, month, day-of-week)
 * and calculates the exact next UTC execution timestamp deterministically.
 *
 * Day-of-month and day-of-week follow POSIX/Vixie semantics: when both fields are
 * restricted, the expression matches the union of the two (OR), not the
 * intersection. Names, L, W, # and ? are rejected explicitly instead of silently
 * searching for an impossible date.
 */

export interface ParsedCronField {
  matches(val: number): boolean;
}

function matchesField(value: number, sundaySeven: boolean, predicate: (value: number) => boolean): boolean {
  return predicate(value) || (sundaySeven && value === 0 && predicate(7));
}

function parseField(field: string, min: number, max: number, sundaySeven = false): ParsedCronField {
  const trimmed = field.trim();
  if (trimmed === '*') {
    return { matches: () => true };
  }

  // Handle step: */5 or 10-30/5
  if (trimmed.includes('/')) {
    const [rangePart, stepPart] = trimmed.split('/');
    const step = Number.parseInt(stepPart, 10);
    if (Number.isNaN(step) || step <= 0) {
      throw new Error(`Invalid cron step: "${stepPart}" in "${field}"`);
    }

    let start = min;
    let end = max;
    if (rangePart !== '*') {
      if (rangePart.includes('-')) {
        const [rawStart, rawEnd] = rangePart.split('-').map((n) => Number.parseInt(n, 10));
        if (Number.isNaN(rawStart) || Number.isNaN(rawEnd) || rawStart < min || rawEnd > max || rawStart > rawEnd) {
          throw new Error(`Invalid cron range: "${rangePart}" in "${field}"`);
        }
        start = rawStart;
        end = rawEnd;
      } else {
        const rawStart = Number.parseInt(rangePart, 10);
        if (Number.isNaN(rawStart) || rawStart < min || rawStart > max) {
          throw new Error(`Invalid cron number: "${rangePart}" (expected ${min}-${max})`);
        }
        start = rawStart;
      }
    }

    return {
      matches: (val: number) =>
        matchesField(val, sundaySeven, (value) => value >= start && value <= end && (value - start) % step === 0)
    };
  }

  // Handle list: 1,2,5
  if (trimmed.includes(',')) {
    const subParsers = trimmed.split(',').map((part) => parseField(part, min, max, sundaySeven));
    return {
      matches: (val: number) => subParsers.some((parser) => parser.matches(val))
    };
  }

  // Handle range: 1-5
  if (trimmed.includes('-')) {
    const [start, end] = trimmed.split('-').map((n) => Number.parseInt(n, 10));
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start < min || end > max) {
      throw new Error(`Invalid cron range: "${field}"`);
    }
    return {
      matches: (val: number) => matchesField(val, sundaySeven, (value) => value >= start && value <= end)
    };
  }

  // Exact number: 5
  const exact = Number.parseInt(trimmed, 10);
  if (Number.isNaN(exact) || exact < min || exact > max) {
    throw new Error(`Invalid cron number: "${trimmed}" (expected ${min}-${max})`);
  }
  return {
    matches: (val: number) => matchesField(val, sundaySeven, (value) => value === exact)
  };
}

export function parseNextCronOccurrence(cronExpr: string, fromDate: Date = new Date()): Date {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Cron expression must contain exactly 5 parts (got ${parts.length}): "${cronExpr}"`);
  }

  for (const part of parts) {
    if (/[A-Za-z?#]/.test(part)) {
      throw new Error(
        `Unsupported cron syntax: "${part}". Names, L, W, # and ? are not supported; use numbers, ranges, lists and steps.`
      );
    }
  }

  const minuteField = parseField(parts[0], 0, 59);
  const hourField = parseField(parts[1], 0, 23);
  const dayOfMonthField = parseField(parts[2], 1, 31);
  const monthField = parseField(parts[3], 1, 12);
  // Sunday is accepted as 0 or 7; the field matcher tests both representations.
  const dayOfWeekField = parseField(parts[4], 0, 7, true);

  const dayOfMonthRestricted = parts[2].trim() !== '*';
  const dayOfWeekRestricted = parts[4].trim() !== '*';

  // Start checking from the next whole minute
  const candidate = new Date(fromDate.getTime());
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  // Limit search to 5 years (approx 2,628,000 minutes) to prevent infinite loops on impossible dates
  const maxIterations = 5 * 365 * 24 * 60;
  let iterations = 0;

  while (iterations < maxIterations) {
    const month = candidate.getUTCMonth() + 1; // 1-12
    if (!monthField.matches(month)) {
      // Advance to start of next month
      candidate.setUTCMonth(candidate.getUTCMonth() + 1, 1);
      candidate.setUTCHours(0, 0, 0, 0);
      iterations += 60;
      continue;
    }

    const dayOfMonth = candidate.getUTCDate();
    const dayOfWeek = candidate.getUTCDay(); // 0 = Sunday
    const dayOfMonthMatches = dayOfMonthField.matches(dayOfMonth);
    const dayOfWeekMatches = dayOfWeekField.matches(dayOfWeek);
    const dayMatches =
      dayOfMonthRestricted && dayOfWeekRestricted
        ? dayOfMonthMatches || dayOfWeekMatches
        : dayOfMonthMatches && dayOfWeekMatches;

    if (!dayMatches) {
      // Advance to start of next day
      candidate.setUTCDate(candidate.getUTCDate() + 1);
      candidate.setUTCHours(0, 0, 0, 0);
      iterations += 60;
      continue;
    }

    const hour = candidate.getUTCHours();
    if (!hourField.matches(hour)) {
      // Advance to next hour
      candidate.setUTCHours(candidate.getUTCHours() + 1, 0, 0, 0);
      iterations += 60;
      continue;
    }

    const minute = candidate.getUTCMinutes();
    if (minuteField.matches(minute)) {
      return candidate;
    }

    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
    iterations++;
  }

  throw new Error(`Unable to find next execution for cron expression: "${cronExpr}" within search horizon.`);
}
