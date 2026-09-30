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
});
