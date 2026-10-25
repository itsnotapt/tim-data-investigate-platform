/**
 * Mock data for the e2e harness. Shapes follow the API contract.
 */
const NOW = new Date('2026-09-29T10:00:00Z');
const iso = (minutesAgo: number): string =>
  new Date(NOW.getTime() - minutesAgo * 60000).toISOString();

const STATES = ['TEXAS', 'KANSAS', 'IOWA', 'FLORIDA', 'OHIO', 'GEORGIA', 'MISSOURI', 'NEBRASKA'];
const TYPES = ['Hail', 'Thunderstorm Wind', 'Flash Flood', 'Tornado', 'Heavy Rain'];
const DETERMINATIONS = ['malicious', 'suspicious', 'benign'];

export type MockRow = Record<string, unknown>;

export const rows: MockRow[] = Array.from({ length: 40 }, (_, i) => ({
  EventTime: iso(i * 97),
  StartTime: iso(i * 97),
  EndTime: iso(i * 97 - 30),
  EventId: String(61032 + i * 7),
  State: STATES[i % STATES.length],
  EventType: TYPES[i % TYPES.length],
  InjuriesDirect: i % 6 === 0 ? 2 : 0,
  DamageProperty: (i * 1375) % 20000,
  Source: i % 2 ? 'Trained Spotter' : 'Law Enforcement',
  TagEvent:
    i % 5 === 0
      ? {
          IsSaved: true,
          Tags: ['investigate'],
          Determination: DETERMINATIONS[(i / 5) % 3],
          Comment: 'Confirmed',
          Comments: [],
        }
      : null,
}));

/** Result of `POST /api/kusto/schema`: `{schema}` with the parsed `.show schema as json` document. */
export const kustoSchema = {
  schema: {
    Plugins: [],
    Databases: {
      Samples: {
        Name: 'Samples',
        MajorVersion: 1,
        MinorVersion: 1,
        Tables: {
          StormEvents: {
            Name: 'StormEvents',
            DocString: '',
            OrderedColumns: Object.keys(rows[0] ?? {}).map((Name) => ({
              Name,
              Type: 'System.String',
              CslType: 'string',
            })),
          },
        },
        Functions: {},
        ExternalTables: {},
        MaterializedViews: {},
        EntityGroups: {},
      },
    },
  },
};

export const executionMetrics = {
  execution_time: 0.42,
  resource_usage: { cpu: { 'total cpu': '00:00:00.1' }, memory: { peak_per_node: 12345678 } },
  dataset_statistics: [{ table_row_count: rows.length, table_size: 9000 }],
};
