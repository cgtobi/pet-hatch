/**
 * Training and battles: the Train and Battle tabs' handlers, and the effects a battle plays on the island.
 */
import { haptic, sfx } from '../feedback';
import { t } from '../i18n';
import { BATTLE_ENERGY, encounterSeed, fighterFromPet, finishBattle, MOVES, wildFoe, type SideKey } from '../sim/battle';
import { CHALLENGE_PARAM, encodeFighter } from '../sim/battlecode';
import { randomSeed } from '../sim/rng';
import { canTrain, finishTraining, startTraining, type TrainStat } from '../sim/training';
import type { ElementType } from '../sim/types';
import { newGhostKey } from '../net/dojo';
import { noteSeen } from '../sim/book';
import { speciesName } from '../sim/evolution';
import { Arena } from '../ui/arena';
import { Training } from '../ui/training';
import type { Game } from './context';
import { shareLink } from './share';

/** Invite links for live battles: ?live=ROOM. */
export const LIVE_PARAM = 'live';

/** Sets up the Train and Battle tabs; returns the arena (its relay is filled in once known). */
export function setUpBattles(g: Game): Arena {
  new Training(g.sheet, {
    pet: () => g.state.pet!,
    check: () => {
      const pet = g.livePet();
      return pet ? canTrain(pet, g.now(), g.state.settings) : 'asleep';
    },
    start: () => {
      const pet = g.livePet();
      if (!pet) return false;
      if (startTraining(pet, g.now()) === 'ok') return true;
      g.world.pet?.cower();
      sfx.scold();
      g.hud.toast(t('toast.refused', { name: pet.name }));
      g.save();
      g.refresh();
      return false;
    },
    hit: () => {
      g.world.pet?.hop();
      sfx.hit();
      haptic('tap');
    },
    miss: () => sfx.miss(),
    finish: (stat: TrainStat, score: number) => {
      const pet = g.state.pet!;
      const r = finishTraining(pet, stat, score);
      const at = g.petCenter();
      if (score >= 0.6) {
        g.world.pet?.dance();
        g.world.effects.emit('spark', at, 14);
        sfx.play();
        haptic('success');
      } else {
        g.world.effects.emit('spark', at, 4);
        sfx.tap();
      }
      g.save();
      g.refresh();
      return r;
    },
  });

  /** 3D creature for a battle side: the player's own side is their pet, the other is the opponent. */
  const fighter3d = (side: SideKey, me: SideKey) => (side === me ? g.world.pet : g.world.foe);
  /** Particles for a hit, by the attacker's element. */
  const ELEMENT_FX: Record<ElementType, 'spark' | 'drop' | 'heart'> = { ember: 'spark', tide: 'drop', bloom: 'heart', astral: 'spark' };

  const arena = new Arena(g.sheet, {
    pet: () => g.state.pet!,
    check: () => {
      const pet = g.livePet();
      return pet ? canTrain(pet, g.now(), g.state.settings, BATTLE_ENERGY) : 'asleep';
    },
    seed: () => randomSeed(),
    wildFoe: () => wildFoe(g.state.pet!, encounterSeed(g.state.pet!, g.now())),
    myCode: () => {
      const code = encodeFighter(fighterFromPet(g.state.pet!));
      const url = new URL(location.href);
      url.search = '';
      url.hash = '';
      url.searchParams.set(CHALLENGE_PARAM, code);
      return { code, link: url.toString() };
    },
    ghostKey: () => {
      const pet = g.state.pet!;
      if (!pet.ghostKey) {
        pet.ghostKey = newGhostKey();
        g.save();
      }
      return pet.ghostKey;
    },
    liveLink: (room) => {
      const url = new URL(location.href);
      url.search = '';
      url.hash = '';
      url.searchParams.set(LIVE_PARAM, room);
      return url.toString();
    },
    share: (text, link) => void shareLink(text, link, (m) => g.hud.toast(m)),
    invite: () => g.state.invite ?? null,
    inviteUsed: (code) => {
      if (g.state.invite && code === g.state.invite) {
        delete g.state.invite;
        g.save();
      }
    },
    begin: (foe) => {
      g.world.startBattle(foe.type, foe.seed, foe.form, foe.stage);
      sfx.grow();
      haptic('press');
      // Every species met goes into the species book; a new one is worth a word.
      if (noteSeen(g.state, foe.type, foe.form)) {
        g.hud.toast(t('book.newSeen', { species: speciesName(foe.type, foe.form) }));
      }
      g.save();
    },
    fx: (e, b, me) => {
      const self = fighter3d(e.side, me);
      switch (e.kind) {
        case 'use':
          if (MOVES[e.move].power > 0) {
            self?.lunge();
            sfx.whoosh();
          } else {
            self?.hop();
            sfx.tap();
          }
          break;
        case 'hit': {
          const target = fighter3d(e.target, me);
          target?.hurt();
          const at = target?.center() ?? g.world.egg.center();
          g.world.effects.emit(ELEMENT_FX[b[e.side].f.type], at, e.crit ? 14 : 8);
          sfx.strike(e.crit || e.factor > 1);
          if (e.target === me) haptic(e.crit ? 'crit' : 'hit');
          break;
        }
        case 'miss':
          sfx.miss();
          break;
        case 'heal':
        case 'focus':
        case 'guard':
          g.world.effects.emit(e.kind === 'heal' ? 'heart' : 'spark', self?.center() ?? g.world.egg.center(), 6);
          sfx.cure();
          break;
        case 'thorns':
          self?.hurt();
          sfx.miss();
          if (e.side === me) haptic('hit');
          break;
        case 'shatter':
          g.world.effects.emit('spark', self?.center() ?? g.world.egg.center(), 12);
          sfx.crack();
          break;
        case 'dazed':
        case 'flinch':
        case 'ignore':
        case 'skip':
          g.world.effects.emit('zzz', self?.center() ?? g.world.egg.center(), 1);
          sfx.nope();
          break;
        case 'faint':
          self?.faint();
          fighter3d(e.side === 'a' ? 'b' : 'a', me)?.dance();
          sfx.faint();
          break;
      }
    },
    finish: (outcome, _foe, summary) => {
      const pet = g.state.pet!;
      const r = finishBattle(pet, outcome, randomSeed(), summary);
      if (outcome === 'won') {
        sfx.win();
        haptic('celebrate');
      } else if (outcome === 'lost') sfx.lose();
      g.save();
      g.refresh();
      return r;
    },
    end: () => g.world.endBattle(),
  });

  return arena;
}
