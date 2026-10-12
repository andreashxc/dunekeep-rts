import { describe, expect, it } from "vitest";
import { finishPointerGesture, markMultiTouch, type PointerRecord } from "./PointerGesture";

const pointer = (button: number, rotate = false): PointerRecord => ({ x: 20, y: 20, startX: 20, startY: 20, button, rotate, moved: false });

describe("camera gestures do not cancel planning or accidentally construct", () => {
  it("only cancels construction on a released right click, not a drag", () => {
    expect(finishPointerGesture(pointer(2, true), 20, 20)).toBe("cancel-build");
    expect(finishPointerGesture(pointer(2, true), 60, 50)).toBe("camera");
  });
  it("remembers a drag that returned to its starting point", () => {
    expect(finishPointerGesture({ ...pointer(2, true), moved: true }, 20, 20)).toBe("camera");
  });
  it("does not cancel from middle mouse or Alt-left camera gestures", () => {
    expect(finishPointerGesture(pointer(1, true), 20, 20)).toBe("camera");
    expect(finishPointerGesture(pointer(0, true), 20, 20)).toBe("camera");
  });
  it("suppresses the stationary finger tap at the end of a pinch", () => {
    const first = pointer(0), second = pointer(0);
    markMultiTouch([first, second]);
    expect(finishPointerGesture(first, 20, 20)).toBe("camera");
    expect(finishPointerGesture(second, 40, 60)).toBe("camera");
  });
  it("keeps an ordinary map tap for selection and placement", () => {
    expect(finishPointerGesture(pointer(0), 23, 21)).toBe("tap");
  });
});
