// The game table: draws the current game from sim state and turns clicks into game commands.
import { cardName, isRed } from '../sim/games/cards';
import { GAME_NAMES, type GameAction, type GameState } from '../sim/games';
import { revealed } from '../sim/games/wordPuzzle';
import { h } from './dom';

export interface GamePanelHooks {
  move(action: GameAction): void;
  close(): void;
  himName(): string;
}

export function renderGame(root: HTMLElement, g: GameState, hooks: GamePanelHooks): void {
  const him = hooks.himName();
  const btn = (label: string, action: GameAction, extra: Record<string, string | boolean> = {}) =>
    h('button', { type: 'button', ...extra, onclick: () => hooks.move(action) }, label);
  const card = (n: number | null) =>
    n === null
      ? h('span', { class: 'card back', 'aria-label': 'face-down card' }, '\u00a0')
      : h('span', { class: `card${isRed(n) ? ' red' : ''}` }, cardName(n));

  const body: (Node | string)[] = [];
  switch (g.kind) {
    case 'war': {
      body.push(
        h('p', {}, 'You: ', g.last ? card(g.last.you) : card(null), '   ', `${him}: `, g.last ? card(g.last.him) : card(null)),
        h('p', {}, `Score: you ${g.scoreYou}, ${him} ${g.scoreHim}. First to ${g.target}.`),
      );
      if (g.pot > 0) body.push(h('p', { class: 'note' }, `War! The next flip is worth ${g.pot + 1}.`));
      if (!g.over) body.push(h('div', { class: 'row' }, btn('Flip', { kind: 'flip' })));
      break;
    }
    case 'poker': {
      const yours = g.you.map((c, i) =>
        h(
          'button',
          {
            type: 'button',
            class: `card${isRed(c) ? ' red' : ''}${g.held[i] ? ' held' : ''}`,
            'aria-pressed': String(g.held[i]),
            disabled: g.stage !== 'draw',
            title: g.stage === 'draw' ? 'Click to keep this card' : '',
            onclick: () => hooks.move({ kind: 'hold', index: i }),
          },
          cardName(c),
        ),
      );
      const his = g.him.map((c) => card(g.stage === 'done' ? c : null));
      body.push(h('p', {}, `${him}: `, ...his), h('p', {}, 'You: ', ...yours));
      if (g.stage === 'draw') body.push(h('p', { class: 'note' }, 'Pick the cards to keep, then draw.'));
      if (g.stage === 'show') body.push(h('p', { class: 'note' }, `${him} drew ${g.himDrew}. Show your hand, or fold.`));
      if (g.stage === 'done' && g.himHand) {
        body.push(h('p', {}, g.folded ? `You folded. ${him} had ${g.himHand}.` : `You had ${g.youHand}. ${him} had ${g.himHand}.`));
      }
      if (!g.over) {
        body.push(
          h(
            'div',
            { class: 'row' },
            g.stage === 'draw' ? btn('Draw', { kind: 'draw' }) : null,
            btn('Show', { kind: 'show' }),
            btn('Fold', { kind: 'fold' }),
          ),
        );
      }
      break;
    }
    case 'anagrams': {
      body.push(h('p', {}, `Round ${Math.min(g.round + 1, g.rounds)} of ${g.rounds}. Score: you ${g.scoreYou}, ${him} ${g.scoreHim}.`));
      if (g.last) {
        const who = g.last.solvedBy === 'you' ? 'You got' : g.last.solvedBy === 'him' ? `${him} got` : 'Nobody got';
        body.push(h('p', { class: 'note' }, `${who} “${g.last.word}”.`));
      }
      if (!g.over) {
        const input = h('input', { 'aria-label': 'Your answer', autocomplete: 'off', maxlength: '20' });
        body.push(
          h('p', { class: 'big' }, g.scrambled.toUpperCase().split('').join(' ')),
          h(
            'form',
            {
              class: 'row',
              onsubmit: (e: Event) => {
                e.preventDefault();
                if (input.value.trim()) hooks.move({ kind: 'guess', text: input.value });
              },
            },
            input,
            h('button', { type: 'submit' }, 'Guess'),
            btn('Pass', { kind: 'pass' }),
          ),
          h('p', { class: 'note' }, `${g.tries} ${g.tries === 1 ? 'try' : 'tries'} left.`),
        );
        queueMicrotask(() => input.focus());
      }
      break;
    }
    case 'wordPuzzle': {
      body.push(
        h('p', { class: 'big' }, (g.over ? g.word : revealed(g)).toUpperCase().split('').join(' ')),
        h('p', {}, `Wrong guesses: ${g.misses} of ${g.maxMisses}.`),
      );
      if (!g.over) {
        const letters = [...'abcdefghijklmnopqrstuvwxyz'].map((l) =>
          btn(l.toUpperCase(), { kind: 'letter', letter: l }, { disabled: g.guessed.includes(l), class: 'key' }),
        );
        const input = h('input', { 'aria-label': 'Solve the whole word', autocomplete: 'off', maxlength: '20' });
        body.push(
          h('div', { class: 'keys' }, ...letters),
          h(
            'form',
            {
              class: 'row',
              onsubmit: (e: Event) => {
                e.preventDefault();
                if (input.value.trim()) hooks.move({ kind: 'solve', text: input.value });
              },
            },
            input,
            h('button', { type: 'submit' }, 'Solve'),
            btn('Give up', { kind: 'giveUp' }),
          ),
        );
      }
      break;
    }
  }

  if (g.over) {
    const result =
      g.winner === 'you' ? 'You won.' : g.winner === 'him' ? `${him} won!` : g.winner === 'draw' ? 'A draw.' : 'Game abandoned.';
    body.push(h('p', { class: 'result' }, result), h('div', { class: 'row' }, h('button', { type: 'button', onclick: () => hooks.close() }, 'Close')));
  }

  root.replaceChildren(h('h2', {}, GAME_NAMES[g.kind][0]!.toUpperCase() + GAME_NAMES[g.kind].slice(1)), ...body);
}
