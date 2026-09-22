import { computeIndicator, INDICATOR_NAMES } from './core.js';
export const id='21';
export const name=INDICATOR_NAMES[id].name;
export const category=INDICATOR_NAMES[id].category;
export const sourcePath='muadhalshaari-spec/System-indicators-/pine/مؤشر 21.pine';
export function compute(candles, context={}){return computeIndicator(id,candles,context);}
