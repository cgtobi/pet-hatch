export type Lang = 'en' | 'de';
export type LangSetting = Lang | 'auto';

const en = {
  'app.title': 'Pet Hatch',
  'aria.scene': 'Your floating island',
  'aria.more': 'More',
  'aria.status': 'Status',
  'aria.dock': 'Care actions',

  'egg.title': 'Your egg',
  'egg.day': 'Day {n}',
  'egg.mood.0': "It's very quiet in there",
  'egg.mood.1': 'Something is stirring',
  'egg.mood.2': 'Something is wriggling inside',
  'egg.mood.3': 'Tiny cracks are appearing!',
  'egg.mood.4': "It's about to hatch!",
  'egg.sleeping': 'Sleeping soundly',

  'stage.0': 'Quiet',
  'stage.1': 'Stirring',
  'stage.2': 'Wobbly',
  'stage.3': 'Cracking',
  'stage.4': 'Hatching',

  'need.warmth': 'Warmth',
  'need.humidity': 'Humid',
  'need.bond': 'Bond',
  'need.turn': 'Turn',

  'lean.title': 'Care leans',
  'lean.Ember': 'Ember',
  'lean.Tide': 'Tide',
  'lean.Bloom': 'Bloom',
  'lean.Balanced': 'Balanced',
  'lean.Unknown': 'Not sure yet',

  'type.ember': 'Ember',
  'type.tide': 'Tide',
  'type.bloom': 'Bloom',
  'type.astral': 'Astral',

  'action.warm': 'Warm',
  'action.mist': 'Mist',
  'action.sing': 'Sing',
  'action.turn': 'Turn',
  'action.lights': 'Lights',

  'hint.ready': 'Tap the egg to help it hatch!',
  'hint.rush': 'Keep tapping! {n} more',
  'hint.cold': 'It feels cold. Press and hold the egg to warm it',
  'hint.turnNow': 'It needs turning. Swipe sideways across the egg',
  'hint.dry': 'The shell looks dry. Swipe up on the egg to mist it',
  'hint.lonely': 'It seems lonely. Stroke it back and forth, or sing',
  'hint.turnSoon': 'Needs turning in about {h} h',
  'hint.turnSoonest': 'Needs turning within the hour',
  'hint.sleep': 'Shh… everyone is sleeping',
  'hint.lightsNight': "It's bedtime. Turn the lights off so it can rest",
  'hint.firstTime': 'Hold to warm · swipe up to mist · stroke to comfort',

  'toast.turned': 'Turned!',
  'toast.turnedRecently': 'It was just turned',
  'toast.toasty': 'Warm and toasty',
  'toast.misted': 'Nice and moist',
  'toast.full': 'It has plenty of that',
  'toast.copied': 'Save code copied',
  'toast.copyFailed': 'Copy failed. Select the code and copy it by hand',
  'toast.imported': 'Save loaded',
  'toast.importFailed': 'That save code is not valid',
  'toast.lightsOff': 'Lights off. Good night!',
  'toast.lightsOn': 'Lights on',

  'failed.title': 'The egg went cold',
  'failed.body': "It didn't make it this time. Classic mode is unforgiving.",
  'failed.button': 'Start a new egg',

  'reveal.title': 'Your {type} baby hatched!',
  'reveal.alone': 'It hatched while you were away, and waited for you to come back.',
  'reveal.body.ember': 'All that warmth paid off. This little one runs hot and loves the sun.',
  'reveal.body.tide': 'Kept moist and cared for, it hatched cool, calm and splashy.',
  'reveal.body.bloom': 'All those songs and cuddles grew a gentle, leafy friend.',
  'reveal.body.astral': 'Perfectly balanced care. A rare Astral baby, glowing faintly.',
  'reveal.button': 'Hello, little one!',

  'pet.title': '{type} baby',
  'pet.subtitle': 'Hatched {when}',
  'pet.today': 'today',
  'pet.daysAgo': '{n} d ago',
  'pet.hint': 'Raising, training and battles arrive in the next update',

  'settings.title': 'Settings',
  'settings.language': 'Language',
  'lang.auto': 'Device',
  'lang.en': 'English',
  'lang.de': 'Deutsch',
  'settings.neglect': 'When care is missed',
  'neglect.cozy': 'Cozy: nothing bad happens',
  'neglect.gentle': 'Gentle: neglect has consequences',
  'neglect.classic': 'Classic: the egg can be lost',
  'settings.sleep': 'Bedtime',
  'settings.sleepHint': 'Needs barely drop while you sleep.',
  'settings.sleepFrom': 'From',
  'settings.sleepTo': 'To',
  'settings.sound': 'Sound',
  'settings.backup': 'Backup',
  'settings.backupHint': 'Progress lives in this browser. Copy the code to keep a backup or move devices.',
  'settings.export': 'Copy save code',
  'settings.import': 'Load save code',
  'settings.importPlaceholder': 'Paste a save code here',
  'settings.newEgg': 'Start a new egg',
  'settings.newEggConfirm': 'This replaces your current egg or pet. Continue?',
  'settings.done': 'Done',
  'settings.app': 'App',
  'settings.install': 'Install app',
  'settings.installIos': 'On iPhone or iPad: tap Share, then “Add to Home Screen”.',
  'settings.installOther': 'Use your browser menu to install or add it to your home screen.',
  'settings.installed': 'Running as an installed app.',
  'settings.debug': 'Debug',
  'debug.skip1': '+1 h',
  'debug.skip6': '+6 h',
  'debug.ready': 'Ready now',
};

type Key = keyof typeof en;

const de: Record<Key, string> = {
  'app.title': 'Pet Hatch',
  'aria.scene': 'Deine schwebende Insel',
  'aria.more': 'Mehr',
  'aria.status': 'Status',
  'aria.dock': 'Pflege-Aktionen',

  'egg.title': 'Dein Ei',
  'egg.day': 'Tag {n}',
  'egg.mood.0': 'Drinnen ist es ganz still',
  'egg.mood.1': 'Da regt sich etwas',
  'egg.mood.2': 'Drinnen zappelt etwas',
  'egg.mood.3': 'Kleine Risse erscheinen!',
  'egg.mood.4': 'Gleich schlüpft es!',
  'egg.sleeping': 'Schläft tief und fest',

  'stage.0': 'Still',
  'stage.1': 'Regt sich',
  'stage.2': 'Wackelt',
  'stage.3': 'Knackt',
  'stage.4': 'Schlüpft',

  'need.warmth': 'Wärme',
  'need.humidity': 'Feuchte',
  'need.bond': 'Bindung',
  'need.turn': 'Wenden',

  'lean.title': 'Pflege neigt zu',
  'lean.Ember': 'Glut',
  'lean.Tide': 'Flut',
  'lean.Bloom': 'Blüte',
  'lean.Balanced': 'Ausgewogen',
  'lean.Unknown': 'Noch unklar',

  'type.ember': 'Glut',
  'type.tide': 'Flut',
  'type.bloom': 'Blüte',
  'type.astral': 'Astral',

  'action.warm': 'Wärmen',
  'action.mist': 'Sprühen',
  'action.sing': 'Singen',
  'action.turn': 'Wenden',
  'action.lights': 'Licht',

  'hint.ready': 'Tippe aufs Ei, damit es schlüpfen kann!',
  'hint.rush': 'Weiter tippen! Noch {n}',
  'hint.cold': 'Es ist kalt. Halte das Ei gedrückt, um es zu wärmen',
  'hint.turnNow': 'Es muss gewendet werden. Wische seitwärts übers Ei',
  'hint.dry': 'Die Schale ist trocken. Wische auf dem Ei nach oben',
  'hint.lonely': 'Es wirkt einsam. Streichle es hin und her oder sing ihm vor',
  'hint.turnSoon': 'Muss in etwa {h} Std. gewendet werden',
  'hint.turnSoonest': 'Muss innerhalb der nächsten Stunde gewendet werden',
  'hint.sleep': 'Psst… alle schlafen',
  'hint.lightsNight': 'Schlafenszeit. Mach das Licht aus, damit es ruhen kann',
  'hint.firstTime': 'Halten zum Wärmen · nach oben wischen zum Sprühen · streicheln zum Trösten',

  'toast.turned': 'Gewendet!',
  'toast.turnedRecently': 'Es wurde gerade erst gewendet',
  'toast.toasty': 'Schön mollig warm',
  'toast.misted': 'Schön feucht',
  'toast.full': 'Davon hat es genug',
  'toast.copied': 'Speichercode kopiert',
  'toast.copyFailed': 'Kopieren fehlgeschlagen. Markiere den Code und kopiere ihn selbst',
  'toast.imported': 'Spielstand geladen',
  'toast.importFailed': 'Dieser Speichercode ist ungültig',
  'toast.lightsOff': 'Licht aus. Gute Nacht!',
  'toast.lightsOn': 'Licht an',

  'failed.title': 'Das Ei ist erkaltet',
  'failed.body': 'Diesmal hat es nicht geklappt. Der klassische Modus verzeiht nichts.',
  'failed.button': 'Neues Ei beginnen',

  'reveal.title': 'Dein {type}-Baby ist geschlüpft!',
  'reveal.alone': 'Es ist geschlüpft, während du weg warst, und hat auf dich gewartet.',
  'reveal.body.ember': 'Die viele Wärme hat sich gelohnt. Dieses Kleine ist feurig und liebt die Sonne.',
  'reveal.body.tide': 'Gut befeuchtet und umsorgt ist es kühl, ruhig und verspielt geschlüpft.',
  'reveal.body.bloom': 'All die Lieder und Streicheleinheiten haben einen sanften, blättrigen Freund wachsen lassen.',
  'reveal.body.astral': 'Perfekt ausgewogene Pflege. Ein seltenes Astral-Baby, das sanft leuchtet.',
  'reveal.button': 'Hallo, Kleines!',

  'pet.title': '{type}-Baby',
  'pet.subtitle': 'Geschlüpft {when}',
  'pet.today': 'heute',
  'pet.daysAgo': 'vor {n} Tg.',
  'pet.hint': 'Aufziehen, Training und Kämpfe kommen im nächsten Update',

  'settings.title': 'Einstellungen',
  'settings.language': 'Sprache',
  'lang.auto': 'Gerät',
  'lang.en': 'English',
  'lang.de': 'Deutsch',
  'settings.neglect': 'Wenn Pflege ausfällt',
  'neglect.cozy': 'Gemütlich: nichts Schlimmes passiert',
  'neglect.gentle': 'Sanft: Vernachlässigung hat Folgen',
  'neglect.classic': 'Klassisch: das Ei kann verloren gehen',
  'settings.sleep': 'Schlafenszeit',
  'settings.sleepHint': 'Bedürfnisse sinken kaum, während du schläfst.',
  'settings.sleepFrom': 'Von',
  'settings.sleepTo': 'Bis',
  'settings.sound': 'Ton',
  'settings.backup': 'Sicherung',
  'settings.backupHint':
    'Der Spielstand liegt in diesem Browser. Kopiere den Code als Sicherung oder für ein anderes Gerät.',
  'settings.export': 'Speichercode kopieren',
  'settings.import': 'Speichercode laden',
  'settings.importPlaceholder': 'Speichercode hier einfügen',
  'settings.newEgg': 'Neues Ei beginnen',
  'settings.newEggConfirm': 'Das ersetzt dein aktuelles Ei oder Haustier. Fortfahren?',
  'settings.done': 'Fertig',
  'settings.app': 'App',
  'settings.install': 'App installieren',
  'settings.installIos': 'Auf iPhone oder iPad: Teilen antippen, dann „Zum Home-Bildschirm“.',
  'settings.installOther': 'Installiere die App über das Browser-Menü oder füge sie zum Startbildschirm hinzu.',
  'settings.installed': 'Läuft als installierte App.',
  'settings.debug': 'Debug',
  'debug.skip1': '+1 Std.',
  'debug.skip6': '+6 Std.',
  'debug.ready': 'Sofort bereit',
};

const dictionaries: Record<Lang, Record<Key, string>> = { en, de };
let current: Lang = 'en';

export function resolveLang(setting: LangSetting): Lang {
  if (setting !== 'auto') return setting;
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    if (base in dictionaries) return base as Lang;
  }
  return 'en';
}

export function setLang(setting: LangSetting): Lang {
  current = resolveLang(setting);
  document.documentElement.lang = current;
  return current;
}

export function t(key: Key, params: Record<string, string | number> = {}): string {
  const text = dictionaries[current][key] ?? en[key];
  return text.replace(/\{(\w+)\}/g, (_, p: string) => String(params[p] ?? `{${p}}`));
}

export type { Key as TextKey };
