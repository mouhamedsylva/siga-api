import { assess, looksLikeSms } from './grouping';

describe('assess', () => {
  it.each([
    [{ images: 1, texts: 1 }, 'complete'],
    [{ images: 2, texts: 0 }, 'complete'], // capture + SMS en image
    [{ images: 2, texts: 1 }, 'complete'],
    [{ images: 1, texts: 0 }, 'missing_sms'],
    [{ images: 0, texts: 1 }, 'missing_capture'],
    [{ images: 3, texts: 0 }, 'too_many'],
    [{ images: 1, texts: 2 }, 'too_many'],
  ])('%p => %p', (composition, expected) => {
    expect(assess(composition)).toBe(expected);
  });
});

describe('looksLikeSms', () => {
  it('reconnaît un SMS de transaction collé', () => {
    expect(
      looksLikeSms(
        'Vous avez reçu 15.000F de Moussa (77 000 00 00). Ref: AB12CD',
      ),
    ).toBe(true);
  });
  it.each(['bonjour', 'tu as reçu ?', 'merci beaucoup pour tout ça mon ami'])(
    'ignore une simple discussion (%p)',
    (t) => expect(looksLikeSms(t)).toBe(false),
  );
});
