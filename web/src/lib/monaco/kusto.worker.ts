// Dedicated Kusto worker entry (bundled via `?worker`). monaco-kusto 15 + monaco-editor >= 0.53
// need both imports here; routing 'kusto' to the generic editor worker crashes
// ($loadForeignModule). See node_modules/@kusto/monaco-kusto/README.md.
import '@kusto/monaco-kusto/release/esm/kusto.worker';
import 'monaco-editor/esm/vs/editor/editor.worker';
