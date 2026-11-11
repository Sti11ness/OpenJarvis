import { maskUnspoken, toSpeakableText } from './message-text';
import { useTtsStore } from './tts';

export class SpeechSegments {
  private pending = '';

  push(delta: string, finished = false): string[] {
    this.pending += delta;
    const chunks: string[] = [];
    while (this.pending) {
      const visible = maskUnspoken(this.pending);
      const boundary = /[.!?…]+[»”"')]*(?=\s)|\r?\n/.exec(visible);
      let cut = boundary ? boundary.index + boundary[0].length : 0;
      if (!cut) {
        let length = 0;
        for (const match of visible.matchAll(/\S+(?=\s)/g)) {
          length += match[0].length + 1;
          if (length >= 145) {
            cut = (match.index ?? 0) + match[0].length;
            break;
          }
        }
      }
      if (!cut && finished) cut = this.pending.length;
      if (!cut) break;
      const text = toSpeakableText(this.pending.slice(0, cut));
      this.pending = this.pending.slice(cut);
      if (/[\p{L}\p{N}]/u.test(text)) chunks.push(text);
    }
    return chunks;
  }
}

function waitForPlayback(id: string): Promise<void> {
  return new Promise((resolve) => {
    const finished = () => {
      const current = useTtsStore.getState();
      return current.state === 'idle' || current.speakingId !== id;
    };
    if (finished()) {
      resolve();
      return;
    }
    const release = useTtsStore.subscribe(() => {
      if (!finished()) return;
      release();
      resolve();
    });
  });
}

export function startSpokenReply(id: string) {
  const segments = new SpeechSegments();
  let queue = Promise.resolve();
  let cancelled = false;
  const enqueue = (chunks: string[]) => {
    for (const text of chunks) {
      queue = queue.then(async () => {
        if (cancelled) return;
        const before = useTtsStore.getState();
        if (before.state !== 'idle' && before.speakingId !== id) {
          cancelled = true;
          return;
        }
        await before.speak(id, text);
        if (useTtsStore.getState().error) {
          cancelled = true;
          return;
        }
        await waitForPlayback(id);
      }).catch(() => { cancelled = true; });
    }
  };

  return {
    push(delta: string) { if (!cancelled) enqueue(segments.push(delta)); },
    finish() { if (!cancelled) enqueue(segments.push('', true)); },
    cancel() {
      cancelled = true;
      const tts = useTtsStore.getState();
      if (tts.speakingId === id) tts.stop();
    },
  };
}
