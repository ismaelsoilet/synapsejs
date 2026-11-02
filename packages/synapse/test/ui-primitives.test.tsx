import { describe, expect, it } from 'bun:test';
import { renderToString } from 'react-dom/server';
import {
  Drawer,
  DropdownItem,
  DropdownMenu,
  Modal,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  ToastProvider,
  useToast
} from '../src/client.ts';

describe('SynapseJS v1.10.0+ - Extended UI Primitives & Reactive Client System', () => {
  it('renders Modal correctly in SSR and includes dialog accessibility attributes', () => {
    const htmlOpen = renderToString(
      <Modal isOpen={true} onClose={() => {}} title="Test Modal" description="Modal description">
        <div>Modal Content</div>
      </Modal>
    );

    expect(htmlOpen).toContain('role="dialog"');
    expect(htmlOpen).toContain('aria-modal="true"');
    expect(htmlOpen).toContain('Test Modal');
    expect(htmlOpen).toContain('Modal description');
    expect(htmlOpen).toContain('Modal Content');

    const htmlClosed = renderToString(
      <Modal isOpen={false} onClose={() => {}} title="Test Modal">
        <div>Modal Content</div>
      </Modal>
    );
    expect(htmlClosed).toBe('');
  });

  it('renders Drawer correctly with directional slide-over positioning', () => {
    const htmlRight = renderToString(
      <Drawer isOpen={true} onClose={() => {}} position="right" title="Drawer Right">
        <div>Drawer Body</div>
      </Drawer>
    );

    expect(htmlRight).toContain('role="dialog"');
    expect(htmlRight).toContain('Drawer Right');
    expect(htmlRight).toContain('Drawer Body');
    expect(htmlRight).toContain('right-0');

    const htmlLeft = renderToString(
      <Drawer isOpen={true} onClose={() => {}} position="left" title="Drawer Left">
        <div>Drawer Left Body</div>
      </Drawer>
    );
    expect(htmlLeft).toContain('left-0');
    expect(htmlLeft).toContain('Drawer Left');
  });

  it('renders Tabs accessible markup with tablist, tab and tabpanel roles', () => {
    const html = renderToString(
      <Tabs defaultValue="tab1">
        <TabList>
          <Tab value="tab1">First Tab</Tab>
          <Tab value="tab2">Second Tab</Tab>
        </TabList>
        <TabPanel value="tab1">
          <div>Panel One Content</div>
        </TabPanel>
        <TabPanel value="tab2">
          <div>Panel Two Content</div>
        </TabPanel>
      </Tabs>
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('First Tab');
    expect(html).toContain('Second Tab');
    expect(html).toContain('Panel One Content');
    // Tab2 is not active by default, so its panel content is not rendered
    expect(html).not.toContain('Panel Two Content');
  });

  it('renders DropdownMenu trigger and hides closed popover initially in SSR', () => {
    const html = renderToString(
      <DropdownMenu trigger={<button type="button">Menu Trigger</button>}>
        <DropdownItem>Item 1</DropdownItem>
        <DropdownItem variant="danger">Delete Item</DropdownItem>
      </DropdownMenu>
    );

    expect(html).toContain('Menu Trigger');
    // Closed by default
    expect(html).not.toContain('role="menu"');
  });

  it('renders ToastProvider and handles floating stack markup gracefully', () => {
    function TestComponent() {
      const toast = useToast();
      return (
        <div>
          <button type="button" onClick={() => toast.success('Operação concluída!')}>
            Disparar Toast
          </button>
        </div>
      );
    }

    const html = renderToString(
      <ToastProvider position="bottom-right">
        <TestComponent />
      </ToastProvider>
    );

    expect(html).toContain('Disparar Toast');
    expect(html).toContain('aria-live="polite"');
  });
});
