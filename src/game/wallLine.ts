import type { GridPoint } from './types';
/** Orthogonal curtain wall; horizontal leg first gives deterministic joined corners. */
export function wallLine(start: GridPoint, end: GridPoint): GridPoint[] {
  if (![start.gx,start.gz,end.gx,end.gz].every(Number.isInteger)) return [];
  if (Math.abs(end.gx-start.gx)+Math.abs(end.gz-start.gz)>100) return [];
  const result: GridPoint[] = [{...start}];
  let gx=start.gx,gz=start.gz;
  while(gx!==end.gx){gx+=Math.sign(end.gx-gx);result.push({gx,gz});}
  while(gz!==end.gz){gz+=Math.sign(end.gz-gz);result.push({gx,gz});}
  return result;
}
