/**
 * Mock data for the e2e harness. Mirrors tools/legacy-screenshots/mocks.mjs (removed in P5-12) so screenshots of the
 * rewrite are comparable with the legacy ones. Shapes follow docs/rewrite/api-contract.md.
 */
const NOW = new Date('2026-09-29T10:00:00Z');
const iso = (minutesAgo: number): string =>
  new Date(NOW.getTime() - minutesAgo * 60000).toISOString();

export interface MockTemplate {
  uuid: string;
  name: string;
  isDeleted: boolean;
  isManaged: boolean;
  updated: string;
  queryType: 'query' | 'view';
  menu: string;
  summary: string;
  path: string[];
  cluster: string;
  database: string;
  columnId: string | null;
  params: Record<string, unknown>;
  fields: Record<string, unknown>;
  columns: Record<string, unknown>;
  query: string;
  createdBy?: string;
  updatedBy?: string;
}

const base = {
  cluster: 'https://help.kusto.windows.net',
  database: 'Samples',
  columns: {},
  isDeleted: false,
  isManaged: false,
  createdBy: 'analyst@contoso.com',
  updatedBy: 'analyst@contoso.com',
} as const;

export const templates: MockTemplate[] = [
  {
    ...base,
    uuid: '11111111-1111-1111-1111-111111111111',
    name: 'Storm events by state',
    updated: iso(600),
    queryType: 'query',
    menu: 'Storm events for state',
    summary: 'Storm events in {{State}}',
    path: ['Weather', 'Storms'],
    columnId: 'EventId',
    params: { State: { type: 'string', hint: 'US state' } },
    fields: { State: { type: 'single' } },
    query:
      "StormEvents\n| where StartTime between (datetime({{starttime}}) .. datetime({{endtime}}))\n| where State == '{{State}}'\n| extend EventId = tostring(EventId)\n| take 100",
  },
  {
    ...base,
    uuid: '22222222-2222-2222-2222-222222222222',
    name: 'Damage by event type',
    isManaged: true,
    createdBy: 'lead@contoso.com',
    updatedBy: 'lead@contoso.com',
    updated: iso(3000),
    queryType: 'query',
    menu: 'Damage for event type',
    summary: 'Damage summary for {{EventType}}',
    path: ['Weather', 'Damage'],
    columnId: null,
    params: { EventType: { type: 'string' } },
    fields: { EventType: { type: 'single' } },
    query:
      "StormEvents\n| where EventType == '{{EventType}}'\n| summarize DamageProperty=sum(DamageProperty) by State",
  },
  {
    ...base,
    uuid: '33333333-3333-3333-3333-333333333333',
    name: 'Recent storm triage view',
    updated: iso(90),
    queryType: 'view',
    menu: 'Recent storms',
    summary: 'Recent storms',
    path: ['Views'],
    columnId: 'EventId',
    params: {},
    fields: {},
    query: 'StormEvents | take 50',
  },
];

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
