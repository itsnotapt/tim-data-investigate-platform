// Screenshot-only Vite config for the legacy Vue frontend.
// - stubs MSAL auth (fake signed-in user)
// - points the API at http://localhost:5199/ (answered by Playwright route mocks in mocks.mjs)
// - injects ag-grid-enterprise (unlicensed → watermark) so context menu / sidebar render as in prod
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FE = path.resolve(HERE, '../../frontend');
// Resolve build deps from frontend/node_modules (this folder only has playwright + ag-grid-enterprise).
const feRequire = createRequire(path.join(FE, 'package.json'));
const fromFE = (m) => import(pathToFileURL(feRequire.resolve(m)).href);
const { defineConfig } = await fromFE('vite');
const { createVuePlugin: vue } = await fromFE('vite-plugin-vue2');
const { VuetifyResolver } = await fromFE('unplugin-vue-components/resolvers');
const { default: Components } = await fromFE('unplugin-vue-components/vite');

export default defineConfig({
  root: FE,
  plugins: [
    { name: 'enable-ag-enterprise', enforce: 'pre', transform(code, id) { if (id.endsWith('/src/main.js')) return "import 'ag-grid-enterprise';\n" + code; return null; } },
    vue(),
    Components({ resolvers: [VuetifyResolver()] }),
  ],
  resolve: {
    alias: [
      { find: /^@\/helpers\/auth$/, replacement: path.resolve(HERE, 'stubs/auth.js') },
      { find: /^ag-grid-enterprise$/, replacement: path.resolve(HERE, 'node_modules/ag-grid-enterprise') },
      { find: '@', replacement: path.resolve(FE, 'src') },
    ],
    dedupe: ['ag-grid-community'],
  },
  define: { 'import.meta.env.VITE_API_ENDPOINT': JSON.stringify('http://localhost:5199/') },
  server: { port: 5173, strictPort: true },
});
