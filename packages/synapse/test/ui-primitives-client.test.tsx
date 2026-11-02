import { afterAll, describe, expect, it } from 'bun:test';
import { Window } from 'happy-dom';

const happyWindow = new Window({ url: 'http://localhost/dashboard' });
const globals = globalThis as unknown as Record<string, unknown>;
const previous = {
  window: globals.window,
  document: globals.document,
  navigator: globals.navigator,
  HTMLElement: globals.HTMLElement,
  Event: globals.Event,
  KeyboardEvent: globals.KeyboardEvent,
  MouseEvent: globals.MouseEvent,
  IS_REACT_ACT_ENVIRONMENT: globals.IS_REACT_ACT_ENVIRONMENT
};

globals.window = happyWindow;
globals.document = happyWindow.document;
globals.navigator = happyWindow.navigator;
globals.HTMLElement = happyWindow.HTMLElement;
globals.Event = happyWindow.Event;
globals.KeyboardEvent = happyWindow.KeyboardEvent;
globals.MouseEvent = happyWindow.MouseEvent;
globals.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { Drawer, DropdownItem, DropdownMenu, Modal, Tab, TabList, TabPanel, Tabs } = await import('../src/client.ts');

afterAll(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete globals[key];
    } else {
      globals[key] = value;
    }
  }
});

async function mount(element: React.ReactElement) {
  const container = happyWindow.document.createElement('div');
  happyWindow.document.body.appendChild(container as never);
  let root: ReturnType<typeof createRoot> | undefined;

  await act(async () => {
    root = createRoot(container as unknown as Element);
    root.render(element);
  });

  return { container, root };
}

describe('interactive client primitives', () => {
  it('applies fixed positioning and closes the Modal on Escape', async () => {
    let closed = 0;
    const { container } = await mount(
      React.createElement(
        Modal,
        { isOpen: true, onClose: () => (closed += 1), title: 'Confirm' },
        React.createElement('p', null, 'Body')
      )
    );

    const dialog = container.querySelector('[role="dialog"]') as unknown as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(dialog.style.position).toBe('fixed');
    expect(dialog.style.zIndex).toBe('50');

    await act(async () => {
      happyWindow.dispatchEvent(new happyWindow.KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(closed).toBe(1);
  });

  it('applies fixed positioning to the Drawer panel', async () => {
    const { container } = await mount(
      React.createElement(
        Drawer,
        { isOpen: true, onClose: () => {}, position: 'right', title: 'Details' },
        React.createElement('p', null, 'Drawer body')
      )
    );

    const dialog = container.querySelector('[role="dialog"]') as unknown as HTMLElement;
    expect(dialog.style.position).toBe('fixed');
    expect(container.textContent).toContain('Drawer body');
  });

  it('toggles the DropdownMenu with Enter and renders its items', async () => {
    const { container } = await mount(
      React.createElement(
        DropdownMenu,
        { trigger: React.createElement('span', null, 'Open menu') },
        React.createElement(DropdownItem, null, 'First action')
      )
    );

    const trigger = container.querySelector('[role="button"]') as unknown as HTMLElement;
    expect(trigger.getAttribute('tabindex')).toBe('0');
    expect(container.querySelector('[role="menu"]')).toBeNull();

    await act(async () => {
      trigger.dispatchEvent(
        new happyWindow.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }) as unknown as Event
      );
    });

    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    expect(container.textContent).toContain('First action');
  });

  it('switches Tabs panels on click', async () => {
    const { container } = await mount(
      React.createElement(
        Tabs,
        { defaultValue: 'one' },
        React.createElement(
          TabList,
          null,
          React.createElement(Tab, { value: 'one' }, 'One'),
          React.createElement(Tab, { value: 'two' }, 'Two')
        ),
        React.createElement(TabPanel, { value: 'one' }, 'Panel one'),
        React.createElement(TabPanel, { value: 'two' }, 'Panel two')
      )
    );

    expect(container.textContent).toContain('Panel one');
    expect(container.textContent).not.toContain('Panel two');

    const tabs = container.querySelectorAll('[role="tab"]');
    await act(async () => {
      (tabs[1] as unknown as HTMLElement).click();
    });

    expect(container.textContent).toContain('Panel two');
    expect(container.textContent).not.toContain('Panel one');
  });
});
