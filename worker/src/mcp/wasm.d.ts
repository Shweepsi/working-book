// Wrangler hands a .wasm import over as a compiled module.
declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}
