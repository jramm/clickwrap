import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/** Shared MSW server for all tests. */
export const server = setupServer(...handlers);
