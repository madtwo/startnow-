/** Test runner consistent with the repository's existing CommonJS TypeScript tests. */
const { readFileSync } = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
Module._extensions['.ts'] = (mod, file) => mod._compile(
  ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText, file,
);
exports.lib = (name) => require(path.join(__dirname, '..', 'src', 'lib', `${name}.ts`));
exports.root = path.join(__dirname, '..');
