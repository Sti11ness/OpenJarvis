import { invoke } from '@tauri-apps/api/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { externalHttpUrl, installExternalLinks } from './external-links';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

const base = 'http://tauri.localhost/chat';
const handlers = new Map<string, (event: object) => void>();

class Anchor {
  constructor(private href: string, private download = false) {}
  getAttribute(name: string) { return name === 'href' ? this.href : null; }
  hasAttribute(name: string) { return name === 'download' && this.download; }
}

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  vi.stubGlobal('document', {
    baseURI: base,
    addEventListener: (name: string, handler: (event: object) => void) => {
      handlers.set(name, handler);
    },
  });
  vi.stubGlobal('HTMLAnchorElement', Anchor);
  installExternalLinks();
});

afterEach(() => vi.unstubAllGlobals());

function activate(type: string, button: number, anchor: Anchor, defaultPrevented = false) {
  const preventDefault = vi.fn();
  handlers.get(type)!({
    type, button, defaultPrevented, preventDefault, composedPath: () => [{}, anchor],
  });
  return preventDefault;
}

it.each([['click', 0], ['auxclick', 1]])('opens %s in the default browser instead of the WebView', (event, button) => {
  const preventDefault = activate(event, button, new Anchor('https://example.test/source?q=demo'));
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(invoke).toHaveBeenCalledExactlyOnceWith('open_external_link', {
    url: 'https://example.test/source?q=demo',
  });
});

it('leaves internal links, downloads and handled clicks alone', () => {
  expect(activate('click', 0, new Anchor('/settings#models'))).not.toHaveBeenCalled();
  expect(activate('click', 0, new Anchor('https://example.test/file', true))).not.toHaveBeenCalled();
  expect(activate('click', 0, new Anchor('https://example.test/', false), true)).not.toHaveBeenCalled();
  expect(activate('auxclick', 2, new Anchor('https://example.test/'))).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
});

it('only accepts HTTP and HTTPS external URLs without credentials', () => {
  expect(externalHttpUrl('//example.test/source', base)).toBe('http://example.test/source');
  expect(externalHttpUrl('https://user:password@example.test/', base)).toBeNull();
  expect(externalHttpUrl('javascript:alert(1)', base)).toBeNull();
  expect(externalHttpUrl('file:///C:/test.html', base)).toBeNull();
  expect(externalHttpUrl('https://[', base)).toBeNull();
});
