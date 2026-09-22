import { computeIndicator, INDICATOR_NAMES } from './core.js';
export const id='12';
export const name=INDICATOR_NAMES[id].name;
export const category=INDICATOR_NAMES[id].category;
export const sourcePath='muadhalshaari-spec/System-indicators-/pine/مؤشر 12.pine';
export function compute(candles, context={}){return computeIndicator(id,candles,context);}
