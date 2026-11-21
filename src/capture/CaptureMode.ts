import { createContext } from 'react';

/** Materials opt into deterministic rendering only in the isolated capture window. */
export const CaptureMode = createContext(false);
