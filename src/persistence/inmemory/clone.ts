/** Deep copy for all in-memory repos: store and callers never share object references. */
export const deepCopy = <T>(value: T): T => structuredClone(value);
