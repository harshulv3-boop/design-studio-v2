// esbuild inlines *.html as a string (text loader in build.mjs).
declare module "*.html" {
  const content: string;
  export default content;
}
