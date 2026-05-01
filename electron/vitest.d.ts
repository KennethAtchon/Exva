declare module "vitest" {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => Promise<void> | void): void;
  export function beforeEach(fn: () => Promise<void> | void): void;
  export function afterEach(fn: () => Promise<void> | void): void;
  export function expect(value: unknown): {
    toEqual(expected: unknown): void;
    toHaveLength(expected: number): void;
    toBeNull(): void;
    not: {
      toBeNull(): void;
    };
  };
}
