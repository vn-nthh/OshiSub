// ResizeHandle.tsx — Draggable handle between two panels
import { useCallback, useEffect, useRef, useState } from 'react';

interface ResizeHandleProps {
  /** Direction of the split: 'horizontal' (left/right) or 'vertical' (top/bottom) */
  direction?: 'horizontal' | 'vertical';
  /** Callback with the pixel delta from drag start */
  onResize: (delta: number) => void;
}

export function ResizeHandle({ direction = 'horizontal', onResize }: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const startPos = useRef(0);
  const [hovered, setHovered] = useState(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startPos.current = direction === 'horizontal' ? e.clientX : e.clientY;
    setDragging(true);
  }, [direction]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const pos = direction === 'horizontal' ? e.clientX : e.clientY;
      const delta = pos - startPos.current;
      startPos.current = pos;
      onResize(delta);
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    // Set cursor on body during drag
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragging, direction, onResize]);

  const isH = direction === 'horizontal';

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flexShrink: 0,
        width: isH ? 5 : '100%',
        height: isH ? '100%' : 5,
        cursor: isH ? 'col-resize' : 'row-resize',
        position: 'relative',
        zIndex: 10,
      }}
    >
      {/* Visual indicator */}
      <div style={{
        position: 'absolute',
        ...(isH
          ? { top: 0, bottom: 0, left: 2, width: 1 }
          : { left: 0, right: 0, top: 2, height: 1 }
        ),
        background: dragging || hovered ? 'var(--accent)' : 'var(--border)',
        transition: dragging ? 'none' : 'background 0.15s',
      }} />
    </div>
  );
}
