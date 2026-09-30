import { createContext } from 'react';

// Only editable primary transcripts provide a repair target.
export const AppBlockRepairSessionContext = createContext<string | null>(null);
