declare module "@mtcute/wasm/mtcute.wasm" {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}

declare module "*.wasm" {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}
