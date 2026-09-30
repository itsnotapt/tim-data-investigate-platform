// Development runtime config. In production the web container renders this file
// from environment variables at start (see docs/rewrite/target-architecture.md 3.10).
// Placeholder values only: no secrets in the repo.
window.appConfig = {
  auth: {
    clientId: '00000000-0000-0000-0000-000000000000',
    authority: 'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000',
  },
  redirectUri: 'http://localhost:5173/blank.html',
  apiEndpoint: '/api',
  agGridLicenseKey: '',
  wikiUri: 'https://github.com/itsnotapt/tim-data-investigate-platform/wiki',
  issueUri: 'https://github.com/itsnotapt/tim-data-investigate-platform/issues',
  tagCluster: 'https://help.kusto.windows.net',
  tagDatabase: 'Research',
  defaultClusters: [
    {
      name: 'Example',
      clusters: ['https://help.kusto.windows.net'],
      databases: ['Samples'],
    },
  ],
};
