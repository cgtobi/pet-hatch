import { t, type TextKey } from '../i18n';
import { DojoSession } from '../net/dojo';
import { LiveError, LiveSession, newRoomCode, parseRoomCode, type LiveErrorCode } from '../net/live';
import {
  BATTLE_ENERGY,
  battleState,
  createBattle,
  fighterFromPet,
  MAX_TURNS,
  MOVES,
  XP_PER_POINT,
  movesFor,
  playTurn,
  type Battle,
  type BattleEvent,
  type BattleReward,
  type BattleSummary,
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
  /** Invite link for a live battle room. */
  liveLink(room: string): string;
  share(text: string, link: string): void;
  /** Bring the opponent onto the island. */
  begin(foe: Fighter): void;
  /** 3D and sound for one battle event; `me` is the side the player controls. */
  fx(e: BattleEvent, b: Battle, me: SideKey): void;
  /** Apply the outcome to the real pet; returns any stat reward and the experience earned. */
  finish(outcome: Outcome, foe: Fighter, summary: BattleSummary): BattleReward;
  /** Send the opponent away and free the pet. */
  end(): void;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const other = (k: SideKey): SideKey => (k === 'a' ? 'b' : 'a');

/** The Battle tab: record, wild battles and friend battles (codes or live); then the fight and its result. */
export class Arena {
  /** WebSocket URL of the live battle relay, if this deployment has one. */
  relay: string | null = null;
  private sheet: HTMLElement;
  private battle: Battle | null = null;
  private foe: Fighter | null = null;
  /** The side the player controls: always a, except as the guest of a live battle. */
  private me: SideKey = 'a';
  private live: LiveSession | null = null;
  /** Bumped whenever a fight is abandoned, so a running animation sequence stops. */
  private run = 0;
  private prefill = '';
  /** Waiting in the dojo (open only while the dojo screen is). */
  private dojo: DojoSession | null = null;
  /** The current fight came from the dojo: opponents stay anonymous and "Fight again" re-enters. */
  private fromDojo = false;
  /** How long a matched pair may take to meet in their room before both go back to waiting. */
  private static DOJO_MEET_MS = 20_000;

  constructor(
    private s: ActivitySheet,
    private h: ArenaHandlers,
  ) {
    this.sheet = s.el;
    s.register('battle', () => this.menu());
    s.onClose(() => this.leave());
    // Only players who are actually in the dojo take part: switching apps or locking the phone leaves it.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.dojo || (this.live && !this.battle && this.fromDojo))) this.dojoLeft();
    });
  }

  /** Open the Battle tab with a friend's battle code or live room ready (from a link). */
  challenge(code: string): void {
    this.prefill = code;
    this.s.open('battle');
  }

  private leave(): void {
    this.run++;
    this.dojo?.close();
    this.dojo = null;
    // Leaving mid-battle counts as giving up for the other player.
    this.live?.close(!!this.battle && !this.battle.winner);
    this.live = null;
    if (this.battle) this.h.end();
    this.battle = null;
    this.foe = null;
    this.me = 'a';
    this.fromDojo = false;
  }

  private xpBar(xp: number, label = t('battle.xp')): string {
    return `<div class="bt-xp-row">
      <span class="muted">${esc(label)}</span>
      <div class="track bt-xp"><div class="fill" style="width:${(xp / XP_PER_POINT) * 100}%"></div></div>
    </div>`;
  }

  private moveName(move: MoveId, f: Fighter): string {
    return move === 'element' ? t(`move.element.${f.type}`) : t(`move.${move}` as TextKey);
  }

  private moveInfo(move: MoveId): string {
    return t(`move.${move}.info` as TextKey, { n: MOVES[move].power });
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
      ${pet.stage >= 1 ? this.xpBar(pet.battleXp) : ''}
      <button type="button" class="primary bt-explore" ${ok ? '' : 'disabled'}>${icon('leaf', 20)} ${t('battle.explore')}</button>
      ${
        this.relay && pet.stage >= 1
          ? `<button type="button" class="secondary bt-enter-dojo" ${ok ? '' : 'disabled'}>${icon('shield', 18)} ${t('dojo.enter')}</button>`
          : ''
      }
      <div class="bt-friends">
        <b>${t('battle.friends')}</b>
        <p class="muted">${t(this.relay ? 'live.hint' : 'battle.friendsHint')}</p>
        ${
          this.relay
            ? `<button type="button" class="secondary bt-host" ${ok ? '' : 'disabled'}>${icon('bolt', 18)} ${t('live.start')}</button>`
            : ''
        }
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
    this.sheet.querySelector('.bt-explore')!.addEventListener('click', () => void this.fight(this.h.wildFoe()));
    this.sheet.querySelector('.bt-enter-dojo')?.addEventListener('click', () => this.enterDojo());
    this.sheet.querySelector('.bt-host')?.addEventListener('click', () => this.lobby('host', newRoomCode()));
    this.sheet.querySelector('.bt-share')?.addEventListener('click', () => {
      const { link } = this.h.myCode();
      this.h.share(t('battle.shareCode', { name: pet.name, species }), link);
    });
    const input = this.sheet.querySelector<HTMLInputElement>('.bt-input')!;
    const error = this.sheet.querySelector<HTMLElement>('.bt-error')!;
    input.addEventListener('input', () => (error.hidden = true));
    this.sheet.querySelector('.bt-fight')!.addEventListener('click', () => {
      // One field for both: a short room code (or ?live= link) joins a live battle, anything else is a battle code.
      const room = this.relay ? parseRoomCode(input.value) : null;
      if (room) return this.lobby('guest', room);
      const foe = decodeFighter(input.value);
      if (foe) void this.fight(foe);
      else error.hidden = false;
    });
    this.s.layout();
  }

  /** Connect to a live room: the host waits for a friend, the guest joins; then the fight starts. */
  private lobby(role: 'host' | 'guest', room: string): void {
    this.leave();
    const run = this.run;
    const pet = this.h.pet();
    const live = (this.live = new LiveSession(this.relay!, room, role, fighterFromPet(pet)));
    this.s.busy = true;
    this.sheet.innerHTML = `${this.s.head({ title: t('live.title'), sub: t('live.roomCode'), closeLabel: t('live.back') })}
      <div class="bt-lobby">
        <div class="bt-room-code">${esc(room)}</div>
        ${role === 'host' ? `<button type="button" class="primary bt-invite">${t('live.invite')}</button>` : ''}
        <p class="bt-lobby-status">${t(role === 'host' ? 'live.waitingFriend' : 'live.joining')}</p>
        <p class="bt-lobby-detail" hidden></p>
      </div>`;
    this.s.bindHead(() => this.menu());
    this.sheet.querySelector('.bt-invite')?.addEventListener('click', () =>
      this.h.share(t('live.inviteText', { name: pet.name, code: room }), this.h.liveLink(room)),
    );
    const status = this.sheet.querySelector<HTMLElement>('.bt-lobby-status')!;
    live.onPeers = (n) => {
      if (n >= 2) status.textContent = t('live.connecting');
    };
    live.onFail = (e) => {
      if (run !== this.run) return;
      status.textContent = this.liveMessage(e, '');
      status.classList.add('bad');
      if (e.code === 'unreachable') {
        // Show where it tried, so a wrong or stale address (an old dev server, localhost on a phone) is obvious.
        const detail = this.sheet.querySelector<HTMLElement>('.bt-lobby-detail')!;
        detail.textContent = this.relay ?? '';
        detail.hidden = false;
      }
      this.s.busy = false;
    };
    live.ready.then(
      (match) => {
        if (run !== this.run) return;
        void this.fight(live.side === 'a' ? match.b : match.a, { session: live, seed: match.seed, a: match.a, b: match.b });
      },
      () => {},
    );
    this.s.layout();
  }

  /** Why a live battle ended; without an opponent name (still in the lobby) "you win" messages don't apply. */
  private liveMessage(e: LiveError, foeName: string): string {
    const known = foeName
      ? ['unreachable', 'no-room', 'full', 'left', 'gave-up', 'desync', 'timeout']
      : ['unreachable', 'no-room', 'full', 'desync'];
    return t(`live.error.${known.includes(e.code) ? e.code : 'other'}` as TextKey, { name: foeName });
  }

  /** The dojo: wait to be matched with a pet of similar strength, then fight live automatically. */
  private enterDojo(): void {
    this.leave();
    if (this.h.check() !== 'ok' || !this.relay) return this.menu();
    const run = this.run;
    const pet = this.h.pet();
    this.fromDojo = true;
    this.s.busy = true;
    this.sheet.innerHTML = `${this.s.head({ title: t('dojo.title'), sub: t('dojo.about'), closeLabel: t('live.back') })}
      <div class="bt-lobby">
        <span class="bubble violet-btn dojo-mark">${icon('shield', 34)}</span>
        <p class="bt-lobby-status">${t('dojo.waiting')}</p>
        <p class="bt-lobby-detail dojo-players">${t('dojo.empty')}</p>
        <button type="button" class="secondary bt-leave-dojo">${t('dojo.leave')}</button>
      </div>`;
    this.s.bindHead(() => this.menu());
    this.sheet.querySelector('.bt-leave-dojo')!.addEventListener('click', () => this.menu());
    const status = this.sheet.querySelector<HTMLElement>('.bt-lobby-status')!;
    const players = this.sheet.querySelector<HTMLElement>('.dojo-players')!;
    const fail = (code: LiveErrorCode) => {
      if (run !== this.run) return;
      status.textContent = this.liveMessage(new LiveError(code), '');
      status.classList.add('bad');
      players.hidden = true;
      this.s.busy = false;
    };

    const dojo = (this.dojo = new DojoSession(this.relay, this.h.myCode().code));
    dojo.onPlayers = (n) => {
      players.textContent = n === 0 ? t('dojo.empty') : n === 1 ? t('dojo.one') : t('dojo.players', { n });
    };
    dojo.onFail = fail;
    dojo.onMatch = (room, role) => {
      if (run !== this.run) return;
      this.dojo = null;
      status.textContent = t('dojo.found');
      players.hidden = true;
      const live = (this.live = new LiveSession(this.relay!, room, role, fighterFromPet(pet)));
      // If the other pet never shows up, both simply go back to waiting.
      const giveUp = setTimeout(() => run === this.run && this.enterDojo(), Arena.DOJO_MEET_MS);
      live.onFail = () => {
        clearTimeout(giveUp);
        if (run === this.run) setTimeout(() => run === this.run && this.enterDojo(), 1200);
      };
      live.ready.then(
        (match) => {
          clearTimeout(giveUp);
          if (run !== this.run) return;
          // Strangers stay anonymous: their pet is shown by its species only.
          const theirs = other(live.side);
          const anon = (f: Fighter): Fighter => ({ ...f, name: speciesName(f.type, f.form) });
          const a = theirs === 'a' ? anon(match.a) : match.a;
          const b = theirs === 'b' ? anon(match.b) : match.b;
          void this.fight(theirs === 'a' ? a : b, { session: live, seed: match.seed, a, b });
        },
        () => {},
      );
    };
    this.s.layout();
  }

  /** The player switched away while in the dojo: they're out; offer to come back in. */
  private dojoLeft(): void {
    this.leave();
    this.sheet.innerHTML = `${this.s.head({ title: t('dojo.title'), sub: t('dojo.about'), closeLabel: t('live.back') })}
      <div class="bt-lobby">
        <p class="bt-lobby-status">${t('dojo.left')}</p>
        <button type="button" class="primary bt-reenter">${t('dojo.enter')}</button>
      </div>`;
    this.s.bindHead(() => this.menu());
    this.sheet.querySelector('.bt-reenter')!.addEventListener('click', () => this.enterDojo());
    this.s.busy = false;
    this.s.layout();
  }

  private sideHtml(key: SideKey, side: Side): string {
    const f = side.f;
    const label = f.wild ? t('battle.wildName', { species: f.name }) : f.name;
    return `<div class="bt-side ${key === this.me ? 'mine' : ''}" data-side="${key}">
      <div class="bt-name">
        <b>${esc(label)}</b>
        <span class="chip ${f.type}">${t(`type.${f.type}`)}</span>
        ${f.wild || f.name === speciesName(f.type, f.form) ? '' : `<span class="muted">${esc(speciesName(f.type, f.form))}</span>`}
        <span class="bt-hpnum">${side.hp} / ${side.maxHp}</span>
      </div>
      <div class="track bt-hp"><div class="fill"></div></div>
    </div>`;
  }

  private setHp(key: SideKey, hp: number): void {
    const side = this.battle![key];
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

  private foeName(f: Fighter): string {
    return f.wild ? t('battle.wildName', { species: f.name }) : f.name;
  }

  private async fight(
    foe: Fighter,
    live?: { session: LiveSession; seed: number; a: Fighter; b: Fighter },
  ): Promise<void> {
    const pet = this.h.pet();
    if (!live) this.leave();
    const dojoFight = this.fromDojo && !!live;
    this.run++;
    const run = this.run;
    this.foe = foe;
    this.me = live ? live.session.side : 'a';
    this.live = live?.session ?? null;
    const b = (this.battle = live
      ? createBattle(live.a, live.b, live.seed)
      : createBattle(fighterFromPet(pet), foe, this.h.seed()));
    const me = this.me;
    this.s.busy = true;
    const title = dojoFight
      ? t('dojo.title')
      : live
        ? t('live.title')
        : foe.wild
          ? t('battle.wildTitle')
          : t('battle.friendTitle');
    const moves = b[me].moves
      .map((m) => {
        const tone = MOVES[m].typed ? pet.type : 'neutral';
        return `<button type="button" class="bt-move ${tone}" data-move="${m}" disabled>
          <b>${esc(this.moveName(m, b[me].f))}</b><span>${esc(this.moveInfo(m))}</span>
        </button>`;
      })
      .join('');
    this.sheet.innerHTML = `${this.s.head({ title, sub: t('battle.turn', { n: 1 }) })}
      ${this.sideHtml(other(me), b[other(me)])}
      ${this.sideHtml(me, b[me])}
      <p class="bt-log" aria-live="polite"></p>
      <div class="bt-moves">${moves}</div>
      <button type="button" class="link bt-flee" disabled>${t(foe.wild ? 'battle.flee' : 'battle.giveUp')}</button>`;
    this.setHp('a', b.a.hp);
    this.setHp('b', b.b.hp);
    this.sheet.querySelectorAll<HTMLButtonElement>('.bt-move').forEach((btn) =>
      btn.addEventListener('click', () => void this.turn(btn.dataset.move as MoveId)),
    );
    this.sheet.querySelector('.bt-flee')!.addEventListener('click', () => {
      this.live?.close(true);
      this.result(foe.wild ? 'fled' : 'lost', undefined, { gaveUp: !foe.wild });
    });
    if (this.live) {
      this.live.onFail = (e) => {
        // Once the winner is known both phones are just animating; a closing connection doesn't matter then.
        if (run !== this.run || b.winner) return;
        const forfeit = e.code === 'left' || e.code === 'gave-up' || e.code === 'timeout';
        this.result(forfeit ? 'won' : 'fled', this.liveMessage(e, foe.name), { forfeit });
      };
    }
    this.s.layout();

    this.h.begin(foe);
    this.log(
      foe.wild
        ? t('battle.appearWild', { species: foe.name })
        : dojoFight
          ? t('dojo.appear', { species: foe.name })
          : t('battle.appearFriend', { name: foe.name, species: speciesName(foe.type, foe.form) }),
    );
    await wait(1300);
    if (run !== this.run) return;
    this.prompt();
  }

  private prompt(): void {
    const b = this.battle!;
    this.log(t('battle.prompt', { name: b[this.me].f.name }));
    const sub = this.sheet.querySelector('.train-sub');
    if (sub) sub.textContent = t('battle.turn', { n: b.turn + 1 });
    this.setMovesEnabled(true);
  }

  private async turn(move: MoveId): Promise<void> {
    const b = this.battle;
    if (!b || b.winner) return;
    const run = this.run;
    const me = this.me;
    this.setMovesEnabled(false);
    let events: BattleEvent[];
    if (this.live) {
      const live = this.live;
      const turn = b.turn;
      this.log(t('live.waitingMove', { name: this.foe!.name }));
      // Give up stays available while waiting for the other player.
      const flee = this.sheet.querySelector<HTMLButtonElement>('.bt-flee');
      if (flee) flee.disabled = false;
      let theirs: MoveId;
      try {
        theirs = await live.exchange(turn, move);
      } catch {
        return; // onFail already ended the battle
      }
      if (run !== this.run) return;
      if (flee) flee.disabled = true;
      events = me === 'a' ? playTurn(b, move, theirs) : playTurn(b, theirs, move);
      live.sync(turn, battleState(b));
    } else events = playTurn(b, move);

    for (const e of events) {
      if (run !== this.run) return;
      this.h.fx(e, b, me);
      await wait(this.describe(e, b));
    }
    if (run !== this.run) return;
    if (b.winner) {
      await wait(500);
      if (run === this.run) this.result(b.winner === me ? 'won' : 'lost');
    } else if (b.turn >= MAX_TURNS) this.result('fled');
    else this.prompt();
  }

  /** Show what an event means in the log and HP bars; returns how long to let it sink in. */
  private describe(e: BattleEvent, b: Battle): number {
    const name = (k: SideKey) => this.foeName(b[k].f);
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

  /**
   * `note` replaces the usual summary line (e.g. why a live battle ended early); `how` says whether the
   * other side forfeited or the player gave up, which matters for experience.
   */
  private result(outcome: Outcome, note?: string, how: { forfeit?: boolean; gaveUp?: boolean } = {}): void {
    const foe = this.foe!;
    const pet = this.h.pet();
    const wasLive = !!this.live;
    this.run++;
    // The battle is decided: close the connection without telling the other side we gave up.
    this.live?.close(false);
    this.live = null;
    const b = this.battle;
    const foeSide = b?.[other(this.me)];
    const summary: BattleSummary = {
      turns: b?.turn ?? 0,
      damageDealt: foeSide ? 1 - foeSide.hp / foeSide.maxHp : 0,
      foe,
      forfeit: !!how.forfeit,
      gaveUp: !!how.gaveUp,
    };
    const reward = this.h.finish(outcome, foe, summary);
    this.s.busy = false;
    const foeName = this.foeName(foe);
    const body =
      note ??
      (outcome === 'won'
        ? t('battle.wonBody', { name: pet.name, foe: foeName })
        : outcome === 'lost'
          ? t('battle.lostBody', { foe: foeName })
          : t('battle.fledBody'));
    const gain = reward.stat
      ? `<p class="train-gain ${pet.type}">${t('train.gain', { stat: t(`stat.${reward.stat}`), n: reward.gain })}</p>`
      : '';
    // Experience: what this battle added, the bar, and a stat point when the bar filled.
    const capped = !reward.learned && pet.battleXp >= XP_PER_POINT;
    const xp = reward.xp
      ? `${this.xpBar(pet.battleXp, t('battle.xpGain', { n: reward.xp }))}
         ${
           reward.learned
             ? `<p class="train-gain ${pet.type}">${t('train.gain', { stat: t(`stat.${reward.learned}`), n: 1 })}</p>
                <p class="muted">${esc(reward.teacher ? t('battle.learned', { name: reward.teacher }) : t('battle.xpPoint'))}</p>`
             : capped
               ? `<p class="muted">${t('battle.xpFull')}</p>`
               : ''
         }`
      : '';
    const share = !foe.wild && !wasLive && outcome !== 'fled';
    const dojoAgain = this.fromDojo
      ? `<button type="button" class="secondary bt-dojo-again" ${this.h.check() === 'ok' ? '' : 'disabled'}>${t('dojo.again')}</button>`
      : '';
    this.sheet.innerHTML = `<div class="train-result">
        <span class="bubble ${outcome === 'won' ? 'amber-btn' : 'violet-btn'}">${icon(outcome === 'won' ? 'star' : 'shield', 34)}</span>
        <h2>${t(`battle.${outcome}`)}</h2>
        <p>${esc(body)}</p>
        ${gain}
        ${xp}
        <p class="muted">${t('battle.record', { w: pet.battles.wins, l: pet.battles.losses })}</p>
        <div class="train-actions">
          ${dojoAgain || (share ? `<button type="button" class="secondary bt-share-result">${t('battle.shareResult')}</button>` : '<span></span>')}
          <button type="button" class="primary train-done">${t('train.done')}</button>
        </div>
      </div>`;
    this.sheet.querySelector('.train-done')!.addEventListener('click', () => this.menu());
    this.sheet.querySelector('.bt-dojo-again')?.addEventListener('click', () => this.enterDojo());
    this.sheet.querySelector('.bt-share-result')?.addEventListener('click', () => {
      const text = t(outcome === 'won' ? 'battle.shareWon' : 'battle.shareLost', { name: pet.name, foe: foe.name });
      this.h.share(text, this.h.myCode().link);
    });
    this.s.layout();
  }
}
