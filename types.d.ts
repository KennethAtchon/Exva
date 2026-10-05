declare module "*.sql" {
  const text: string;
  export default text;
}

declare module "*.md" {
  const text: string;
  export default text;
}

declare module "*.png" {
  const url: string;
  export default url;
}
