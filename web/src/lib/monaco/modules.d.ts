// monaco-editor's `esm/` deep imports have no type mappings in its package exports.
declare module 'monaco-editor/esm/vs/editor/editor.api' {
  export * from 'monaco-editor';
}
declare module 'monaco-editor/esm/vs/editor/edcore.main';
declare module 'monaco-editor/esm/vs/editor/editor.worker';
declare module 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution';
declare module 'monaco-editor/esm/vs/language/json/monaco.contribution';
declare module 'monaco-editor/esm/vs/editor/editor.worker?worker' {
  const WorkerCtor: new () => Worker;
  export default WorkerCtor;
}
declare module 'monaco-editor/esm/vs/language/json/json.worker?worker' {
  const WorkerCtor: new () => Worker;
  export default WorkerCtor;
}
