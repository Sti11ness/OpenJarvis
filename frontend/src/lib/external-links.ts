import { invoke } from '@tauri-apps/api/core';

export function externalHttpUrl(href: string, base: string): string | null {
  try {
    const page = new URL(base);
    const url = new URL(href, page);
    const isHttp = url.protocol === 'http:' || url.protocol === 'https:';
    return isHttp && !url.username && !url.password && url.origin !== page.origin
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function handleLinkActivation(event: MouseEvent): void {
  if (event.defaultPrevented || (event.type === 'auxclick' ? event.button !== 1 : event.button !== 0)) {
    return;
  }
  const link = event.composedPath().find((item): item is HTMLAnchorElement => item instanceof HTMLAnchorElement);
  const href = link?.getAttribute('href');
  if (!href || link?.hasAttribute('download')) return;
  const url = externalHttpUrl(href, document.baseURI);
  if (!url) return;
  event.preventDefault();
  void invoke('open_external_link', { url }).catch(() => {
    console.error('Could not open the link in the default browser.');
  });
}

export function installExternalLinks(): void {
  // A keyboard-activated link dispatches a normal click. Mouse wheel
  // clicks dispatch auxclick, including for links marked target="_blank".
  document.addEventListener('click', handleLinkActivation);
  document.addEventListener('auxclick', handleLinkActivation);
}
