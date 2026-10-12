export interface PointerRecord {
  x: number;
  y: number;
  startX: number;
  startY: number;
  button: number;
  rotate: boolean;
  moved: boolean;
}

export function finishPointerGesture(pointer: PointerRecord, clientX: number, clientY: number): "camera" | "cancel-build" | "tap" {
  const moved = pointer.moved || Math.hypot(clientX - pointer.startX, clientY - pointer.startY) > 8;
  if (pointer.rotate) return pointer.button === 2 && !moved ? "cancel-build" : "camera";
  return moved ? "camera" : "tap";
}

/** Both fingers become camera gestures, including the finger held still during a pinch. */
export function markMultiTouch(pointers: Iterable<PointerRecord>): void {
  for (const pointer of pointers) pointer.moved = true;
}
