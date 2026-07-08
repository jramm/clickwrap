/** Prisma returns missing optional columns as `null`; the domain layer only knows `undefined`. */
export const nullToUndefined = <T>(value: T | null): T | undefined => value ?? undefined;
