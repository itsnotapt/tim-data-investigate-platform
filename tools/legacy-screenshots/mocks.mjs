const now = new Date('2026-09-29T10:00:00Z');
const iso = (m) => new Date(now.getTime() - m * 60000).toISOString();
export const templates = [
  { uuid: '11111111-1111-1111-1111-111111111111', name: 'Storm events by state', isDeleted: false, isManaged: false,
    updated: iso(600), createdBy: 'analyst@contoso.com', updatedBy: 'analyst@contoso.com', queryType: 'query',
    menu: 'Storm events for state', summary: 'Storm events in {{State}}', path: ['Weather', 'Storms'],
    cluster: 'https://help.kusto.windows.net', database: 'Samples', columnId: 'EventId',
    params: { State: { type: 'string', hint: 'US state' } }, fields: { State: { type: 'single' } }, columns: {},
    query: "StormEvents\n| where StartTime between (datetime({{starttime}}) .. datetime({{endtime}}))\n| where State == '{{State}}'\n| extend EventId = tostring(EventId)\n| take 100" },
  { uuid: '22222222-2222-2222-2222-222222222222', name: 'Damage by event type', isDeleted: false, isManaged: true,
    updated: iso(3000), createdBy: 'lead@contoso.com', updatedBy: 'lead@contoso.com', queryType: 'query',
    menu: 'Damage for event type', summary: 'Damage summary for {{EventType}}', path: ['Weather', 'Damage'],
    cluster: 'https://help.kusto.windows.net', database: 'Samples', columnId: null,
    params: { EventType: { type: 'string' } }, fields: { EventType: { type: 'single' } }, columns: {},
    query: "StormEvents\n| where EventType == '{{EventType}}'\n| summarize DamageProperty=sum(DamageProperty) by State" },
  { uuid: '33333333-3333-3333-3333-333333333333', name: 'Recent storm triage view', isDeleted: false, isManaged: false,
    updated: iso(90), createdBy: 'analyst@contoso.com', updatedBy: 'analyst@contoso.com', queryType: 'view',
    menu: 'Recent storms', summary: 'Recent storms', path: ['Views'],
    cluster: 'https://help.kusto.windows.net', database: 'Samples', columnId: 'EventId',
    params: {}, fields: {}, columns: {},
    query: "StormEvents | take 50" },
  { uuid: '44444444-4444-4444-4444-444444444444', name: 'Old deleted query', isDeleted: true, isManaged: false,
    updated: iso(90000), createdBy: 'analyst@contoso.com', updatedBy: 'analyst@contoso.com', queryType: 'query',
    menu: 'Deleted', summary: 'Deleted', path: ['Archive'], cluster: 'help', database: 'Samples',
    params: {}, fields: { EventId: { type: 'single' } }, columns: {}, query: 'StormEvents | take 1' },
];
const states = ['TEXAS', 'KANSAS', 'IOWA', 'FLORIDA', 'OHIO', 'GEORGIA', 'MISSOURI', 'NEBRASKA'];
const types = ['Hail', 'Thunderstorm Wind', 'Flash Flood', 'Tornado', 'Heavy Rain'];
export const rows = Array.from({ length: 40 }, (_, i) => ({
  EventTime: iso(i * 97), StartTime: iso(i * 97), EndTime: iso(i * 97 - 30), EventId: String(61032 + i * 7),
  State: states[i % states.length], EventType: types[i % types.length],
  InjuriesDirect: i % 6 === 0 ? 2 : 0, DamageProperty: (i * 1375) % 20000, Source: i % 2 ? 'Trained Spotter' : 'Law Enforcement',
  TagEvent: i % 5 === 0 ? { IsSaved: true, Tags: ['investigate'], Determination: ['malicious','suspicious','benign'][(i/5)%3], Comment: 'Confirmed', Comments: [] } : null,
}));
export const schema = [{ ClusterSchema: JSON.stringify({ Plugins: [], Databases: { Samples: { Name: 'Samples', MinorVersion: 1, MajorVersion: 1,
  Tables: { StormEvents: { Name: 'StormEvents', DocString: '', OrderedColumns: Object.keys(rows[0]).map((c) => ({ Name: c, Type: 'System.String', CslType: 'string' })) } },
  Functions: {} } } }) }];

export async function installMocks(page, log) {
  await page.route('http://localhost:5199/**', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const p = url.pathname; const m = req.method();
    log?.(`${m} ${p}${url.search}`);
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (p === '/api/templates/queries' && m === 'GET') return json(templates);
    if (p.startsWith('/api/templates/queries/') && m === 'GET') return json(templates.find((t) => p.endsWith(t.uuid)) || templates[0]);
    if (p === '/api/kusto/schema') return json(schema);
    if (p === '/api/kusto/query' && m === 'POST') return json({ queryRunId: 'run-1', status: 'completed', resultData: rows,
      executionMetrics: { execution_time: 0.42, resource_usage: { cpu: { 'total cpu': '00:00:00.1' }, memory: { peak_per_node: 12345678 } }, dataset_statistics: [{ table_row_count: rows.length, table_size: 9000 }] } });
    return json({});
  });
}
