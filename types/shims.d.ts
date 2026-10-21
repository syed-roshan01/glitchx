// Asset module shims — both tsconfigs need these (next-env.d.ts only
// covers the app build). Next resolves images to a StaticImageData-like
// object at build time.
type ImageAsset = { src: string; width?: number; height?: number };

declare module '*.jpeg' {
  const content: ImageAsset;
  export default content;
}
declare module '*.jpg' {
  const content: ImageAsset;
  export default content;
}
declare module '*.png' {
  const content: ImageAsset;
  export default content;
}
declare module '*.svg' {
  const content: ImageAsset;
  export default content;
}
