import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { DraggableDialog } from './DraggableDialog';

const W = 1000;
const H = 800;

// Paper is 400x200, laid out centred by default; getBoundingClientRect follows the transform.
function mockRect(this: HTMLElement) {
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(this.style.transform);
  const dx = m ? Number(m[1]) : 0;
  const dy = m ? Number(m[2]) : 0;
  const left = 300 + dx;
  const top = 300 + dy;
  return {
    left,
    top,
    right: left + 400,
    bottom: top + 200,
    width: 400,
    height: 200,
    x: left,
    y: top,
  } as DOMRect;
}

const paper = () => screen.getByRole('dialog');
const tx = () => paper().style.transform;

describe('DraggableDialog', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(mockRect);
    vi.stubGlobal('innerWidth', W);
    vi.stubGlobal('innerHeight', H);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const setup = () => {
    render(
      <DraggableDialog open title="Customise" actions={<button>OK</button>}>
        body
      </DraggableDialog>,
    );
    return screen.getByTestId('draggable-dialog-title');
  };

  it('moves when the title is dragged', () => {
    const title = setup();
    fireEvent.pointerDown(title, { pointerId: 1, button: 0, clientX: 500, clientY: 310 });
    fireEvent.pointerMove(title, { pointerId: 1, clientX: 540, clientY: 330 });
    expect(tx()).toBe('translate(40px, 20px)');
    fireEvent.pointerUp(title, { pointerId: 1 });
    fireEvent.pointerMove(title, { pointerId: 1, clientX: 900, clientY: 900 });
    expect(tx()).toBe('translate(40px, 20px)');
  });

  it('clamps to the viewport on all sides', () => {
    const title = setup();
    fireEvent.pointerDown(title, { pointerId: 1, button: 0, clientX: 500, clientY: 310 });
    fireEvent.pointerMove(title, { pointerId: 1, clientX: 5000, clientY: 5000 });
    // right: 1000-400-300 = 300; bottom: 800-200-300 = 300
    expect(tx()).toBe('translate(300px, 300px)');
    fireEvent.pointerMove(title, { pointerId: 1, clientX: -5000, clientY: -5000 });
    expect(tx()).toBe('translate(-300px, -300px)');
  });

  it('ignores drags that start outside the title', () => {
    setup();
    fireEvent.pointerMove(screen.getByText('body'), { pointerId: 1, clientX: 600, clientY: 600 });
    expect(tx()).toBe('translate(0px, 0px)');
  });

  it('removes every window listener it added when unmounted', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(
      <DraggableDialog open title="Customise">
        body
      </DraggableDialog>,
    );
    const added = add.mock.calls.filter((c) => c[0] === 'resize');
    expect(added).toHaveLength(1);
    unmount();
    const removed = remove.mock.calls.map((c) => [c[0], c[1]]);
    expect(removed).toContainEqual(['resize', added[0]?.[1]]);
  });

  it('starts no interval timers beyond those of a plain MUI dialog', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const plain = render(
      <Dialog open>
        <DialogTitle>Plain</DialogTitle>
      </Dialog>,
    );
    const baseline = setIntervalSpy.mock.calls.length;
    plain.unmount();
    setIntervalSpy.mockClear();
    setup();
    expect(setIntervalSpy.mock.calls.length).toBe(baseline);
  });

  it('keeps the dialog inside the viewport when the window shrinks', () => {
    const title = setup();
    fireEvent.pointerDown(title, { pointerId: 1, button: 0, clientX: 500, clientY: 310 });
    fireEvent.pointerMove(title, { pointerId: 1, clientX: 5000, clientY: 310 });
    expect(tx()).toBe('translate(300px, 0px)');
    vi.stubGlobal('innerWidth', 800);
    fireEvent(window, new Event('resize'));
    expect(tx()).toBe('translate(100px, 0px)');
  });
});
