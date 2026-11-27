import { z } from 'zod';

export const OpaqueIdSchema = z.uuid();
export const UtcMillisSchema = z.number().int().nonnegative();
