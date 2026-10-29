import { t, type TextKey } from '../i18n';
import {
  BATTLE_ENERGY,
  createBattle,
  fighterFromPet,
  MAX_TURNS,
  MOVES,
  movesFor,
  playTurn,
  type Battle,
  type BattleEvent,
  type BattleReward,
  type Fighter,
  type MoveId,
  type Outcome,
  type Side,
  type SideKey,
} from '../sim/battle';
import { decodeFighter } from '../sim/battlecode';
import { speciesName } from '../sim/evolution';
import type { TrainCheck } from '../sim/training';
import type { PetState } from '../sim/types';
import { icon } from './icons';
import { esc, type ActivitySheet } from './sheet';

export interface ArenaHandlers {
  pet(): PetState;
  check(): TrainCheck;
  /** A seed for the next wild creature and battle dice. */
  seed(): number;
  wildFoe(): Fighter;
  /** This pet's battle code and challenge link. */
  myCode(): { code: string; link: string };
  share(text: string, link: string): void;
  /** Bring the opponent onto the island. */
  begin(foe: Fighter): void;
  /** 3D and sound for one battle event. */
  fx(e: BattleEvent, b: Battle): void;
  /** Apply the outcome to the real pet; returns any stat reward. */
  finish(outcome: Outcome, foe: Fighter): BattleReward;
  /** Send the opponent away and free the pet. */
  end(): void;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The Battle tab: record, wild battles and friend codes; then the fight itself and its result. */
export class Arena {
  private sheet: HTMLElement;
  private battle: Battle | null = null;
  private foe: Fighter | null = null;
  /** Bumped whenever a fight is abandoned, so a running animation sequence stops. */
  private run = 0;
  private prefill = '';

  constructor(
    private s: ActivitySheet,
    private h: ArenaHandlers,
  ) {
    this.sheet = s.el;
    s.register('battle', () => this.menu());
    s.onClose(() => this.leave());
  }

  /** Open the Battle tab with a friend's code ready to fight (from a challenge link). */
  challenge(code: string): void {
    this.prefill = code;
    this.s.open('battle');
  }

  private leave(): void {
    this.run++;
    if (this.battle) this.h.end();
    this.battle = null;
    this.foe = null;
  }

  private moveName(move: MoveId, f: Fighter): string {
    return move === 'element' ? t(`move.element.${f.type}`) : t(`move.${move}` as TextKey);
  }

  private moveInfo(move: MoveId): string {
    const m = MOVES[move];
    return t(`move.${move}.info` as TextKey, { n: m.power });
  }

  menu(): void {
    this.leave();
    const pet = this.h.pet();
    const check = this.h.check();
    const species = speciesName(pet.type, pet.form);
    const sub = `${species} · ${t('battle.record', { w: pet.battles.wins, l: pet.battles.losses })}`;
    const fighter = fighterFromPet(pet);
    const moves =
      pet.stage >= 1
        ? movesFor(fighter)
            .map((m) => `<span class="chip ${MOVES[m].typed ? pet.type : 'neutral'}">${esc(this.moveName(m, fighter))}</span>`)
            .join('')
        : '';
    const ok = check === 'ok';
    const note = ok ? t('battle.cost', { n: BATTLE_ENERGY }) : t(`train.no.${check}`, { name: pet.name });
    const code = pet.stage >= 1 ? this.h.myCode().code : '';
    this.sheet.innerHTML = `${this.s.head({ tab: 'battle', sub, closeLabel: t('train.close') })}
      ${moves ? `<div class="bt-moves-preview"><span class="muted">${t('battle.moves')}</span>${moves}</div>` : ''}
      <button type="button" class="primary bt-explore" ${ok ? '' : 'disabled'}>${icon('leaf', 20)} ${t('battle.explore')}</button>
      <div class="bt-friends">
        <b>${t('battle.friends')}</b>
        <p class="muted">${t('battle.friendsHint')}</p>
        ${
          code
            ? `<div class="bt-code-row">
                 <code class="bt-code">${esc(code)}</code>
                 <button type="button" class="secondary bt-share">${t('battle.share')}</button>
               </div>`
            : ''
        }
        <div class="bt-code-row">
          <input class="bt-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"
            placeholder="${esc(t('battle.paste'))}" value="${esc(this.prefill)}" />
          <button type="button" class="secondary bt-fight" ${ok ? '' : 'disabled'}>${t('battle.fight')}</button>
        </div>
        <p class="bt-error" hidden>${t('battle.badCode')}</p>
      </div>
      <p class="train-note ${ok ? '' : 'bad'}">${esc(note)}</p>`;
    this.prefill = '';
    this.s.bindHead();
    this.sheet.querySelector('.bt-explore')!.addEventListener('click', () => this.fight(this.h.wildFoe()));
    this.sheet.querySelector('.bt-share')?.addEventListener('click', () => {
      const { link } = this.h.myCode();
      this.h.share(t('battle.shareCode', { name: pet.name, species }), link);
    });
    const input = this.sheet.querySelector<HTMLInputElement>('.bt-input')!;
    const error = this.sheet.querySelector<HTMLElement>('.bt-error')!;
    input.addEventListener('input', () => (error.hidden = true));
    this.sheet.querySelector('.bt-fight')!.addEventListener('click', () => {
      const foe = decodeFighter(input.value);
      if (foe) this.fight(foe);
      else error.hidden = false;
    });
    this.s.layout();
  }

  private sideHtml(key: SideKey, side: Side): string {
    const f = side.f;
    const label = f.wild ? t('battle.wildName', { species: f.name }) : f.name;
    return `<div class="bt-side" data-side="${key}">
      <div class="bt-name">
        <b>${esc(label)}</b>
        <span class="chip ${f.type}">${t(`type.${f.type}`)}</span>
        ${f.wild ? '' : `<span class="muted">${esc(speciesName(f.type, f.form))}</span>`}
        <span class="bt-hpnum">${side.hp} / ${side.maxHp}</span>
      </div>
      <div class="track bt-hp"><div class="fill"></div></div>
    </div>`;
  }

  private setHp(key: SideKey, hp: number): void {
    const b = this.battle!;
    const side = b[key];
    const el = this.sheet.querySelector<HTMLElement>(`.bt-side[data-side="${key}"]`);
    if (!el) return;
    const f = hp / side.maxHp;
    const fill = el.querySelector<HTMLElement>('.fill')!;
    fill.style.width = `${f * 100}%`;
    fill.style.background = f > 0.5 ? 'var(--bloom)' : f > 0.2 ? 'var(--amber)' : 'var(--alert)';
    el.querySelector('.bt-hpnum')!.textContent = `${hp} / ${side.maxHp}`;
  }

  private log(text: string): void {
    const el = this.sheet.querySelector('.bt-log');
    if (el) el.textContent = text;
  }

  private setMovesEnabled(on: boolean): void {
    this.sheet.querySelectorAll<HTMLButtonElement>('.bt-move, .bt-flee').forEach((b) => (b.disabled = !on));
  }

  private async fight(foe: Fighter): Promise<void> {
    const pet = this.h.pet();
    this.leave();
    const run = this.run;
    this.foe = foe;
    const b = (this.battle = createBattle(fighterFromPet(pet), foe, this.h.seed()));
    this.s.busy = true;
    const title = foe.wild ? t('battle.wildTitle') : t('battle.friendTitle');
    const moves = b.a.moves
      .map((m) => {
        const tone = MOVES[m].typed ? pet.type : 'neutral';
        return `<button type="button" class="bt-move ${tone}" data-move="${m}" disabled>
          <b>${esc(this.moveName(m, b.a.f))}</b><span>${esc(this.moveInfo(m))}</span>
        </button>`;
      })
      .join('');
    this.sheet.innerHTML = `${this.s.head({ title, sub: t('battle.turn', { n: 1 }) })}
      ${this.sideHtml('b', b.b)}
      ${this.sideHtml('a', b.a)}
      <p class="bt-log" aria-live="polite"></p>
      <div class="bt-moves">${moves}</div>
      <button type="button" class="link bt-flee" disabled>${t(foe.wild ? 'battle.flee' : 'battle.giveUp')}</button>`;
    this.setHp('a', b.a.hp);
    this.setHp('b', b.b.hp);
    this.sheet.querySelectorAll<HTMLButtonElement>('.bt-move').forEach((btn) =>
      btn.addEventListener('click', () => void this.turn(btn.dataset.move as MoveId)),
    );
    this.sheet.querySelector('.bt-flee')!.addEventListener('click', () => this.result(foe.wild ? 'fled' : 'lost'));
    this.s.layout();

    this.h.begin(foe);
    this.log(
      foe.wild
        ? t('battle.appearWild', { species: foe.name })
        : t('battle.appearFriend', { name: foe.name, species: speciesName(foe.type, foe.form) }),
    );
    await wait(1300);
    if (run !== this.run) return;
    this.prompt();
  }

  private prompt(): void {
    const b = this.battle!;
    this.log(t('battle.prompt', { name: b.a.f.name }));
    const sub = this.sheet.querySelector('.train-sub');
    if (sub) sub.textContent = t('battle.turn', { n: b.turn + 1 });
    this.setMovesEnabled(true);
  }

  private async turn(move: MoveId): Promise<void> {
    const b = this.battle;
    if (!b || b.winner) return;
    const run = this.run;
    this.setMovesEnabled(false);
    for (const e of playTurn(b, move)) {
      if (run !== this.run) return;
      this.h.fx(e, b);
      const ms = this.describe(e, b);
      await wait(ms);
    }
    if (run !== this.run) return;
    if (b.winner) {
      await wait(500);
      if (run === this.run) this.result(b.winner === 'a' ? 'won' : 'lost');
    } else if (b.turn >= MAX_TURNS) this.result('fled');
    else this.prompt();
  }

  /** Show what an event means in the log and HP bars; returns how long to let it sink in. */
  private describe(e: BattleEvent, b: Battle): number {
    const name = (k: SideKey) => {
      const f = b[k].f;
      return f.wild ? t('battle.wildName', { species: f.name }) : f.name;
    };
    switch (e.kind) {
      case 'use':
        this.log(t('battle.use', { name: name(e.side), move: this.moveName(e.move, b[e.side].f) }));
        return 750;
      case 'hit': {
        this.setHp(e.target, e.hp);
        const notes = [
          e.crit ? t('battle.crit') : '',
          e.factor > 1 ? t('battle.strong') : e.factor < 1 ? t('battle.weak') : '',
        ].filter(Boolean);
        if (notes.length) {
          this.log(notes.join(' '));
          return 800;
        }
        return 450;
      }
      case 'hits':
        this.log(t('battle.hits', { n: e.n }));
        return 600;
      case 'miss':
        this.log(t('battle.miss'));
        return 650;
      case 'heal':
        this.setHp(e.side, e.hp);
        this.log(t('battle.heal', { name: name(e.side) }));
        return 650;
      case 'focus':
        this.log(t('battle.focus', { name: name(e.side) }));
        return 650;
      case 'guard':
        this.log(t('battle.guard', { name: name(e.side) }));
        return 650;
      case 'dazed':
        this.log(t('battle.dazed', { name: name(e.side) }));
        return 700;
      case 'skip':
        this.log(t('battle.skip', { name: name(e.side) }));
        return 800;
      case 'ignore':
        this.log(t('battle.ignore', { name: name(e.side) }));
        return 900;
      case 'wild':
        this.log(t('battle.ownThing', { name: name(e.side) }));
        return 800;
      case 'faint':
        this.log(t('battle.faint', { name: name(e.side) }));
        return 1000;
    }
  }

  private result(outcome: Outcome): void {
    const foe = this.foe!;
    const pet = this.h.pet();
    this.run++;
    const reward = this.h.finish(outcome, foe);
    this.s.busy = false;
    const foeName = foe.wild ? t('battle.wildName', { species: foe.name }) : foe.name;
    const body =
      outcome === 'won'
        ? t('battle.wonBody', { name: pet.name, foe: foeName })
        : outcome === 'lost'
          ? t('battle.lostBody', { foe: foeName })
          : t('battle.fledBody');
    const gain = reward.stat
      ? `<p class="train-gain ${pet.type}">${t('train.gain', { stat: t(`stat.${reward.stat}`), n: reward.gain })}</p>`
      : '';
    const share = !foe.wild && outcome !== 'fled';
    this.sheet.innerHTML = `<div class="train-result">
        <span class="bubble ${outcome === 'won' ? 'amber-btn' : 'violet-btn'}">${icon(outcome === 'won' ? 'star' : 'shield', 34)}</span>
        <h2>${t(`battle.${outcome}`)}</h2>
        <p>${esc(body)}</p>
        ${gain}
        <p class="muted">${t('battle.record', { w: pet.battles.wins, l: pet.battles.losses })}</p>
        <div class="train-actions">
          ${share ? `<button type="button" class="secondary bt-share-result">${t('battle.shareResult')}</button>` : '<span></span>'}
          <button type="button" class="primary train-done">${t('train.done')}</button>
        </div>
      </div>`;
    this.sheet.querySelector('.train-done')!.addEventListener('click', () => this.menu());
    this.sheet.querySelector('.bt-share-result')?.addEventListener('click', () => {
      const text = t(outcome === 'won' ? 'battle.shareWon' : 'battle.shareLost', { name: pet.name, foe: foe.name });
      this.h.share(text, this.h.myCode().link);
    });
    this.s.layout();
  }
}
