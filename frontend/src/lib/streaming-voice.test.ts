import { describe, expect, it, vi } from 'vitest';
import { SpeechSegments, startSpokenReply } from './streaming-voice';
import { useTtsStore } from './tts';

describe('streaming voice segments', () => {
  it('emits a complete sentence before the answer finishes', () => {
    const speech = new SpeechSegments();
    expect(speech.push('Вот первый вывод.')).toEqual([]);
    expect(speech.push(' Второй ещё')).toEqual(['Вот первый вывод.']);
    expect(speech.push(' готовится.', true)).toEqual(['Второй ещё готовится.']);
  });

  it('keeps split fences and inline code out of speech', () => {
    const speech = new SpeechSegments();
    expect(speech.push('Сначала описание. \n`')).toEqual(['Сначала описание.']);
    expect(speech.push('``py\nprint("hidden");\n')).toEqual([]);
    expect(speech.push('```\nГотово, запусти `test(')).toEqual([]);
    expect(speech.push(')`. Дальше ', false)).toEqual(['Готово, запусти.']);
    expect(speech.push('по плану.', true)).toEqual(['Дальше по плану.']);
  });

  it('does not speak an unfinished code block at the end', () => {
    const speech = new SpeechSegments();
    expect(speech.push('Вот пример.\n~~~js\nconst secret = 1;', true)).toEqual(['Вот пример.']);
  });

  it('starts reading before completion and cancels pending phrases', async () => {
    const saved = useTtsStore.getState();
    const speak = vi.fn(async (id: string) => {
      useTtsStore.setState({ state: 'speaking', speakingId: id });
    });
    const stop = vi.fn(() => useTtsStore.setState({ state: 'idle', speakingId: null }));
    useTtsStore.setState({ ...saved, state: 'idle', speakingId: null, speak, stop });
    try {
      const reply = startSpokenReply('voice-test');
      reply.push('Первый вывод. Следующий вывод. Продолжение');
      await vi.waitFor(() => expect(speak).toHaveBeenCalledWith('voice-test', 'Первый вывод.'));
      reply.cancel();
      await Promise.resolve();
      await Promise.resolve();
      expect(stop).toHaveBeenCalledOnce();
      expect(speak).toHaveBeenCalledOnce();
    } finally {
      useTtsStore.setState(saved);
    }
  });
});
