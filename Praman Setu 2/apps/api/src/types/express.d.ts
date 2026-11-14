import type { AccessPayload } from '../auth';
import type { SessionDoc, UserDoc } from '../store';
import type { Store } from '../store';

declare global {
  namespace Express {
    interface Request {
      user?: UserDoc;
      session?: SessionDoc;
      accessPayload?: AccessPayload;
      store?: Store;
    }
  }
}

export {};
